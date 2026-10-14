import { ConvexError } from 'convex/values';
import { getFunctionName } from 'convex/server';
import {
  claimRefresh,
  ENTITLEMENT_REFRESH_INTERVAL_MS,
  entitlementFromSubscriber,
  MAX_WEBHOOK_USER_IDS,
  refresh,
  revenuecatWebhook,
  store,
  webhookUserIds,
} from '../convex/entitlements';
import { fakeMutationCtx, handlerOf } from './fakeDb';

/**
 * The `entitlements` table follows RevenueCat (`convex/entitlements.ts`):
 * parsing its subscriber answer and webhook events, the refresh throttle,
 * and the webhook's checks.
 */

const NOW = Date.UTC(2026, 9, 13, 12);
const A = 'user_a';
const iso = (ms: number) => new Date(ms).toISOString();
const subscriber = (entitlements: Record<string, unknown>) => ({ request_date: iso(NOW), subscriber: { entitlements } });

describe("RevenueCat's subscriber answer", () => {
  it('reads a lifetime purchase as active with no expiry', () => {
    expect(entitlementFromSubscriber(subscriber({ Subscriptions: { expires_date: null, product_identifier: 'meetcal_lifetime' } }), NOW)).toEqual({
      active: true,
      expiresAt: null,
      productId: 'meetcal_lifetime',
    });
  });

  it('reads a subscription as active until it expires, through a grace period', () => {
    const live = { expires_date: iso(NOW + 1000), product_identifier: 'quarterly' };
    expect(entitlementFromSubscriber(subscriber({ Subscriptions: live }), NOW)).toEqual({ active: true, expiresAt: NOW + 1000, productId: 'quarterly' });
    const lapsed = { expires_date: iso(NOW - 1000), product_identifier: 'quarterly' };
    expect(entitlementFromSubscriber(subscriber({ Subscriptions: lapsed }), NOW)).toMatchObject({ active: false, expiresAt: NOW - 1000 });
    const grace = { ...lapsed, grace_period_expires_date: iso(NOW + 5000) };
    expect(entitlementFromSubscriber(subscriber({ Subscriptions: grace }), NOW)).toMatchObject({ active: true, expiresAt: NOW + 5000 });
  });

  it('reads a sandbox purchase as inactive unless sandbox purchases count (dev)', () => {
    const lifetime = { expires_date: null, product_identifier: 'lifetime' };
    const testflight = { ...subscriber({ Subscriptions: lifetime }), subscriber: { entitlements: { Subscriptions: lifetime }, non_subscriptions: { lifetime: [{ is_sandbox: true }] } } };
    expect(entitlementFromSubscriber(testflight, NOW)).toEqual({ active: false, expiresAt: null, productId: 'lifetime' });
    expect(entitlementFromSubscriber(testflight, NOW, true)).toMatchObject({ active: true });
    const paidOnce = { subscriber: { entitlements: { Subscriptions: lifetime }, non_subscriptions: { lifetime: [{ is_sandbox: true }, { is_sandbox: false }] } } };
    expect(entitlementFromSubscriber(paidOnce, NOW)).toMatchObject({ active: true });
    const quarterly = { expires_date: iso(NOW + 1000), product_identifier: 'quarterly' };
    const sandboxSub = { subscriber: { entitlements: { Subscriptions: quarterly }, subscriptions: { quarterly: { is_sandbox: true } } } };
    expect(entitlementFromSubscriber(sandboxSub, NOW)).toMatchObject({ active: false, expiresAt: NOW + 1000 });
    const realSub = { subscriber: { entitlements: { Subscriptions: quarterly }, subscriptions: { quarterly: { is_sandbox: false } } } };
    expect(entitlementFromSubscriber(realSub, NOW)).toMatchObject({ active: true });
  });

  it('reads no entitlement, or only other ones, as inactive', () => {
    expect(entitlementFromSubscriber(subscriber({}), NOW)).toEqual({ active: false, expiresAt: null, productId: null });
    expect(entitlementFromSubscriber({ subscriber: {} }, NOW)).toEqual({ active: false, expiresAt: null, productId: null });
    expect(entitlementFromSubscriber(subscriber({ Other: { expires_date: null } }), NOW)).toMatchObject({ active: false });
  });

  it('refuses an answer it cannot read rather than storing a guess', () => {
    expect(() => entitlementFromSubscriber(null, NOW)).toThrow('no subscriber');
    expect(() => entitlementFromSubscriber({ subscriber: { entitlements: [] } }, NOW)).toThrow('not an object');
    expect(() => entitlementFromSubscriber(subscriber({ Subscriptions: 'yes' }), NOW)).toThrow('not an object');
    expect(() => entitlementFromSubscriber(subscriber({ Subscriptions: { expires_date: 'soon' } }), NOW)).toThrow('not a date');
  });
});

