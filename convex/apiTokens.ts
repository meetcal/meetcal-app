import { v } from 'convex/values';
import { internal } from './_generated/api';
import { action, httpAction, internalMutation, internalQuery, mutation, type ActionCtx } from './_generated/server';
import { isMeetCalToken, meetcalTokenIssuer } from './lib/access';
import { parseSigningJwk, publicJwk, signJwt } from './lib/jwt';
import { apiError } from './lib/validation';

/**
 * MeetCal-issued sign-in tokens, for the clients that cannot hold a Clerk
 * session: the CLI (`meetcal login`) and Siri's App Intents. A signed-in
 * Clerk user asks for one (`issue`); it is an ES256 JWT this deployment
 * signs, with the user's Clerk id as `sub`, and Convex accepts it as a second
 * auth provider (`convex/auth.config.ts`). Premium queries honour it only
 * while its `api_tokens` row exists (`convex/lib/access.ts`), so `revoke` and
 * account deletion end it before it expires. It reads premium data and
 * nothing else: saved sessions and preferences still need a Clerk session
 * (`convex/users.ts`).
 *
 * Needs `MEETCAL_TOKEN_SIGNING_KEY`: `bun scripts/generate-token-signing-key.ts`.
 */

/** How long a token lasts. The client signs in again after this. */
export const API_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
/** The audience every MeetCal-issued token carries; `auth.config.ts` requires it. */
export const API_TOKEN_AUDIENCE = 'meetcal';
/** Tokens one user may hold at once; issuing another deletes the oldest. */
export const MAX_API_TOKENS_PER_USER = 20;

const client = v.union(v.literal('cli'), v.literal('siri'));

/** Records a new token's row, refusing a deleted account; makes room under `MAX_API_TOKENS_PER_USER`. */
export const record = internalMutation({
  args: { tokenId: v.string(), userId: v.string(), client, createdAt: v.number(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    const deleted = await ctx.db
      .query('deleted_users')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .first();
    if (deleted) throw apiError(403, 'account deleted');
    const held = await ctx.db
      .query('api_tokens')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .take(MAX_API_TOKENS_PER_USER);
    const oldestFirst = held.sort((a, b) => a.createdAt - b.createdAt);
    for (const row of oldestFirst.slice(0, Math.max(0, held.length - MAX_API_TOKENS_PER_USER + 1))) await ctx.db.delete(row._id);
    await ctx.db.insert('api_tokens', args);
  },
});

export type IssuedToken = { token: string; tokenId: string; expiresAt: number };

/** Whether this deployment can sign tokens: its signing key and issuer are set. */
export function tokensConfigured(): boolean {
  return parseSigningJwk(process.env.MEETCAL_TOKEN_SIGNING_KEY) !== null && meetcalTokenIssuer() !== undefined;
}

/**
 * Makes and records a new token for `userId`. For `issue` (a signed-in Clerk
 * user) and an approved device login (`deviceLogin.ts`). In an action: the
 * token id and the signature need real randomness.
 */
export async function mintApiToken(ctx: Pick<ActionCtx, 'runMutation'>, userId: string, client: 'cli' | 'siri'): Promise<IssuedToken> {
  const key = parseSigningJwk(process.env.MEETCAL_TOKEN_SIGNING_KEY);
  const issuer = meetcalTokenIssuer();
  if (!key || !issuer) {
    console.error('apiTokens: MEETCAL_TOKEN_SIGNING_KEY or CONVEX_SITE_URL is not set');
    throw apiError(503, 'sign-in tokens are not configured');
  }
  const tokenId = crypto.randomUUID();
  const createdAt = Date.now();
  const expiresAt = createdAt + API_TOKEN_TTL_MS;
  await ctx.runMutation(internal.apiTokens.record, { tokenId, userId, client, createdAt, expiresAt });
  const token = await signJwt(key, {
    iss: issuer,
    sub: userId,
    aud: API_TOKEN_AUDIENCE,
    iat: Math.floor(createdAt / 1000),
    exp: Math.floor(expiresAt / 1000),
    tid: tokenId,
  });
  return { token, tokenId, expiresAt };
}

/**
 * A new token for the signed-in Clerk user. Answers `{ token, tokenId,
 * expiresAt }`. A MeetCal-issued token cannot issue another, so a leaked one
 * cannot keep itself alive.
 */
export const issue = action({
  args: { client },
  handler: async (ctx, args): Promise<IssuedToken> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || isMeetCalToken(identity)) throw apiError(401, 'unauthorized');
    return await mintApiToken(ctx, identity.subject, args.client);
  },
});

/**
 * Ends a token. Called with a MeetCal-issued token, ends that token (the
 * CLI's `logout`) whatever `tokenId` says; with a Clerk session, ends the
 * user's token `tokenId` (Siri's, on sign-out). Ending a token that is
 * already gone is not an error.
 */
export const revoke = mutation({
  args: { tokenId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw apiError(401, 'unauthorized');
    const ownToken = isMeetCalToken(identity) ? identity.tid : args.tokenId;
    if (typeof ownToken !== 'string' || ownToken === '') throw apiError(400, 'tokenId is required');
    const row = await ctx.db
      .query('api_tokens')
      .withIndex('by_tokenId', (q) => q.eq('tokenId', ownToken))
      .unique();
    if (row && row.userId === identity.subject) await ctx.db.delete(row._id);
    return null;
  },
});

/**
 * Ends every CLI token of the signed-in Clerk user, and turns down any login
 * they approved whose token the CLI has not collected yet: the way back after
 * approving a login by mistake. Siri's token is left alone. Answers how many
 * tokens were ended.
 */
export const revokeAllCli = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || isMeetCalToken(identity)) throw apiError(401, 'unauthorized');
    const rows = await ctx.db
      .query('api_tokens')
      .withIndex('by_userId', (q) => q.eq('userId', identity.subject))
      .take(MAX_API_TOKENS_PER_USER);
    let ended = 0;
    for (const row of rows) {
      if (row.client !== 'cli') continue;
      await ctx.db.delete(row._id);
      ended++;
    }
    const approved = await ctx.db
      .query('device_logins')
      .withIndex('by_approvedBy', (q) => q.eq('approvedBy', identity.subject))
      .take(MAX_API_TOKENS_PER_USER);
    for (const login of approved) if (login.status === 'approved') await ctx.db.patch(login._id, { status: 'denied' });
    return { ended };
  },
});

/** Whether the token `tokenId` is still `userId`'s: not revoked, not replaced. */
export const isLive = internalQuery({
  args: { tokenId: v.string(), userId: v.string() },
  handler: async (ctx, { tokenId, userId }) => {
    const row = await ctx.db
      .query('api_tokens')
      .withIndex('by_tokenId', (q) => q.eq('tokenId', tokenId))
      .unique();
    return row !== null && row.userId === userId;
  },
});

/** `GET /.well-known/jwks.json`: the public key Convex verifies MeetCal-issued tokens with. */
export const jwks = httpAction(async () => {
  const key = parseSigningJwk(process.env.MEETCAL_TOKEN_SIGNING_KEY);
  // An empty set is not cached, so tokens verify as soon as the key is set.
  return new Response(JSON.stringify({ keys: key ? [publicJwk(key)] : [] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': key ? 'public, max-age=3600' : 'no-store' },
  });
});
