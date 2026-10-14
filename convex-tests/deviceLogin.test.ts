import { ConvexError } from 'convex/values';
import { getFunctionName } from 'convex/server';
import { record } from '../convex/apiTokens';
import {
  approve,
  claim,
  create,
  deny,
  describe as describeLogin,
  DEVICE_LOGIN_POLL_INTERVAL_S,
  DEVICE_LOGIN_TTL_MS,
  formatUserCode,
  MAX_OPEN_DEVICE_LOGINS,
  normalizeUserCode,
  poll,
  start,
  USER_CODE_ALPHABET,
  USER_CODE_LENGTH,
  userCodeFrom,
} from '../convex/deviceLogin';
import { type SigningJwk } from '../convex/lib/jwt';
import { fakeMutationCtx, handlerOf } from './fakeDb';

/**
 * Device-code login for the CLI (`convex/deviceLogin.ts`): start, approve on
 * another device, poll for the token once.
 */

const A = 'user_a';
const SITE = 'https://example.convex.site';
const clerk = (subject: string) => ({ subject, issuer: 'https://clerk.example.com' });
type Db = ReturnType<typeof fakeMutationCtx>;

async function statusOf(promise: Promise<unknown>): Promise<number | 'ok'> {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    if (error instanceof ConvexError) return (error.data as { status: number }).status;
    throw error;
  }
}

const as = (db: Db, identity: Record<string, unknown> | null) => ({ ...db.ctx, auth: { getUserIdentity: async () => identity } });

function actionCtx(db: Db) {
  const handlers: Record<string, unknown> = { 'deviceLogin:create': create, 'deviceLogin:claim': claim, 'apiTokens:record': record };
  return {
    auth: { getUserIdentity: async () => null },
    runMutation: async (ref: unknown, args: unknown) => handlerOf(handlers[getFunctionName(ref as never)])(db.ctx, args),
  };
}

type Started = { deviceCode: string; userCode: string; verificationUrl: string; expiresAt: number; interval: number };
const startLogin = (db: Db, deviceName = 'meetcal CLI on box (linux)') => handlerOf<{ deviceName: string }, Started>(start)(actionCtx(db), { deviceName });
const pollLogin = (db: Db, deviceCode: string) => handlerOf<{ deviceCode: string }, Record<string, unknown>>(poll)(actionCtx(db), { deviceCode });

let previous: { key?: string; site?: string; url?: string };