describe("a webhook event's users", () => {
  it('names every id an event is about, once, without anonymous ones', () => {
    const event = {
      event: {
        type: 'TRANSFER',
        app_user_id: A,
        original_app_user_id: A,
        aliases: [A, '$RCAnonymousID:abc'],
        transferred_from: ['user_b'],
        transferred_to: ['user_c', ''],
      },
    };
    expect(webhookUserIds(event)).toEqual([A, 'user_b', 'user_c']);
  });

  it('names nobody for a malformed event, and at most a bounded number', () => {
    expect(webhookUserIds(null)).toEqual([]);
    expect(webhookUserIds({ event: 'x' })).toEqual([]);
    expect(webhookUserIds({ event: { app_user_id: 'x'.repeat(300) } })).toEqual([]);
    const many = Array.from({ length: MAX_WEBHOOK_USER_IDS + 5 }, (_, i) => `user_${i}`);
    expect(webhookUserIds({ event: { aliases: many } })).toHaveLength(MAX_WEBHOOK_USER_IDS);
  });
});

describe('the stored entitlement', () => {
  const put = handlerOf<Record<string, unknown>, void>(store);
  const state = { active: true, expiresAt: null, productId: 'lifetime' };

  it('keeps one row per user, updated in place, and when RevenueCat was asked apart from it', async () => {
    const db = fakeMutationCtx();
    await put(db.ctx, { userId: A, ...state, syncedAt: NOW });
    await put(db.ctx, { userId: A, ...state, active: false, syncedAt: NOW + 1 });
    expect(db.rows('entitlements')).toEqual([{ userId: A, ...state, active: false }]);
    expect(db.rows('entitlement_syncs')).toEqual([{ userId: A, syncedAt: NOW + 1 }]);
  });

  it('leaves the row premium queries read untouched when nothing changed, so their caches stay', async () => {
    const db = fakeMutationCtx();
    await put(db.ctx, { userId: A, ...state, syncedAt: NOW });
    const patch = jest.spyOn(db.ctx.db, 'patch');
    await put(db.ctx, { userId: A, ...state, syncedAt: NOW + 1 });
    const claim = handlerOf<{ userId: string; now: number }, Record<string, unknown>>(claimRefresh);
    await claim(db.ctx, { userId: A, now: NOW + 2 });
    const entitlementId = db.docs('entitlements')[0]._id;
    expect(patch.mock.calls.map(([id]) => id)).not.toContain(entitlementId);
  });

  it("is not stored for a deleted account, nor refreshed for one", async () => {
    const db = fakeMutationCtx({ deleted_users: [{ userId: A, deletedAt: 1 }] });
    await put(db.ctx, { userId: A, ...state, syncedAt: NOW });
    const claim = handlerOf<{ userId: string; now: number }, Record<string, unknown>>(claimRefresh);
    expect(await claim(db.ctx, { userId: A, now: NOW })).toEqual({ claimed: false, active: false });
    expect(db.rows('entitlements')).toEqual([]);
    expect(db.rows('entitlement_syncs')).toEqual([]);
  });

  it('keeps a newer answer over one RevenueCat was asked for earlier that arrives late', async () => {
    const db = fakeMutationCtx();
    await put(db.ctx, { userId: A, ...state, active: false, syncedAt: NOW + 10 });
    await put(db.ctx, { userId: A, ...state, active: true, syncedAt: NOW });
    expect(db.rows('entitlements')).toEqual([expect.objectContaining({ active: false })]);
    expect(db.rows('entitlement_syncs')).toEqual([{ userId: A, syncedAt: NOW + 10 }]);
  });

  it('lets a refresh reach RevenueCat at most once an interval per user', async () => {
    const claim = handlerOf<{ userId: string; now: number }, Record<string, unknown>>(claimRefresh);
    const db = fakeMutationCtx();
    expect(await claim(db.ctx, { userId: A, now: NOW })).toEqual({ claimed: true });
    expect(await claim(db.ctx, { userId: A, now: NOW + 1 })).toEqual({ claimed: false, active: false });
    expect(await claim(db.ctx, { userId: 'user_b', now: NOW + 1 })).toEqual({ claimed: true });
    expect(await claim(db.ctx, { userId: A, now: NOW + ENTITLEMENT_REFRESH_INTERVAL_MS })).toEqual({ claimed: true });
    expect(db.rows('entitlements')).toEqual([]);
  });
});

