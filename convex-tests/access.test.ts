import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConvexError } from 'convex/values';
import * as meets from '../convex/meets';
import * as reference from '../convex/reference';
import * as results from '../convex/results';
import { callerOf, entitlementIsActive, PREMIUM_ACTIONS, PREMIUM_FUNCTIONS, premiumRead, setPremiumModeForTests } from '../convex/lib/access';
import { ANONYMOUS_AUTH, fakeDb, handlerOf } from './fakeDb';

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
  afterEach(() => setPremiumModeForTests(null));
  const passes = { access_passes: [{ current: 'today', previous: 'yesterday', rotatedAt: NOW }] };
  const read = (pass: string | undefined, seed: Record<string, Record<string, unknown>[]> = passes) =>
    statusOf(premiumRead(ctxFor(null, seed), 'results:byNames', pass));

  it('lets the current and the previous pass through, without asking who called', async () => {
    setPremiumModeForTests('enforce');
    const identity = jest.fn(async () => null);
    const { db } = fakeDb(passes);
    expect(await statusOf(premiumRead({ db, auth: { getUserIdentity: identity } } as never, 'results:byNames', 'today'))).toBe('ok');
    expect(await read('yesterday')).toBe('ok');
    expect(identity).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('answers a read without a current pass in log mode, and logs it', async () => {
    setPremiumModeForTests('log');
    expect(await read(undefined)).toBe('ok');
    expect(await read('last-week')).toBe('ok');
    expect(log.mock.calls.map(([line]) => line)).toEqual(['[premium] results:byNames without a pass', '[premium] results:byNames with a stale pass']);
  });

  it('refuses a read without a pass with 401, and with a stale one with 403, in enforce mode', async () => {
    setPremiumModeForTests('enforce');
    expect(await read(undefined)).toBe(401);
    expect(await read('last-week')).toBe(403);
    // Before the first rotation no pass is current.
    expect(await read('today', {})).toBe(403);
  });
});

describe('the premium queries', () => {
  const modules: Record<string, Record<string, unknown>> = { meets, reference, results };
  afterEach(() => setPremiumModeForTests(null));

  it('are every one the app and website send the pass to', async () => {
    for (const name of PREMIUM_FUNCTIONS) {
      const [module, fn] = name.split(':');
      const registered = modules[module]?.[fn] as { isQuery?: boolean; isPublic?: boolean } | undefined;
      expect([name, registered?.isQuery, registered?.isPublic]).toEqual([name, true, true]);
    }
  });

  it('each refuse a read without a pass in enforce mode, before reading anything else', async () => {
    setPremiumModeForTests('enforce');
    const dated = { query: 'Ada', startDate: '2026-01-01', endDate: '2026-12-31' };
    for (const name of PREMIUM_FUNCTIONS) {
      const [module, fn] = name.split(':');
      const tables: string[] = [];
      const { db: real } = fakeDb();
      const db = { ...real, query: (table: string) => (tables.push(table), real.query(table)) };
      const answer = await statusOf(handlerOf(modules[module][fn])({ db, auth: ANONYMOUS_AUTH }, name === 'results:search' ? dated : {}));
      expect([name, answer, tables]).toEqual([name, 401, ['access_passes']]);
    }
  });

  it('each take their pass in the `pass` argument and pass the rest to the query unchanged', async () => {
    setPremiumModeForTests('enforce');
    const { db } = fakeDb({ access_passes: [{ current: 'today', previous: null, rotatedAt: NOW }] });
    const answer = await handlerOf(reference.nationalRankingsByYear)({ db, auth: ANONYMOUS_AUTH }, { federation: 'USAW', ageCategory: 'nope', year: '2026', pass: 'today' }).catch((error: unknown) => error);
    // Past the gate: the 404 is the query's own answer for an unknown class.
    expect(answer instanceof ConvexError ? (answer.data as { status: number }).status : answer).toBe(404);
  });

  it("are the ones the website sends the pass to (`SUBSCRIPTION_FUNCTIONS` in `web/src/utils/api.rs`)", () => {
    const source = readFileSync(join(__dirname, '..', 'web', 'src', 'utils', 'api.rs'), 'utf8');
    const list = /SUBSCRIPTION_FUNCTIONS: &\[&str\] = &\[([^\]]*)\]/.exec(source)?.[1] ?? '';
    const web = [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    expect(web.sort()).toEqual([...PREMIUM_FUNCTIONS].sort());
  });

  it('are the ones the CLI sends the pass to (`PREMIUM_FUNCTIONS` in `cli/src/utils/access.rs`)', () => {
    const source = readFileSync(join(__dirname, '..', 'cli', 'src', 'utils', 'access.rs'), 'utf8');
    const list = /PREMIUM_FUNCTIONS: &\[&str\] = &\[([^\]]*)\]/.exec(source)?.[1] ?? '';
    const cli = [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    expect(cli.sort()).toEqual([...PREMIUM_FUNCTIONS].sort());
  });

  it('leave out the premium actions, which are public actions the CLI sends the pass to (`PREMIUM_ACTIONS`)', () => {
    for (const name of PREMIUM_ACTIONS) {
      const [module, fn] = name.split(':');
      const registered = modules[module]?.[fn] as { isAction?: boolean; isPublic?: boolean } | undefined;
      expect([name, registered?.isAction, registered?.isPublic]).toEqual([name, true, true]);
      expect(PREMIUM_FUNCTIONS).not.toContain(name);
    }
    const source = readFileSync(join(__dirname, '..', 'cli', 'src', 'utils', 'access.rs'), 'utf8');
    const list = /PREMIUM_ACTIONS: &\[&str\] = &\[([^\]]*)\]/.exec(source)?.[1] ?? '';
    const cli = [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    expect(cli.sort()).toEqual([...PREMIUM_ACTIONS].sort());
  });

  it('leave name suggestions public: search checks the pass only when asked for results', async () => {
    setPremiumModeForTests('enforce');
    const { db } = fakeDb();
    // Past the gate to the (empty) name directory.
    expect(await statusOf(handlerOf(results.search)({ db, auth: ANONYMOUS_AUTH }, { query: 'Ada' }))).toBe(503);
    expect(await statusOf(handlerOf(results.search)({ db, auth: ANONYMOUS_AUTH }, { query: 'Ada', startDate: '2026-01-01', endDate: '2026-12-31' }))).toBe(401);
  });
});