beforeEach(async () => {
  previous = { key: process.env.MEETCAL_TOKEN_SIGNING_KEY, site: process.env.CONVEX_SITE_URL, url: process.env.DEVICE_LOGIN_URL };
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const key = { ...(await crypto.subtle.exportKey('jwk', pair.privateKey)), kid: 'k1' } as SigningJwk;
  process.env.MEETCAL_TOKEN_SIGNING_KEY = JSON.stringify(key);
  process.env.CONVEX_SITE_URL = SITE;
  delete process.env.DEVICE_LOGIN_URL;
  jest.useFakeTimers({ now: Date.UTC(2026, 9, 13, 12), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
});

afterEach(() => {
  const restore = (name: string, value: string | undefined) => (value === undefined ? delete process.env[name] : (process.env[name] = value));
  restore('MEETCAL_TOKEN_SIGNING_KEY', previous.key);
  restore('CONVEX_SITE_URL', previous.site);
  restore('DEVICE_LOGIN_URL', previous.url);
  jest.useRealTimers();
});

describe('user codes', () => {
  it('are eight consonants, shown with a dash and read back however they are typed', () => {
    const code = userCodeFrom(new Uint8Array(32).map((_, i) => i * 7));
    expect(code).toMatch(new RegExp(`^[${USER_CODE_ALPHABET}]{${USER_CODE_LENGTH}}$`));
    expect(formatUserCode('WXZBCDFG')).toBe('WXZB-CDFG');
    expect(normalizeUserCode(' wxzb-cdfg ')).toBe('WXZBCDFG');
  });

  it('skip bytes that would bias the letters, and give up without enough bytes', () => {
    expect(userCodeFrom(new Uint8Array([255, 250, 240, ...Array(8).fill(0)]))).toBe('B'.repeat(8));
    expect(userCodeFrom(new Uint8Array(4))).toBeNull();
  });
});

describe('a device login', () => {
  it('goes from start, through approval on another device, to one token for the CLI', async () => {
    const db = fakeMutationCtx();
    const login = await startLogin(db);
    expect(login).toMatchObject({ verificationUrl: 'https://meetcal.app/link', interval: DEVICE_LOGIN_POLL_INTERVAL_S, expiresAt: Date.now() + DEVICE_LOGIN_TTL_MS });
    expect(login.userCode).toMatch(/^[A-Z]{4}-[A-Z]{4}$/);
    // Only the device code's hash is stored.
    expect(JSON.stringify(db.rows('device_logins'))).not.toContain(login.deviceCode);

    expect(await pollLogin(db, login.deviceCode)).toEqual({ status: 'pending' });
    expect(await handlerOf(describeLogin)(as(db, clerk(A)), { userCode: login.userCode.toLowerCase() })).toEqual({
      deviceName: 'meetcal CLI on box (linux)',
      createdAt: Date.now(),
      expiresAt: login.expiresAt,
    });
    expect(await handlerOf(approve)(as(db, clerk(A)), { userCode: login.userCode })).toEqual({ ok: true });

    jest.advanceTimersByTime(DEVICE_LOGIN_POLL_INTERVAL_S * 1000);
    const approved = await pollLogin(db, login.deviceCode);
    expect(approved).toMatchObject({ status: 'approved', token: expect.any(String), tokenId: expect.any(String) });
    expect(db.rows('api_tokens')).toEqual([expect.objectContaining({ userId: A, client: 'cli', tokenId: approved.tokenId })]);
    // Used up: the token is handed over once.
    expect(await pollLogin(db, login.deviceCode)).toEqual({ status: 'expired' });
    expect(db.rows('device_logins')).toEqual([]);
  });

  it('tells a CLI that polls too often to slow down', async () => {
    const db = fakeMutationCtx();
    const { deviceCode } = await startLogin(db);
    expect(await pollLogin(db, deviceCode)).toEqual({ status: 'pending' });
    jest.advanceTimersByTime(1000);
    expect(await pollLogin(db, deviceCode)).toEqual({ status: 'slow_down' });
    jest.advanceTimersByTime(DEVICE_LOGIN_POLL_INTERVAL_S * 1000);
    expect(await pollLogin(db, deviceCode)).toEqual({ status: 'pending' });
  });

  it('tells the CLI when the user denies it, and when the code expires', async () => {
    const db = fakeMutationCtx();
    const denied = await startLogin(db);
    expect(await handlerOf(deny)(as(db, clerk(A)), { userCode: denied.userCode })).toEqual({ ok: true });
    expect(await pollLogin(db, denied.deviceCode)).toEqual({ status: 'denied' });

    const late = await startLogin(db);
    jest.advanceTimersByTime(DEVICE_LOGIN_TTL_MS);
    expect(await statusOf(handlerOf(approve)(as(db, clerk(A)), { userCode: late.userCode }))).toBe(404);
    expect(await handlerOf(describeLogin)(as(db, clerk(A)), { userCode: late.userCode })).toBeNull();
    expect(await pollLogin(db, late.deviceCode)).toEqual({ status: 'expired' });
    expect(await pollLogin(db, 'never-issued')).toEqual({ status: 'expired' });
  });

  it('is approved only with a Clerk session: not anonymously, not with a MeetCal-issued token, not for a deleted account', async () => {
    const db = fakeMutationCtx({ deleted_users: [{ userId: 'user_gone', deletedAt: 1 }] });
    const { userCode } = await startLogin(db);
    expect(await statusOf(handlerOf(approve)(as(db, null), { userCode }))).toBe(401);
    expect(await statusOf(handlerOf(approve)(as(db, { subject: A, issuer: SITE, tid: 't1' }), { userCode }))).toBe(401);
    expect(await statusOf(handlerOf(describeLogin)(as(db, null), { userCode }))).toBe(401);
    expect(await statusOf(handlerOf(approve)(as(db, clerk('user_gone')), { userCode }))).toBe(403);
    expect(db.rows('device_logins')).toEqual([expect.objectContaining({ status: 'pending' })]);
  });

  it('needs a device name, and keeps a long one short', async () => {
    const db = fakeMutationCtx();
    expect(await statusOf(startLogin(db, '   '))).toBe(400);
    await startLogin(db, 'x'.repeat(200));
    expect(db.rows('device_logins')[0].deviceName).toHaveLength(64);
  });

  it('prunes expired logins and refuses new ones past the cap', async () => {
    const now = Date.now();
    const expired = Array.from({ length: 3 }, (_, i) => ({ deviceCodeHash: `old${i}`, userCode: `OLDCODE${i}`, deviceName: 'x', status: 'pending', createdAt: 0, expiresAt: now - 1 }));
    const db = fakeMutationCtx({ device_logins: expired });
    await startLogin(db);
    expect(db.rows('device_logins')).toHaveLength(1);

    const open = Array.from({ length: MAX_OPEN_DEVICE_LOGINS }, (_, i) => ({ deviceCodeHash: `h${i}`, userCode: `CODE${i}`, deviceName: 'x', status: 'pending', createdAt: now, expiresAt: now + 1000 }));
    expect(await statusOf(startLogin(fakeMutationCtx({ device_logins: open })))).toBe(429);
  });

  it('points the user at DEVICE_LOGIN_URL where it is set (dev)', async () => {
    process.env.DEVICE_LOGIN_URL = 'http://localhost:4173/link';
    expect((await startLogin(fakeMutationCtx())).verificationUrl).toBe('http://localhost:4173/link');
  });
});
