import { v } from 'convex/values';
import { internal } from './_generated/api';
import { action, internalMutation, mutation, query, type QueryCtx } from './_generated/server';
import { isMeetCalToken } from './lib/access';
import { apiError } from './lib/validation';
import { mintApiToken, tokensConfigured, type IssuedToken } from './apiTokens';

/**
 * Device-code login for the `meetcal` CLI, so it signs in without a browser
 * on its machine: over SSH, on a server, inside an agent's sandbox.
 *
 * 1. `start`: the CLI gets a secret device code and a short user code, and
 *    shows the code with a link to meetcal.app/link (and a QR code of it).
 * 2. The user opens the link on any device, signs in with Clerk, sees which
 *    device is asking (`describe`) and approves or denies it.
 * 3. `poll`: the CLI, polling every `interval` seconds with its device code,
 *    gets a MeetCal-issued token once approved (`apiTokens.ts`), once.
 *
 * Only the device code's hash is stored, so the table alone cannot claim a
 * login. Approving needs a Clerk session; a MeetCal-issued token cannot
 * approve another device. A code lives `DEVICE_LOGIN_TTL_MS`. A collected
 * login stays `collected` until it expires, so a CLI whose answer was lost is
 * told so instead of "expired".
 */

export const DEVICE_LOGIN_TTL_MS = 10 * 60 * 1000;
/** How often the CLI polls, in seconds. Polling sooner answers `slow_down`. */
export const DEVICE_LOGIN_POLL_INTERVAL_S = 5;
export const MAX_DEVICE_NAME_LENGTH = 64;
/** Expired logins one `start` deletes. */
export const DEVICE_LOGIN_PRUNE_BATCH = 20;
/** Where the user approves a login; `DEVICE_LOGIN_URL` points dev elsewhere. */
export const DEFAULT_VERIFICATION_URL = 'https://meetcal.app/link';
/**
 * User-code letters: consonants only, so a code spells no words and has no
 * 0/O or 1/I to confuse. Eight of them: 20^8 codes.
 */
export const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
export const USER_CODE_LENGTH = 8;

/** A user code as typed (any case, spaces, the dash), as stored: `WXYZBCDF`. */
export function normalizeUserCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z]/g, '');
}

/** A stored user code as shown: `WXYZ-BCDF`. */
export function formatUserCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** A user code from random bytes, without modulo bias (bytes past the last whole multiple are skipped). */
export function userCodeFrom(bytes: Uint8Array): string | null {
  const limit = 256 - (256 % USER_CODE_ALPHABET.length);
  let code = '';
  for (const byte of bytes) {
    if (byte >= limit) continue;
    code += USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length];
    if (code.length === USER_CODE_LENGTH) return code;
  }
  return null;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The Clerk user, refusing anonymous callers and MeetCal-issued tokens (401). */
async function requireClerkUser(ctx: Pick<QueryCtx, 'auth'>): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity || isMeetCalToken(identity)) throw apiError(401, 'unauthorized');
  return identity.subject;
}

/** The unexpired login on `userCode`, in any state. An expired one not yet pruned may hold the same code. */
const openLogin = async (ctx: QueryCtx, userCode: string, now: number) => {
  const code = normalizeUserCode(userCode);
  if (code.length !== USER_CODE_LENGTH) return null;
  const rows = await ctx.db
    .query('device_logins')
    .withIndex('by_userCode', (q) => q.eq('userCode', code))
    .take(DEVICE_LOGIN_PRUNE_BATCH);
  return rows.find((row) => row.expiresAt > now) ?? null;
};

const pendingLogin = async (ctx: QueryCtx, userCode: string, now: number) => {
  const row = await openLogin(ctx, userCode, now);
  return row?.status === 'pending' ? row : null;
};

/** Records a new login; false when its user code is taken by one in progress (the caller draws again). */
export const create = internalMutation({
  args: { deviceCodeHash: v.string(), userCode: v.string(), deviceName: v.string(), now: v.number() },
  handler: async (ctx, { deviceCodeHash, userCode, deviceName, now }): Promise<boolean> => {
    const expired = await ctx.db
      .query('device_logins')
      .withIndex('by_expiresAt', (q) => q.lte('expiresAt', now))
      .take(DEVICE_LOGIN_PRUNE_BATCH);
    for (const row of expired) await ctx.db.delete(row._id);
    const sameCode = await ctx.db
      .query('device_logins')
      .withIndex('by_userCode', (q) => q.eq('userCode', userCode))
      .take(DEVICE_LOGIN_PRUNE_BATCH);
    if (sameCode.some((row) => row.expiresAt > now)) return false;
    await ctx.db.insert('device_logins', {
      deviceCodeHash,
      userCode,
      deviceName,
      status: 'pending',
      createdAt: now,
      expiresAt: now + DEVICE_LOGIN_TTL_MS,
    });
    return true;
  },
});

/**
 * Starts a login for the device named `deviceName` (shown to the user when
 * they approve). Answers `{ deviceCode, userCode, verificationUrl, expiresAt,
 * interval }`; `deviceCode` is the CLI's secret, `userCode` is for the user.
 */
