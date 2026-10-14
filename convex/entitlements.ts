import { v } from 'convex/values';
import { internal } from './_generated/api';
import { action, httpAction, internalAction, internalMutation, internalQuery, type ActionCtx, type MutationCtx } from './_generated/server';
import { entitlementIsActive, isMeetCalToken, SUBSCRIPTION_ENTITLEMENT_ID } from './lib/access';
import { apiError } from './lib/validation';
import { constantTimeEqual } from './lib/webhookSignature';

/**
 * Who holds the `Subscriptions` entitlement, for the premium queries' gate
 * (`convex/lib/access.ts`). RevenueCat knows; this keeps the `entitlements`
 * table in step with it. RevenueCat's app user id is the Clerk user id (the
 * app and website log in to RevenueCat with it).
 *
 * Every update asks RevenueCat's REST API for the user's current state rather
 * than reading it off an event, so events arriving out of order or twice
 * cannot leave a stale answer. Two things trigger one:
 *
 * - RevenueCat's webhook (`/revenuecat/webhook`), on every purchase,
 *   renewal, cancellation, expiry and transfer;
 * - the app and website (`refresh`), when they see an active entitlement:
 *   right after a purchase, before the webhook lands, and for lifetime
 *   purchases made before the webhook existed, which never renew.
 *
 * Needs `REVENUECAT_SECRET_API_KEY` (a v1 secret key) and
 * `REVENUECAT_WEBHOOK_AUTH` (the Authorization header value configured on the
 * webhook in RevenueCat). A sandbox purchase (TestFlight, a test card) counts
 * only where `REVENUECAT_COUNT_SANDBOX` is `true`: set it on dev, never on
 * prod. See `docs/backend.md`.
 */

const REVENUECAT_SUBSCRIBERS_URL = 'https://api.revenuecat.com/v1/subscribers/';
/** How long one RevenueCat request may take. */
export const REVENUECAT_TIMEOUT_MS = 10_000;
/** The least time between two `refresh` calls that reach RevenueCat for one user. */
export const ENTITLEMENT_REFRESH_INTERVAL_MS = 60_000;
/** The most user ids one webhook event updates (a transfer names both sides). */
export const MAX_WEBHOOK_USER_IDS = 20;
/** The longest user id taken from a webhook event. Clerk's are about 32 characters. */
export const MAX_USER_ID_LENGTH = 256;

export type EntitlementState = { active: boolean; expiresAt: number | null; productId: string | null };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function dateMs(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  const ms = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms)) throw new Error(`RevenueCat ${field} is not a date: ${JSON.stringify(value)}`);
  return ms;
}

/**
 * Whether the purchase behind an entitlement was a sandbox one: its
 * subscription says so, or every one-time purchase of the product does.
 */
function isSandboxPurchase(subscriber: Record<string, unknown>, productId: string | null): boolean {
  if (productId === null) return false;
  const subscription = isObject(subscriber.subscriptions) ? subscriber.subscriptions[productId] : undefined;
  if (isObject(subscription)) return subscription.is_sandbox === true;
  const purchases = isObject(subscriber.non_subscriptions) ? subscriber.non_subscriptions[productId] : undefined;
  return Array.isArray(purchases) && purchases.length > 0 && purchases.every((p) => isObject(p) && p.is_sandbox === true);
}

/**
 * The `Subscriptions` entitlement from RevenueCat's `GET /v1/subscribers`
 * answer. No entitlement is inactive, and so is a sandbox purchase unless
 * `countSandbox`. A null `expires_date` is a lifetime purchase. A billing
 * grace period counts until it ends.
 */
