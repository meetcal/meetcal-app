import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConvexError } from 'convex/values';
import * as meets from '../convex/meets';
import * as reference from '../convex/reference';
import * as results from '../convex/results';
import { callerOf, entitlementIsActive, PREMIUM_FUNCTIONS, premiumRead, type PremiumMode } from '../convex/lib/access';
import { fakeDb, handlerOf } from './fakeDb';

/**
 * The premium gate (`convex/lib/access.ts`): who a caller is, and what each
 * mode does with them.
 */

const SITE = 'https://example.convex.site';
const NOW = Date.UTC(2026, 9, 13);
const A = 'user_a';

type Identity = Record<string, unknown> | null;

function ctxFor(identity: Identity, seed: Record<string, Record<string, unknown>[]> = {}) {
  const { db } = fakeDb(seed);
  return { db, auth: { getUserIdentity: async () => identity } } as never;
}

const clerk = (subject: string) => ({ subject, issuer: 'https://clerk.example.com', tokenIdentifier: `clerk|${subject}` });
const meetcal = (subject: string, tid: string) => ({ subject, issuer: SITE, tid, tokenIdentifier: `${SITE}|${subject}` });
const entitlement = (userId: string, extra: Record<string, unknown> = {}) => ({
  userId,
  active: true,
  expiresAt: null,
  productId: 'lifetime',
  syncedAt: 1,
  ...extra,
});
const token = (tokenId: string, userId: string) => ({ tokenId, userId, client: 'cli', createdAt: 1, expiresAt: NOW + 1 });

async function statusOf(promise: Promise<unknown>): Promise<number | 'ok'> {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    if (error instanceof ConvexError) return (error.data as { status: number }).status;
    throw error;
  }
}

let previousSite: string | undefined;
let log: jest.SpyInstance;

beforeEach(() => {
  previousSite = process.env.CONVEX_SITE_URL;
  process.env.CONVEX_SITE_URL = SITE;
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  log = jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  if (previousSite === undefined) delete process.env.CONVEX_SITE_URL;
  else process.env.CONVEX_SITE_URL = previousSite;
  jest.useRealTimers();
  log.mockRestore();
});

describe('who a caller is', () => {
  it('is anonymous without a token', async () => {
    expect(await callerOf(ctxFor(null))).toEqual({ kind: 'anonymous' });
  });

  it('is a subscriber with a Clerk session and an active entitlement, free without one', async () => {
    expect(await callerOf(ctxFor(clerk(A), { entitlements: [entitlement(A)] }))).toEqual({ kind: 'subscriber', userId: A, via: 'clerk' });
    expect(await callerOf(ctxFor(clerk(A)))).toEqual({ kind: 'free', userId: A, via: 'clerk' });
    expect(await callerOf(ctxFor(clerk(A), { entitlements: [entitlement(A, { active: false })] }))).toMatchObject({ kind: 'free' });
  });

  it('is free once a stored subscription has expired, even before RevenueCat says so', async () => {
    expect(await callerOf(ctxFor(clerk(A), { entitlements: [entitlement(A, { expiresAt: NOW - 1 })] }))).toMatchObject({ kind: 'free' });
    expect(await callerOf(ctxFor(clerk(A), { entitlements: [entitlement(A, { expiresAt: NOW + 1 })] }))).toMatchObject({ kind: 'subscriber' });
  });

  it("does not count someone else's entitlement", async () => {
    expect(await callerOf(ctxFor(clerk(A), { entitlements: [entitlement('user_b')] }))).toMatchObject({ kind: 'free' });
  });

  it('honours a MeetCal-issued token only while its row exists and is the subject’s', async () => {
    const seed = { entitlements: [entitlement(A)], api_tokens: [token('t1', A), token('t2', 'user_b')] };
    expect(await callerOf(ctxFor(meetcal(A, 't1'), seed))).toEqual({ kind: 'subscriber', userId: A, via: 'meetcal' });
    expect(await callerOf(ctxFor(meetcal(A, 'revoked'), seed))).toEqual({ kind: 'anonymous' });
    expect(await callerOf(ctxFor(meetcal(A, 't2'), seed))).toEqual({ kind: 'anonymous' });
    expect(await callerOf(ctxFor({ ...meetcal(A, 't1'), tid: undefined }, seed))).toEqual({ kind: 'anonymous' });
  });

  it('reads entitlement expiry against the time it is asked', () => {
    expect(entitlementIsActive({ active: true, expiresAt: null }, NOW)).toBe(true);
    expect(entitlementIsActive({ active: true, expiresAt: NOW }, NOW)).toBe(false);
    expect(entitlementIsActive({ active: false, expiresAt: null }, NOW)).toBe(false);
  });
});

describe('the gate', () => {
  const read = (identity: Identity, mode: PremiumMode, seed = {}) => statusOf(premiumRead(ctxFor(identity, seed), 'results:byNames', mode));

  it('answers everyone in log mode, and logs who asked', async () => {
    expect(await read(null, 'log')).toBe('ok');
    expect(await read(clerk(A), 'log')).toBe('ok');
    expect(log.mock.calls.map(([line]) => line)).toEqual(['[premium] results:byNames anonymous', `[premium] results:byNames free ${A} via clerk`]);
  });

  it('refuses anonymous callers with 401 and free ones with 403 in enforce mode', async () => {
    expect(await read(null, 'enforce')).toBe(401);
    expect(await read(clerk(A), 'enforce')).toBe(403);
    expect(await read(clerk(A), 'enforce', { entitlements: [entitlement(A)] })).toBe('ok');
  });
});

describe('the premium queries', () => {
  const modules: Record<string, Record<string, unknown>> = { meets, reference, results };

  it('are every one the app and website send a token to, and run the gate first', async () => {
    for (const name of PREMIUM_FUNCTIONS) {
      const [module, fn] = name.split(':');
      const registered = modules[module]?.[fn] as { isQuery?: boolean; isPublic?: boolean } | undefined;
      expect([name, registered?.isQuery, registered?.isPublic]).toEqual([name, true, true]);
    }
  });

  it("are the ones the website sends its token to (`SUBSCRIPTION_FUNCTIONS` in `web/src/utils/api.rs`)", () => {
    const source = readFileSync(join(__dirname, '..', 'web', 'src', 'utils', 'api.rs'), 'utf8');
    const list = /SUBSCRIPTION_FUNCTIONS: &\[&str\] = &\[([^\]]*)\]/.exec(source)?.[1] ?? '';
    const web = [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    expect(web.sort()).toEqual([...PREMIUM_FUNCTIONS].sort());
  });

  it('gate before reading anything', async () => {
    const identity = jest.fn(async () => null);
    const db = new Proxy({}, { get: () => () => { throw new Error('read'); } });
    await expect(handlerOf(reference.records)({ db, auth: { getUserIdentity: identity } }, {})).rejects.toThrow('read');
    expect(identity).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('[premium] reference:records anonymous');
  });

  it('leave name suggestions public: search gates only when asked for results', async () => {
    const throwing = { getUserIdentity: async () => { throw new Error('gated'); } };
    const { db } = fakeDb();
    // Past the gate to the (empty) name directory, without asking who called.
    expect(await statusOf(handlerOf(results.search)({ db, auth: throwing }, { query: 'Ada' }))).toBe(503);
    await expect(handlerOf(results.search)({ db, auth: throwing }, { query: 'Ada', startDate: '2026-01-01', endDate: '2026-12-31' })).rejects.toThrow('gated');
  });
});
