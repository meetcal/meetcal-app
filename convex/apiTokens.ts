import { v } from 'convex/values';
import { internal } from './_generated/api';
import { action, httpAction, internalMutation, mutation } from './_generated/server';
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

/**
 * A new token for the signed-in Clerk user. Answers `{ token, tokenId,
 * expiresAt }`. A MeetCal-issued token cannot issue another, so a leaked one
 * cannot keep itself alive.
 */
export const issue = action({
  args: { client },
  handler: async (ctx, args): Promise<{ token: string; tokenId: string; expiresAt: number }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || isMeetCalToken(identity)) throw apiError(401, 'unauthorized');
    const key = parseSigningJwk(process.env.MEETCAL_TOKEN_SIGNING_KEY);
    const issuer = meetcalTokenIssuer();
    if (!key || !issuer) {
      console.error('apiTokens.issue: MEETCAL_TOKEN_SIGNING_KEY or CONVEX_SITE_URL is not set');
      throw apiError(503, 'sign-in tokens are not configured');
    }
    const tokenId = crypto.randomUUID();
    const createdAt = Date.now();
    const expiresAt = createdAt + API_TOKEN_TTL_MS;
    await ctx.runMutation(internal.apiTokens.record, { tokenId, userId: identity.subject, client: args.client, createdAt, expiresAt });
    const token = await signJwt(key, {
      iss: issuer,
      sub: identity.subject,
      aud: API_TOKEN_AUDIENCE,
      iat: Math.floor(createdAt / 1000),
      exp: Math.floor(expiresAt / 1000),
      tid: tokenId,
    });
    return { token, tokenId, expiresAt };
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

/** `GET /.well-known/jwks.json`: the public key Convex verifies MeetCal-issued tokens with. */
export const jwks = httpAction(async () => {
  const key = parseSigningJwk(process.env.MEETCAL_TOKEN_SIGNING_KEY);
  return new Response(JSON.stringify({ keys: key ? [publicJwk(key)] : [] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
  });
});