export function entitlementFromSubscriber(body: unknown, now: number, countSandbox = false): EntitlementState {
  if (!isObject(body) || !isObject(body.subscriber)) throw new Error('RevenueCat answer has no subscriber');
  const entitlements = body.subscriber.entitlements;
  if (entitlements !== undefined && !isObject(entitlements)) throw new Error('RevenueCat entitlements is not an object');
  const entitlement = entitlements?.[SUBSCRIPTION_ENTITLEMENT_ID];
  if (entitlement === undefined) return { active: false, expiresAt: null, productId: null };
  if (!isObject(entitlement)) throw new Error(`RevenueCat ${SUBSCRIPTION_ENTITLEMENT_ID} is not an object`);
  const productId = typeof entitlement.product_identifier === 'string' ? entitlement.product_identifier : null;
  const expires = dateMs(entitlement.expires_date, 'expires_date');
  const grace = dateMs(entitlement.grace_period_expires_date, 'grace_period_expires_date');
  const expiresAt = expires === null ? null : grace === null ? expires : Math.max(expires, grace);
  if (!countSandbox && isSandboxPurchase(body.subscriber, productId)) return { active: false, expiresAt, productId };
  return { active: expiresAt === null || expiresAt > now, expiresAt, productId };
}

/**
 * The RevenueCat user ids a webhook event is about, without RevenueCat's
 * anonymous ids (nobody signed in) and anything not a plausible id.
 */
export function webhookUserIds(body: unknown): string[] {
  const event = isObject(body) && isObject(body.event) ? body.event : null;
  if (!event) return [];
  const listed = (value: unknown): unknown[] => (Array.isArray(value) ? value : [value]);
  const candidates = [
    ...listed(event.app_user_id),
    ...listed(event.original_app_user_id),
    ...listed(event.aliases),
    ...listed(event.transferred_from),
    ...listed(event.transferred_to),
  ];
  const ids = new Set<string>();
  for (const id of candidates) {
    if (typeof id !== 'string' || id.trim() === '' || id.length > MAX_USER_ID_LENGTH || id.startsWith('$RCAnonymousID:')) continue;
    ids.add(id);
    if (ids.size === MAX_WEBHOOK_USER_IDS) break;
  }
  return [...ids];
}