export const start = action({
  args: { deviceName: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ deviceCode: string; userCode: string; verificationUrl: string; expiresAt: number; interval: number }> => {
    const deviceName = args.deviceName.trim().slice(0, MAX_DEVICE_NAME_LENGTH);
    if (deviceName === '') throw apiError(400, 'deviceName is required');
    // Fails before the user approves anything, not after.
    if (!tokensConfigured()) throw apiError(503, 'sign-in tokens are not configured');
    const deviceCode = randomHex(32);
    const deviceCodeHash = await sha256Hex(deviceCode);
    const now = Date.now();
    for (let attempt = 0; attempt < 5; attempt++) {
      const userCode = userCodeFrom(crypto.getRandomValues(new Uint8Array(32)));
      if (userCode === null) continue;
      if (await ctx.runMutation(internal.deviceLogin.create, { deviceCodeHash, userCode, deviceName, now })) {
        return {
          deviceCode,
          userCode: formatUserCode(userCode),
          verificationUrl: process.env.DEVICE_LOGIN_URL || DEFAULT_VERIFICATION_URL,
          expiresAt: now + DEVICE_LOGIN_TTL_MS,
          interval: DEVICE_LOGIN_POLL_INTERVAL_S,
        };
      }
    }
    throw apiError(503, 'could not start a login; try again');
  },
});

type PollStatus = 'pending' | 'slow_down' | 'denied' | 'expired' | 'collected';
type Claim = { status: PollStatus } | { status: 'approved'; userId: string };

/**
 * Where a login stands, for its device code's hash. An approved login is
 * handed over once and kept as `collected` until it expires, so a poll after
 * a lost answer is told the token went out, not that the code expired.
 */
export const claim = internalMutation({
  args: { deviceCodeHash: v.string(), now: v.number() },
  handler: async (ctx, { deviceCodeHash, now }): Promise<Claim> => {
    const row = await ctx.db
      .query('device_logins')
      .withIndex('by_deviceCodeHash', (q) => q.eq('deviceCodeHash', deviceCodeHash))
      .first();
    if (!row) return { status: 'expired' };
    if (row.expiresAt <= now) {
      await ctx.db.delete(row._id);
      return { status: 'expired' };
    }
    if (row.status === 'denied') {
      await ctx.db.delete(row._id);
      return { status: 'denied' };
    }
    if (row.status === 'collected') return { status: 'collected' };
    if (row.status === 'approved' && row.approvedBy !== undefined) {
      await ctx.db.patch(row._id, { status: 'collected' });
      return { status: 'approved', userId: row.approvedBy };
    }
    // A poll is allowed a second early, for timer jitter.
    const tooSoon = row.lastPolledAt !== undefined && now - row.lastPolledAt < DEVICE_LOGIN_POLL_INTERVAL_S * 1000 - 1000;
    await ctx.db.patch(row._id, { lastPolledAt: now });
    return { status: tooSoon ? 'slow_down' : 'pending' };
  },
});

/**
 * The CLI's poll. Answers `{ status }`: `pending`, `slow_down` (wait
 * `interval` plus five seconds), `denied`, `expired`, `approved` with the
 * token (`{ token, tokenId, expiresAt }`), answered once, or `collected`: it
 * was answered already, and that answer was lost (start again).
 */
export const poll = action({
  args: { deviceCode: v.string() },
  handler: async (ctx, { deviceCode }): Promise<{ status: PollStatus } | ({ status: 'approved' } & IssuedToken)> => {
    const answer = await ctx.runMutation(internal.deviceLogin.claim, { deviceCodeHash: await sha256Hex(deviceCode), now: Date.now() });
    if (answer.status !== 'approved') return { status: answer.status };
    return { status: 'approved', ...(await mintApiToken(ctx, answer.userId, 'cli')) };
  },
});

/** The login waiting on `userCode`, for the approve page: `{ deviceName, createdAt, expiresAt }`, or null. */
export const describe = query({
  args: { userCode: v.string() },
  handler: async (ctx, { userCode }) => {
    await requireClerkUser(ctx);
    const row = await pendingLogin(ctx, userCode, Date.now());
    return row ? { deviceName: row.deviceName, createdAt: row.createdAt, expiresAt: row.expiresAt } : null;
  },
});

/** Approves the login waiting on `userCode` for the signed-in user. 404 when none is waiting. */
export const approve = mutation({
  args: { userCode: v.string() },
  handler: async (ctx, { userCode }) => {
    const userId = await requireClerkUser(ctx);
    const deleted = await ctx.db
      .query('deleted_users')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first();
    if (deleted) throw apiError(403, 'account deleted');
    const row = await pendingLogin(ctx, userCode, Date.now());
    if (!row) throw apiError(404, 'this code has expired or was already used');
    await ctx.db.patch(row._id, { status: 'approved', approvedBy: userId });
    return { ok: true };
  },
});

/**
 * Turns down the login on `userCode`: one still waiting, or one this user
 * approved whose token the CLI has not collected yet (second thoughts in
 * another tab). The CLI is told. 404 when there is nothing left to turn down:
 * the code expired, or the CLI already has its token.
 */
export const deny = mutation({
  args: { userCode: v.string() },
  handler: async (ctx, { userCode }) => {
    const userId = await requireClerkUser(ctx);
    const row = await openLogin(ctx, userCode, Date.now());
    if (!row || (row.status === 'approved' && row.approvedBy !== userId) || row.status === 'collected' || row.status === 'denied') {
      throw apiError(404, 'this code has expired or was already used');
    }
    await ctx.db.patch(row._id, { status: 'denied' });
    return { ok: true };
  },
});
