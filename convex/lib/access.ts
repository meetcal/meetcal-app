import type { RegisteredQuery, UserIdentity } from 'convex/server';
import { v, type ObjectType, type PropertyValidators } from 'convex/values';
import { query, type QueryCtx } from '../_generated/server';
import { apiError } from './validation';

/**
 * Who may read premium data. Competition data the app's paywall gates is
 * answered only to a caller holding the current access pass
 * (`convex/accessPass.ts`), which `accessPass:pass` gives only to a user with an
 * active `Subscriptions` entitlement (`convex/entitlements.ts`), signed in
 * with Clerk (the app, the website) or a MeetCal-issued token
 * (`convex/apiTokens.ts`: the CLI, Siri). Schedules, start lists and meet
 * lists stay public.
 *
 * Every subscriber holds the same pass and sends it as an argument, so a
 * premium query never reads its caller: Convex caches each answer once for
 * everyone, not once per user. A pass rotates daily, and the previous one
 * stays good until the next rotation.
 *
 * Rollout is in two steps. In `log`, a read without a current pass is still
 * answered, and logged, while the clients learn to send one. `enforce`
 * refuses it: 401 without a pass, 403 with a stale one (the client fetches a
 * new pass and retries). It is switched on once the app versions that send
 * passes have replaced the ones that do not.
 */
export type PremiumMode = 'log' | 'enforce';
export const PREMIUM_MODE: PremiumMode = 'log';

let mode: PremiumMode = PREMIUM_MODE;

/** Replaces the mode, or restores `PREMIUM_MODE` with `null`. For tests. */
export function setPremiumModeForTests(next: PremiumMode | null): void {
  mode = next ?? PREMIUM_MODE;
}

/** The RevenueCat entitlement that unlocks premium data, as in the app (`src/lib/premium-intent.ts`). */
export const SUBSCRIPTION_ENTITLEMENT_ID = 'Subscriptions';

/** Every query that answers premium data. The app and website send the pass to exactly these. */
export const PREMIUM_FUNCTIONS = [
  'reference:records',
  'reference:standards',
  'reference:qualifyingTotals',
  'reference:intlRankings',
  'reference:nationalRankings',
  'reference:nationalRankingsByYear',
  'reference:wsoList',
  'reference:registrationWsos',
  'reference:wsoAgeGroups',
  'reference:wsoRecords',
  'reference:adaptiveRecords',
  'reference:clubs',
  'reference:clubAthletes',
  'reference:clubMeets',
  'reference:wsoAthletes',
  'reference:clubMeetStats',
  'results:byMeet',
  'results:byNames',
  'results:recent',
  'results:yearBests',
  'results:bests',
  // Only with dates: name suggestions alone stay public.
  'results:search',
  'meets:packageForMeet',
] as const;

export type PremiumFunction = (typeof PREMIUM_FUNCTIONS)[number];

/**
 * Every action that answers premium data, apart from `PREMIUM_FUNCTIONS`
 * (queries only: the app and website attach the pass to those by name).
 * Each takes the pass in its `pass` argument and checks it with `checkPass`,
 * after reading the pass row through `accessPass:passes`. Actions are not
 * cached, so these are for answers too costly for one query: the
 * leaderboard pages through a range's results, and a WSO's elite lists
 * through its members' registrations and histories. The CLI attaches the pass to
 * them (`PREMIUM_ACTIONS` in `cli/src/utils/access.rs`).
 */
export const PREMIUM_ACTIONS = ['results:leaderboard', 'results:wsoElite'] as const;

export type PremiumAction = (typeof PREMIUM_ACTIONS)[number];

/**
 * Premium functions refused without a current pass even in `log` mode. No
 * shipped client calls these without one, and each passless call would cost
 * a full uncached read (the leaderboard reads up to five years of results),
 * so they need not wait for `enforce`.
 */
export const ENFORCED_FROM_THE_START: ReadonlySet<string> = new Set<PremiumAction>(['results:leaderboard', 'results:wsoElite']);

export type Caller =
  | { kind: 'anonymous' }
  | { kind: 'free' | 'subscriber'; userId: string; via: 'clerk' | 'meetcal' };

/** The issuer of MeetCal-issued tokens: this deployment's HTTP actions URL. */
export function meetcalTokenIssuer(): string | undefined {
  return process.env.CONVEX_SITE_URL;
}