/** The user's entitlement, asked of RevenueCat now. Throws when RevenueCat cannot answer. */
async function fetchEntitlement(userId: string): Promise<EntitlementState> {
  const key = process.env.REVENUECAT_SECRET_API_KEY;
  if (!key) throw new Error('REVENUECAT_SECRET_API_KEY is not set');
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), REVENUECAT_TIMEOUT_MS);
  try {
    const response = await fetch(`${REVENUECAT_SUBSCRIBERS_URL}${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: abort.signal,
    });
    if (!response.ok) throw new Error(`RevenueCat answered ${response.status} for a subscriber`);
    return entitlementFromSubscriber(await response.json(), Date.now(), process.env.REVENUECAT_COUNT_SANDBOX === 'true');
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Asks RevenueCat for the user's entitlement and stores it, dated to when it
 * asked: an answer that arrives after a newer one is stored is dropped.
 */
async function syncEntitlement(ctx: Pick<ActionCtx, 'runMutation'>, userId: string): Promise<EntitlementState> {
  const askedAt = Date.now();
  const state = await fetchEntitlement(userId);
  await ctx.runMutation(internal.entitlements.store, { userId, ...state, syncedAt: askedAt });
  return state;
}

const syncRow = (ctx: MutationCtx, userId: string) =>
  ctx.db
    .query('entitlement_syncs')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .unique();

const entitlementRow = (ctx: MutationCtx, userId: string) =>
  ctx.db
    .query('entitlements')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .unique();

/**
 * Stores a user's entitlement, unless their account was deleted or a newer
 * answer (one RevenueCat was asked for later) is already stored.
 */
export const store = internalMutation({
  args: {
    userId: v.string(),
    active: v.boolean(),
    expiresAt: v.union(v.number(), v.null()),
    productId: v.union(v.string(), v.null()),
    syncedAt: v.number(),
  },
  handler: async (ctx, { userId, syncedAt, ...state }) => {
    const deleted = await ctx.db
      .query('deleted_users')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first();
    if (deleted) return;
    const sync = await syncRow(ctx, userId);
    if (sync && sync.syncedAt > syncedAt) return;
    if (sync) await ctx.db.patch(sync._id, { syncedAt });
    else await ctx.db.insert('entitlement_syncs', { userId, syncedAt });
    const row = await entitlementRow(ctx, userId);
    if (!row) await ctx.db.insert('entitlements', { userId, ...state });
    else if (row.active !== state.active || row.expiresAt !== state.expiresAt || row.productId !== state.productId) {
      await ctx.db.patch(row._id, state);
    }
  },
});

/**
 * Whether a `refresh` may ask RevenueCat now, and records that it did; at
 * most once per `ENTITLEMENT_REFRESH_INTERVAL_MS` per user. A throttled call
 * answers the stored state.
 */
export const claimRefresh = internalMutation({
  args: { userId: v.string(), now: v.number() },
  handler: async (ctx, { userId, now }): Promise<{ claimed: true } | { claimed: false; active: boolean }> => {
    const deleted = await ctx.db
      .query('deleted_users')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first();
    if (deleted) return { claimed: false, active: false };
    const sync = await syncRow(ctx, userId);
    if (sync?.refreshRequestedAt !== undefined && now - sync.refreshRequestedAt < ENTITLEMENT_REFRESH_INTERVAL_MS) {
      const row = await entitlementRow(ctx, userId);
      return { claimed: false, active: row !== null && entitlementIsActive(row, now) };
    }
    if (sync) await ctx.db.patch(sync._id, { refreshRequestedAt: now });
    else await ctx.db.insert('entitlement_syncs', { userId, syncedAt: 0, refreshRequestedAt: now });
    return { claimed: true };
  },
});

/**
 * The signed-in user's entitlement, asked of RevenueCat and stored, for a
 * client to call when `accessPass:pass` answers 403 for a user who may have
 * just subscribed. Answers `{ active }`. Needs a Clerk session or a
 * MeetCal-issued token (the CLI): either way it only re-checks the caller's
 * own subscription.
 */
export const refresh = action({
  args: {},
  handler: async (ctx): Promise<{ active: boolean }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw apiError(401, 'unauthorized');
    // A MeetCal-issued token counts only while it is not revoked, as for the pass.
    if (isMeetCalToken(identity)) {
      const tokenId = identity.tid;
      if (typeof tokenId !== 'string' || !(await ctx.runQuery(internal.apiTokens.isLive, { tokenId, userId: identity.subject }))) {
        throw apiError(401, 'unauthorized');
      }
    }
    const claim = await ctx.runMutation(internal.entitlements.claimRefresh, { userId: identity.subject, now: Date.now() });
    if (!claim.claimed) return { active: claim.active };
    const state = await syncEntitlement(ctx, identity.subject);
    return { active: entitlementIsActive(state, Date.now()) };
  },
});

/**
 * One user's entitlement, asked of RevenueCat and stored. For backfills and
 * support:
 *
 *   npx convex run entitlements:sync '{"userId":"user_…"}'
 */
export const sync = internalAction({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => await syncEntitlement(ctx, userId),
});

/**
 * RevenueCat's webhook. Checks the Authorization header against
 * `REVENUECAT_WEBHOOK_AUTH`, then updates every user the event names. Any
 * failure answers 500, so RevenueCat retries the event. Configure in
 * RevenueCat: endpoint `https://<deployment>.convex.site/revenuecat/webhook`,
 * every event type, and an Authorization header value; then
 * `npx convex env set REVENUECAT_WEBHOOK_AUTH '<that value>'`.
 */
export const revenuecatWebhook = httpAction(async (ctx, request) => {
  const expected = process.env.REVENUECAT_WEBHOOK_AUTH;
  if (!expected) {
    console.error('revenuecat webhook: REVENUECAT_WEBHOOK_AUTH is not set');
    return new Response('webhook not configured', { status: 500 });
  }
  if (!constantTimeEqual(request.headers.get('authorization') ?? '', expected)) return new Response('unauthorized', { status: 401 });
  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return new Response('body is not JSON', { status: 400 });
  }
  try {
    for (const userId of webhookUserIds(body)) await syncEntitlement(ctx, userId);
  } catch (error) {
    console.error('revenuecat webhook: could not update an entitlement', error);
    return new Response('could not update entitlement', { status: 500 });
  }
  return new Response(null, { status: 200 });
});

/** Users one backfill run asks RevenueCat about, one at a time; the next run is scheduled. */
export const BACKFILL_BATCH = 50;
/** Pause between backfill runs, so RevenueCat's rate limit is never near. */
export const BACKFILL_PAUSE_MS = 2_000;
/** The tables whose rows name users, scanned for a backfill. */
const knownUserTables = ['saved_sessions', 'user_preferences'] as const;
type KnownUserTable = (typeof knownUserTables)[number];

/**
 * The next `limit` distinct user ids in `table` after `after`, by its
 * `by_userId` index: one read per user, however many rows each has.
 */
export const knownUserIds = internalQuery({
  args: { table: v.union(v.literal('saved_sessions'), v.literal('user_preferences')), after: v.string(), limit: v.number() },
  handler: async (ctx, { table, after, limit }): Promise<string[]> => {
    const ids: string[] = [];
    let last = after;
    for (let i = 0; i < limit; i++) {
      const lower = last;
      const row = await ctx.db
        .query(table)
        .withIndex('by_userId', (q) => q.gt('userId', lower))
        .first();
      if (!row) break;
      ids.push(row.userId);
      last = row.userId;
    }
    return ids;
  },
});

/** Asks RevenueCat about each user and stores the answer; a failure is counted, not thrown. */
async function syncEach(ctx: Pick<ActionCtx, 'runMutation'>, userIds: readonly string[]): Promise<{ synced: number; active: number; failed: number }> {
  let synced = 0;
  let active = 0;
  let failed = 0;
  for (const userId of userIds) {
    try {
      const state = await syncEntitlement(ctx, userId);
      synced++;
      if (entitlementIsActive(state, Date.now())) active++;
    } catch (error) {
      failed++;
      console.error(`entitlements backfill: ${userId}`, error);
    }
  }
  return { synced, active, failed };
}

/**
 * Before enforcement: asks RevenueCat about every user Convex knows (anyone
 * with saved sessions or preferences), `BACKFILL_BATCH` at a time, so
 * subscribers who have not opened a pass-sending app yet (lifetime purchases
 * send no renewals) already have their entitlement. Schedules itself until
 * done; each run logs its counts.
 *
 *   npx convex run entitlements:backfillKnownUsers
 */
export const backfillKnownUsers = internalAction({
  args: { table: v.optional(v.union(v.literal('saved_sessions'), v.literal('user_preferences'))), after: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ table: KnownUserTable; synced: number; active: number; failed: number; users: number }> => {
    const table: KnownUserTable = args.table ?? 'saved_sessions';
    const userIds: string[] = await ctx.runQuery(internal.entitlements.knownUserIds, { table, after: args.after ?? '', limit: BACKFILL_BATCH });
    const counts = await syncEach(ctx, userIds);
    console.log(`entitlements backfill: ${table} after ${JSON.stringify(args.after ?? '')}: ${JSON.stringify(counts)}`);
    const next = knownUserTables[knownUserTables.indexOf(table) + 1];
    if (userIds.length === BACKFILL_BATCH) {
      await ctx.scheduler.runAfter(BACKFILL_PAUSE_MS, internal.entitlements.backfillKnownUsers, { table, after: userIds[userIds.length - 1] });
    } else if (next) {
      await ctx.scheduler.runAfter(BACKFILL_PAUSE_MS, internal.entitlements.backfillKnownUsers, { table: next });
    }
    return { table, ...counts, users: userIds.length };
  },
});

/**
 * Asks RevenueCat about the given users (at most `BACKFILL_BATCH`), for
 * subscribers Convex has no row for, e.g. from RevenueCat's customer export:
 *
 *   npx convex run entitlements:backfillUsers '{"userIds":["user_…"]}'
 */
export const backfillUsers = internalAction({
  args: { userIds: v.array(v.string()) },
  handler: async (ctx, { userIds }) => {
    if (userIds.length > BACKFILL_BATCH) throw new Error(`at most ${BACKFILL_BATCH} user ids per call`);
    return await syncEach(ctx, userIds);
  },
});