describe('RevenueCat calls', () => {
  const handlers: Record<string, unknown> = { 'entitlements:store': store, 'entitlements:claimRefresh': claimRefresh };
  let previous: Record<string, string | undefined>;
  let fetchMock: jest.Mock;
  const originalFetch = global.fetch;

  function actionCtx(db: ReturnType<typeof fakeMutationCtx>, identity: Record<string, unknown> | null = null) {
    return {
      auth: { getUserIdentity: async () => identity },
      runMutation: async (ref: unknown, args: unknown) => handlerOf(handlers[getFunctionName(ref as never)])(db.ctx, args),
    };
  }

  const answer = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const request = (authorization: string | null, body: string) => ({
    headers: { get: (name: string) => (name.toLowerCase() === 'authorization' ? authorization : null) },
    text: async () => body,
  });
  const webhook = (ctx: unknown, req: unknown) => handlerOf<unknown, Response>(revenuecatWebhook)(ctx, req);

  beforeEach(() => {
    previous = { key: process.env.REVENUECAT_SECRET_API_KEY, auth: process.env.REVENUECAT_WEBHOOK_AUTH, site: process.env.CONVEX_SITE_URL };
    process.env.REVENUECAT_SECRET_API_KEY = 'sk_test';
    process.env.REVENUECAT_WEBHOOK_AUTH = 'Bearer hook-secret';
    process.env.CONVEX_SITE_URL = 'https://example.convex.site';
    fetchMock = jest.fn(async () => answer(200, subscriber({ Subscriptions: { expires_date: null, product_identifier: 'lifetime' } })));
    global.fetch = fetchMock as never;
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    const restore = (name: string, value: string | undefined) => (value === undefined ? delete process.env[name] : (process.env[name] = value));
    restore('REVENUECAT_SECRET_API_KEY', previous.key);
    restore('REVENUECAT_WEBHOOK_AUTH', previous.auth);
    restore('CONVEX_SITE_URL', previous.site);
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('webhook: refuses a wrong or missing Authorization header without calling RevenueCat', async () => {
    const db = fakeMutationCtx();
    expect((await webhook(actionCtx(db), request('Bearer wrong', '{}'))).status).toBe(401);
    expect((await webhook(actionCtx(db), request(null, '{}'))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('webhook: answers 500 when not configured, so RevenueCat retries once it is', async () => {
    delete process.env.REVENUECAT_WEBHOOK_AUTH;
    expect((await webhook(actionCtx(fakeMutationCtx()), request('Bearer hook-secret', '{}'))).status).toBe(500);
  });

  it("webhook: stores each named user's state as RevenueCat reports it now", async () => {
    const db = fakeMutationCtx();
    const body = JSON.stringify({ event: { type: 'INITIAL_PURCHASE', app_user_id: A, aliases: ['$RCAnonymousID:x'] } });
    expect((await webhook(actionCtx(db), request('Bearer hook-secret', body))).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`https://api.revenuecat.com/v1/subscribers/${A}`);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer sk_test');
    expect(db.rows('entitlements')).toEqual([expect.objectContaining({ userId: A, active: true, expiresAt: null })]);
  });

  it('webhook: answers 500 when RevenueCat fails, so the event is retried; 400 for a body that is not JSON', async () => {
    fetchMock.mockImplementation(async () => answer(503, {}));
    const db = fakeMutationCtx();
    const body = JSON.stringify({ event: { app_user_id: A } });
    expect((await webhook(actionCtx(db), request('Bearer hook-secret', body))).status).toBe(500);
    expect(db.rows('entitlements')).toEqual([]);
    expect((await webhook(actionCtx(db), request('Bearer hook-secret', 'nope'))).status).toBe(400);
  });

  it('refresh: needs a Clerk session, not a MeetCal-issued token', async () => {
    const run = (identity: Record<string, unknown> | null) => handlerOf(refresh)(actionCtx(fakeMutationCtx(), identity), {});
    const status = (error: unknown) => (error instanceof ConvexError ? (error.data as { status: number }).status : error);
    expect(await run(null).catch(status)).toBe(401);
    expect(await run({ subject: A, issuer: 'https://example.convex.site', tid: 't1' }).catch(status)).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refresh: stores and answers the state, then answers the stored state while throttled', async () => {
    const db = fakeMutationCtx();
    const run = () => handlerOf(refresh)(actionCtx(db, { subject: A, issuer: 'https://clerk.example.com' }), {});
    expect(await run()).toEqual({ active: true });
    expect(await run()).toEqual({ active: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db.rows('entitlements')).toEqual([expect.objectContaining({ userId: A, active: true })]);
  });
});
