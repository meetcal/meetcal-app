import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalAction, internalMutation, internalQuery, query } from './_generated/server';
import { callerOf, currentPasses } from './lib/access';
import { apiError } from './lib/validation';

/**
 * The access pass premium queries are read with (`lib/access.ts`). Every
 * subscriber gets the same pass, so premium answers stay in Convex's shared
 * query cache. A daily job (`rotate-access-pass` in `cronJobs.ts`) replaces
 * it; the one it replaced stays good until the next rotation, so a client's
 * pass works for at least a day. A rotation clears every premium query's
 * cache once, since each reads the pass row.
 *
 * Before the first rotation there is no pass: run
 * `npx convex run accessPass:rotate` once after deploying. Run it again to
 * shut out a pass that leaked, twice to shut out the previous one too.
 */

/** How long after a rotation clients should ask for the new pass. */
export const ACCESS_PASS_ROTATION_MS = 24 * 60 * 60 * 1000;

/**
 * The current pass, for a subscriber signed in with Clerk or a MeetCal-issued
 * token: `{ pass, rotatesAt }`, `rotatesAt` being when to ask again. 401
 * signed out, 403 without an active entitlement (the app then asks
 * `entitlements:refresh` and tries again).
 */
export const pass = query({
  args: {},
  handler: async (ctx): Promise<{ pass: string; rotatesAt: number }> => {
    const caller = await callerOf(ctx);
    if (caller.kind === 'anonymous') throw apiError(401, 'unauthorized');
    if (caller.kind === 'free') throw apiError(403, 'subscription required');
    const passes = await currentPasses(ctx);
    if (!passes) throw apiError(503, 'no access pass yet');
    return { pass: passes.current, rotatesAt: passes.rotatedAt + ACCESS_PASS_ROTATION_MS };
  },
});

/** Makes `pass` current and keeps the one it replaces. */
export const store = internalMutation({
  args: { pass: v.string(), now: v.number() },
  handler: async (ctx, { pass, now }) => {
    const passes = await currentPasses(ctx);
    if (passes) await ctx.db.patch(passes._id, { current: pass, previous: passes.current, rotatedAt: now });
    else await ctx.db.insert('access_passes', { current: pass, previous: null, rotatedAt: now });
  },
});

/** A new pass: 256 random bits. In an action, where randomness is real. */
export const rotate = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }) => {
    if (dryRun) return;
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const pass = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    await ctx.runMutation(internal.accessPass.store, { pass, now: Date.now() });
  },
});

/** The current pass, or null before the first rotation. For server code that reads premium queries (`parity:run`). */
export const currentPass = internalQuery({
  args: {},
  handler: async (ctx) => (await currentPasses(ctx))?.current ?? null,
});
