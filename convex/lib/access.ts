import type { RegisteredQuery, UserIdentity } from 'convex/server';
import type { ObjectType, PropertyValidators } from 'convex/values';
import { query, type QueryCtx } from '../_generated/server';
import { apiError } from './validation';

/**
 * Who may read premium data. Competition data the app's paywall gates is
 * answered only for a caller with an active `Subscriptions` entitlement
 * (`convex/entitlements.ts`), identified by a Clerk session token (the app,
 * the website) or a MeetCal-issued token (`convex/apiTokens.ts`: the CLI,
 * Siri). Schedules, start lists and meet lists stay public.
 *
 * Rollout is in two steps. In `log`, every caller is answered while the
 * clients learn to send their token, and only the `PREMIUM_LOG_PROBES` look
 * at who called and log it. `enforce` checks every premium query and refuses
 * anonymous callers (401) and callers without the entitlement (403); it is
 * switched on once the app versions that send tokens have replaced the ones
 * that do not.
 *
 * A query that reads its caller is cached per caller, not once for everyone.
 * The probes are cheap, so `log` costs little; the rest keep their shared
 * cache until `enforce`.
 */
export type PremiumMode = 'log' | 'enforce';
export const PREMIUM_MODE: PremiumMode = 'log';

/**
 * The premium queries that identify and log their caller in `log` mode:
 * enough to see that tokens arrive and how much is read anonymously, the
 * bulk export (`results:page`) included.
 */
export const PREMIUM_LOG_PROBES: ReadonlySet<string> = new Set(['reference:records', 'results:yearBests', 'results:page']);

let mode: PremiumMode = PREMIUM_MODE;

/** Replaces the mode, or restores `PREMIUM_MODE` with `null`. For tests. */
export function setPremiumModeForTests(next: PremiumMode | null): void {
  mode = next ?? PREMIUM_MODE;
}

/** The RevenueCat entitlement that unlocks premium data, as in the app (`src/lib/premium-intent.ts`). */
export const SUBSCRIPTION_ENTITLEMENT_ID = 'Subscriptions';

/** Every query that answers premium data. The app and website send their token on exactly these. */
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
  'reference:wsoAthletes',
  'reference:clubMeetStats',
  'results:page',
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

export function describeCaller(caller: Caller): string {
  return caller.kind === 'anonymous' ? 'anonymous' : `${caller.kind} ${caller.userId} via ${caller.via}`;
}

/**
 * The gate every premium query calls first. In `enforce`, refuses a caller
 * without the entitlement. In `log`, a probe logs its caller (only a run that
 * misses Convex's query cache logs, so the counts are a floor) and the rest
 * do not look, so they stay cached once for everyone.
 */
export async function premiumRead(ctx: QueryCtx, fn: PremiumFunction): Promise<void> {
  if (mode === 'log' && !PREMIUM_LOG_PROBES.has(fn)) return;
  const caller = await callerOf(ctx);
  console.log(`[premium] ${fn} ${describeCaller(caller)}`);
  if (mode === 'enforce') {
    if (caller.kind === 'anonymous') throw apiError(401, 'sign in required');
    if (caller.kind === 'free') throw apiError(403, 'subscription required');
  }
}

/** A public query whose handler runs only after `premiumRead` lets the caller through. */
export function premiumQuery<Args extends PropertyValidators, Result>(
  fn: PremiumFunction,
  definition: { args: Args; handler: (ctx: QueryCtx, args: ObjectType<Args>) => Promise<Result> },
): RegisteredQuery<'public', ObjectType<Args>, Promise<Result>> {
  const handler = async (ctx: QueryCtx, args: ObjectType<Args>) => {
    await premiumRead(ctx, fn);
    return await definition.handler(ctx, args);
  };
  // `query`'s overloads cannot follow a generic validator; the signature
  // above is the one each call site gets.
  return query({ args: definition.args, handler } as never) as unknown as RegisteredQuery<'public', ObjectType<Args>, Promise<Result>>;
}