export function isMeetCalToken(identity: UserIdentity): boolean {
  const issuer = meetcalTokenIssuer();
  return issuer !== undefined && identity.issuer === issuer;
}

/**
 * The signed-in user, or null. A MeetCal-issued token counts only while its
 * row exists and belongs to the token's subject: deleting the row (sign-out,
 * account deletion) revokes it before it expires.
 */
export async function signedInUser(ctx: QueryCtx): Promise<{ userId: string; via: 'clerk' | 'meetcal' } | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  if (!isMeetCalToken(identity)) return { userId: identity.subject, via: 'clerk' };
  const tokenId = identity.tid;
  if (typeof tokenId !== 'string') return null;
  const row = await ctx.db
    .query('api_tokens')
    .withIndex('by_tokenId', (q) => q.eq('tokenId', tokenId))
    .unique();
  if (!row || row.userId !== identity.subject) return null;
  return { userId: identity.subject, via: 'meetcal' };
}

/** Whether a stored entitlement is active at `now`: RevenueCat said so, and it has not expired since. */
export function entitlementIsActive(row: { active: boolean; expiresAt: number | null }, now: number): boolean {
  return row.active && (row.expiresAt === null || row.expiresAt > now);
}

export async function callerOf(ctx: QueryCtx): Promise<Caller> {
  const user = await signedInUser(ctx);
  if (!user) return { kind: 'anonymous' };
  const row = await ctx.db
    .query('entitlements')
    .withIndex('by_userId', (q) => q.eq('userId', user.userId))
    .unique();
  const kind = row !== null && entitlementIsActive(row, Date.now()) ? 'subscriber' : 'free';
  return { kind, ...user };
}

/** The pass rotation's one row, or null before the first rotation. */
export async function currentPasses(ctx: QueryCtx) {
  return await ctx.db.query('access_passes').first();
}

/** The passes a read may carry: the current one and the one it replaced, or null before the first rotation. */
export type Passes = { current: string; previous: string | null } | null;

/**
 * The gate every premium query calls first, with the pass it was sent. A
 * current or previous pass goes through. In `log`, anything else is logged
 * (only a run that misses Convex's query cache logs, so the counts are a
 * floor) and answered; in `enforce`, refused.
 */
export async function premiumRead(ctx: QueryCtx, fn: PremiumFunction, pass: string | undefined): Promise<void> {
  checkPass(fn, pass, await currentPasses(ctx));
}

/**
 * `premiumRead`'s decision, given the stored `passes`: for premium actions,
 * which read the pass row with `accessPass:passes` (every run logs, since
 * actions are not cached).
 */
export function checkPass(fn: PremiumFunction | PremiumAction, pass: string | undefined, passes: Passes): void {
  if (pass !== undefined && passes !== null && (pass === passes.current || pass === passes.previous)) return;
  if (mode === 'log' && !ENFORCED_FROM_THE_START.has(fn)) {
    console.log(`[premium] ${fn} ${pass === undefined ? 'without a pass' : 'with a stale pass'}`);
    return;
  }
  throw pass === undefined ? apiError(401, 'access pass required') : apiError(403, 'access pass expired');
}

/** The argument every premium query takes its pass in. */
const passArg = { pass: v.optional(v.string()) };

/** A public query that takes a `pass` and runs its handler only after `premiumRead` lets it through. */
export function premiumQuery<Args extends PropertyValidators, Result>(
  fn: PremiumFunction,
  definition: { args: Args; handler: (ctx: QueryCtx, args: ObjectType<Args>) => Promise<Result> },
): RegisteredQuery<'public', ObjectType<Args> & { pass?: string }, Promise<Result>> {
  const handler = async (ctx: QueryCtx, { pass, ...args }: ObjectType<Args> & { pass?: string }) => {
    await premiumRead(ctx, fn, pass);
    return await definition.handler(ctx, args as ObjectType<Args>);
  };
  // `query`'s overloads cannot follow a generic validator; the signature
  // above is the one each call site gets.
  return query({ args: { ...definition.args, ...passArg }, handler } as never) as unknown as RegisteredQuery<
    'public',
    ObjectType<Args> & { pass?: string },
    Promise<Result>
  >;
}
