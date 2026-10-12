import * as fc from 'fast-check';

import {
  clearHttpValidatorCache,
  deleteSavedSession,
  fetchApiAthletes,
  fetchApiClubAthletes,
  fetchApiMeetByName,
  fetchApiMeetPackageConditional,
  fetchApiMeets,
  fetchApiWsoRecords,
  fetchApiYearBestsByNames,
  fetchSavedSessions,
  MEET_PACKAGE_TIMEOUT_MS,
  MeetCalApiError,
  MeetCalApiTimeoutError,
  resetServerClockForTests,
  type ApiWsoRecordRow,
} from './meetcal-api';
import type { TransportFault } from './chaos-transport';
import { isClockCall, jsonTransportStub } from './json-transport-stub';
import { CONVEX_TRANSIENT_MESSAGE, setApiTransportForTests, type ApiCall, type Transport } from './transport';
import { hostileStringArb } from '@/test-support/arbitraries';
import {
  faultPlanArb,
  installChaosTransport,
  settlingTransportFaultArb,
  type ChaosTransport,
} from '@/test-support/chaos';

/**
 * `request()` and the validator cache under transport faults. A call ends in
 * exactly one of: a valid answer, `MeetCalApiError` with the refused status,
 * `MeetCalApiTimeoutError`, or the transport's own error (the network's
 * `TypeError`, Convex's "try again later", a validator's `Error`); which one
 * follows from the fault the deciding call got.
 */

/** The client's per-call default (`DEFAULT_TIMEOUT_MS` in meetcal-api.ts). */
const DEFAULT_TIMEOUT_MS = 10000;

const MEET_ROW = {
  name: 'Meet',
  start_date: '2026-06-20',
  end_date: '2026-06-21',
  time_zone: 'America/Chicago',
  status: 'upcoming',
  venue_name: 'Hall',
  venue_street: '1 Main',
  venue_city: 'City',
  venue_state: 'ST',
  venue_zip: '00000',
};

const ATHLETE_ROW = {
  member_id: '1',
  name: 'Athlete A',
  age: 30,
  club: 'Club',
  wso: null,
  gender: 'Male',
  weight_class: '89',
  entry_total: 250,
  adaptive: false,
  session_number: 1,
  session_platform: 'Red',
};

const PACKAGE = { meet: MEET_ROW, schedule: [], athletes: [ATHLETE_ROW], meet_results: [] };

/** A healthy backend for every fetcher below, in the production wire shape. */
const healthy: Transport = jsonTransportStub((path) => {
  switch (path) {
    case '/meets':
      return [MEET_ROW];
    case '/meets/details':
      return MEET_ROW;
    case '/meets/athletes':
      return [ATHLETE_ROW];
    case '/meets/package':
      return PACKAGE;
    case '/lifting-results/bests':
      return [{ name: 'Athlete A', best_snatch: 100, best_cj: 120, best_total: 220 }];
    case '/clubs/athletes':
      return [{ name: 'Athlete A' }];
    case '/users/me/saved-sessions':
      return { sessions: [] };
    case '/users/me/saved-sessions/s1':
      return { deleted: true };
    default:
      throw new Error(`unexpected call to ${path}`);
  }
});

type Fetcher = {
  name: string;
  run: () => Promise<unknown>;
  timeoutMs: number;
  /** Whether the value has the app type's shape (the healthy answer passes). */
  valid: (value: unknown) => boolean;
  /** `fetchApiMeetByName` answers a 404 with `null`. */
  notFoundIsNull?: boolean;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const isArrayOf = (value: unknown, row: (item: unknown) => boolean) => Array.isArray(value) && value.every(row);
const isMeet = (value: unknown) => isObject(value) && typeof value.name === 'string' && isObject(value.time);

const FETCHERS: Fetcher[] = [
  { name: 'fetchApiMeets', run: () => fetchApiMeets(), timeoutMs: DEFAULT_TIMEOUT_MS, valid: (v) => isArrayOf(v, isMeet) },
  {
    name: 'fetchApiMeetByName',
    run: () => fetchApiMeetByName('Meet'),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    valid: (v) => v === null || isMeet(v),
    notFoundIsNull: true,
  },
  {
    name: 'fetchApiAthletes',
    run: () => fetchApiAthletes('Meet'),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    valid: (v) => isArrayOf(v, (row) => isObject(row) && typeof row.name === 'string'),
  },
  {
    name: 'fetchApiMeetPackageConditional',
    run: () => fetchApiMeetPackageConditional('Meet'),
    timeoutMs: MEET_PACKAGE_TIMEOUT_MS,
    valid: (v) => isObject(v) && v.status === 'fresh' && isObject(v.package),
  },
  {
    name: 'fetchApiYearBestsByNames',
    run: () => fetchApiYearBestsByNames(['Athlete A']),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    valid: (v) =>
      isObject(v) &&
      Object.values(v).every((bests) => isObject(bests) && Object.values(bests).every(Number.isFinite)),
  },
  { name: 'fetchApiClubAthletes', run: () => fetchApiClubAthletes('Club'), timeoutMs: DEFAULT_TIMEOUT_MS, valid: Array.isArray },
  {
    name: 'fetchSavedSessions',
    run: () => fetchSavedSessions('token'),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    valid: (v) => isArrayOf(v, (row) => isObject(row) && typeof row.session_id === 'string'),
  },
  {
    name: 'deleteSavedSession',
    run: () => deleteSavedSession('token', 's1'),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    valid: (v) => isObject(v) && typeof v.deleted === 'boolean',
  },
];

const fetcherArb = fc.constantFrom(...FETCHERS);

type Outcome = { ok: true; value: unknown } | { ok: false; error: unknown };

function outcomeOf(promise: Promise<unknown>): Promise<Outcome> {
  return promise.then(
    (value): Outcome => ({ ok: true, value }),
    (error: unknown): Outcome => ({ ok: false, error }),
  );
}

function dataCalls(chaos: ChaosTransport) {
  return chaos.calls.filter(({ call }) => !isClockCall(call));
}

/** The transport's own failure: not a status, not a timeout. */
function expectPlainError(outcome: Outcome) {
  expect(outcome.ok).toBe(false);
  if (outcome.ok) return;
  expect(outcome.error).toBeInstanceOf(Error);
  expect(outcome.error).not.toBeInstanceOf(MeetCalApiError);
  expect(outcome.error).not.toBeInstanceOf(MeetCalApiTimeoutError);
}

/** What the call that decided the outcome got determines how it ends. */
function expectClassified(fetcher: Fetcher, fault: TransportFault, outcome: Outcome) {
  switch (fault.kind) {
    case 'pass':
      expect(outcome.ok && fetcher.valid(outcome.value)).toBe(true);
      return;
    case 'network':
      expectPlainError(outcome);
      expect(outcome.ok ? null : outcome.error).toBeInstanceOf(TypeError);
      return;
    case 'status':
      if (fetcher.notFoundIsNull && fault.status === 404) {
        expect(outcome).toEqual({ ok: true, value: null });
        return;
      }
      expect(outcome.ok ? null : outcome.error).toBeInstanceOf(MeetCalApiError);
      expect((outcome as { error: MeetCalApiError }).error.status).toBe(fault.status);
      return;
    case 'transient':
      expectPlainError(outcome);
      expect((outcome as { error: Error }).error.message).toMatch(CONVEX_TRANSIENT_MESSAGE);
      return;
    case 'garbage':
      // A garbage answer can happen to be well formed (`[]` for a list).
      if (outcome.ok) expect(fetcher.valid(outcome.value)).toBe(true);
      else expectPlainError(outcome);
      return;
    case 'truncate':
      expectPlainError(outcome);
      return;
    default:
      throw new Error(`unexpected fault ${fault.kind}`);
  }
}

let chaos: ChaosTransport | null = null;

function install(inner: Transport, plan: readonly TransportFault[]): ChaosTransport {
  chaos?.restore();
  chaos = installChaosTransport(inner, plan);
  return chaos;
}

beforeEach(() => {
  resetServerClockForTests();
  clearHttpValidatorCache();
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  chaos?.restore();
  chaos = null;
  setApiTransportForTests(null);
  resetServerClockForTests();
  clearHttpValidatorCache();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('request() under settling transport faults (chaos)', () => {
  it('ends every call in the outcome its deciding fault calls for', async () => {
    await fc.assert(
      fc.asyncProperty(fetcherArb, faultPlanArb(settlingTransportFaultArb, 3), async (fetcher, plan) => {
        clearHttpValidatorCache();
        const run = install(healthy, plan);
        const outcome = await outcomeOf(fetcher.run());
        const calls = dataCalls(run);
        // One call, plus at most one retry without a tag after a bodiless answer.
        expect(calls.length).toBeGreaterThanOrEqual(1);
        expect(calls.length).toBeLessThanOrEqual(2);
        expectClassified(fetcher, calls[calls.length - 1].fault, outcome);
      }),
    );
  });

  it('recovers on the next healthy call after any fault', async () => {
    await fc.assert(
      fc.asyncProperty(fetcherArb, settlingTransportFaultArb, async (fetcher, fault) => {
        clearHttpValidatorCache();
        install(healthy, [fault]);
        await outcomeOf(fetcher.run());
        const next = await outcomeOf(fetcher.run());
        expect(next.ok && fetcher.valid(next.value)).toBe(true);
      }),
    );
  });
});

describe('request() timeouts under hanging and slow transports (chaos)', () => {
  it('times a hung call out at its limit and aborts it', async () => {
    await fc.assert(
      fc.asyncProperty(fetcherArb, async (fetcher) => {
        jest.useFakeTimers();
        resetServerClockForTests();
        clearHttpValidatorCache();
        const run = install(healthy, [{ kind: 'hang' }]);
        let settled = false;
        const pending = outcomeOf(fetcher.run()).finally(() => {
          settled = true;
        });

        await jest.advanceTimersByTimeAsync(fetcher.timeoutMs - 1);
        expect(settled).toBe(false);
        const [hung] = dataCalls(run);
        expect(hung.call.signal?.aborted).toBe(false);

        await jest.advanceTimersByTimeAsync(1);
        const outcome = await pending;
        expect(outcome.ok ? null : outcome.error).toBeInstanceOf(MeetCalApiTimeoutError);
        expect((outcome as { error: MeetCalApiTimeoutError }).error.timeoutMs).toBe(fetcher.timeoutMs);
        expect(hung.call.signal?.aborted).toBe(true);
        expect(jest.getTimerCount()).toBe(0);
        jest.useRealTimers();
      }),
    );
  });

  it('answers a slow call inside its limit and times it out from the limit on', async () => {
    await fc.assert(
      fc.asyncProperty(
        fetcherArb,
        fc.oneof(fc.integer({ min: 0, max: 20_000 }), fc.constantFrom(DEFAULT_TIMEOUT_MS - 1, DEFAULT_TIMEOUT_MS, MEET_PACKAGE_TIMEOUT_MS)),
        async (fetcher, ms) => {
          jest.useFakeTimers();
          resetServerClockForTests();
          clearHttpValidatorCache();
          const run = install(healthy, [{ kind: 'delay', ms }]);
          const pending = outcomeOf(fetcher.run());
          await jest.advanceTimersByTimeAsync(Math.max(ms, fetcher.timeoutMs));
          const outcome = await pending;
          if (ms >= fetcher.timeoutMs) {
            expect(outcome.ok ? null : outcome.error).toBeInstanceOf(MeetCalApiTimeoutError);
            expect(dataCalls(run)[0].call.signal?.aborted).toBe(true);
          } else {
            expect(outcome.ok && fetcher.valid(outcome.value)).toBe(true);
          }
          expect(jest.getTimerCount()).toBe(0);
          jest.useRealTimers();
        },
      ),
    );
  });
});

// --- validator cache ----------------------------------------------------------

/**
 * A backend for `reference:wsoRecords` whose answer for each argument set
 * names that set (`wso` holds its key) and its version (`total_record`), so a
 * body served for the wrong key or a stale version is visible in the result.
 * The tag is a hash of the body, as `convex/lib/etag.ts` makes it.
 */
type WsoKey = { wso: string; ageCategory?: string; gender?: string };

function keyId(args: Record<string, unknown>): string {
  return JSON.stringify([args.wso, args.ageCategory ?? null, args.gender ?? null]);
}

function rowsFor(id: string, version: number): ApiWsoRecordRow[] {
  return [
    {
      wso: id,
      age_category: null,
      gender: null,
      weight_class: null,
      snatch_record: null,
      cj_record: null,
      total_record: version,
    },
  ];
}

function createServer() {
  const versions = new Map<string, number>();
  const version = (id: string) => versions.get(id) ?? 0;
  const answer = (call: ApiCall): unknown => {
    if (isClockCall(call)) return Date.now();
    if (call.fn !== 'reference:wsoRecords') throw new Error(`unexpected call to ${call.fn}`);
    const id = keyId(call.args);
    const etag = `"${id}@${version(id)}"`;
    if (call.args.ifNoneMatch === etag) return { etag };
    return { etag, json: JSON.stringify(rowsFor(id, version(id))) };
  };
  return { version, bump: (id: string) => versions.set(id, version(id) + 1), answer };
}

function fetchKey(key: WsoKey) {
  return fetchApiWsoRecords(key.wso, key.ageCategory, key.gender);
}

const wsoKeysArb = fc.uniqueArray(
  fc.record(
    {
      wso: fc.oneof(fc.constantFrom('Carolina', 'Florida', '__proto__', ''), hostileStringArb),
      ageCategory: fc.constantFrom('Senior', 'Junior', undefined),
      gender: fc.constantFrom('Men', 'Women', undefined),
    },
    { requiredKeys: ['wso'] },
  ),
  { minLength: 1, maxLength: 4, selector: (key) => keyId(key) },
);

/**
 * Faults for the cache properties, leaning on bodiless answers: the one
 * answer the client resolves from the cache. A garbage answer that is a
 * well-formed envelope with a body is indistinguishable from the server's
 * own, so it is left out: the client is right to believe it.
 */
const cacheFaultArb: fc.Arbitrary<TransportFault> = fc.oneof(
  settlingTransportFaultArb.filter(
    (fault) => fault.kind !== 'garbage' || !(isObject(fault.value) && ('body' in fault.value || 'json' in fault.value)),
  ),
  fc.constantFrom<TransportFault>(
    { kind: 'garbage', value: {} },
    { kind: 'garbage', value: { etag: null } },
    { kind: 'garbage', value: { etag: '"stale"' } },
  ),
);

type CacheOp =
  | { kind: 'fetch'; key: number; fault: TransportFault }
  | { kind: 'bump'; key: number }
  | { kind: 'clear' };

function cacheOpArb(keyCount: number): fc.Arbitrary<CacheOp> {
  const key = fc.nat({ max: keyCount - 1 });
  return fc.oneof(
    { weight: 4, arbitrary: fc.record({ kind: fc.constant('fetch' as const), key, fault: cacheFaultArb }) },
    { weight: 2, arbitrary: fc.record({ kind: fc.constant('bump' as const), key }) },
    { weight: 1, arbitrary: fc.constant<CacheOp>({ kind: 'clear' }) },
  );
}

/** The rows came from `id`'s own answers, at a version it has had. */
function expectFromKey(rows: readonly ApiWsoRecordRow[], id: string, newest: number) {
  expect(rows).toHaveLength(1);
  expect(rows[0].wso).toBe(id);
  expect(rows[0].total_record).toBeLessThanOrEqual(newest);
}

describe('validator cache under transport faults (chaos)', () => {
  it('never answers with another key\'s body, and a healthy call always gets the current one', async () => {
    await fc.assert(
      fc.asyncProperty(
        wsoKeysArb.chain((keys) => fc.tuple(fc.constant(keys), fc.array(cacheOpArb(keys.length), { maxLength: 12 }))),
        async ([keys, ops]) => {
          clearHttpValidatorCache();
          const server = createServer();
          const ids = keys.map(keyId);
          for (const op of ops) {
            if (op.kind === 'bump') {
              server.bump(ids[op.key]);
              continue;
            }
            if (op.kind === 'clear') {
              clearHttpValidatorCache();
              continue;
            }
            const run = install(server.answer as Transport, [op.fault]);
            const outcome = await outcomeOf(fetchKey(keys[op.key]));
            const id = ids[op.key];
            const healthyRun = dataCalls(run).every(({ fault }) => fault.kind === 'pass');
            if (healthyRun) {
              expect(outcome).toEqual({ ok: true, value: rowsFor(id, server.version(id)) });
            } else if (outcome.ok) {
              // A bodiless garbage answer (`{}`) is read as "unchanged": the
              // remembered body, possibly older, but this key's.
              expectFromKey(outcome.value as ApiWsoRecordRow[], id, server.version(id));
            } else {
              expect(outcome.error).toBeInstanceOf(Error);
            }
          }
          // No fault left anything behind that a healthy call would serve.
          install(server.answer as Transport, []);
          for (const [index, key] of keys.entries()) {
            await expect(fetchKey(key)).resolves.toEqual(rowsFor(ids[index], server.version(ids[index])));
          }
        },
      ),
    );
  });

  it('answers overlapping revalidations in any order with this key\'s body, never going back a version', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.scheduler(),
        wsoKeysArb.chain((keys) =>
          fc.tuple(
            fc.constant(keys),
            fc.array(
              fc.oneof(
                fc.record({ kind: fc.constant('fetch' as const), key: fc.nat({ max: keys.length - 1 }) }),
                fc.record({ kind: fc.constant('bump' as const), key: fc.nat({ max: keys.length - 1 }) }),
              ),
              { minLength: 1, maxLength: 10 },
            ),
          ),
        ),
        async (s, [keys, ops]) => {
          clearHttpValidatorCache();
          const server = createServer();
          const ids = keys.map(keyId);
          // The server reads its data when the call arrives; the answer lands
          // whenever the scheduler lets it.
          setApiTransportForTests(async (call) => {
            const answer = server.answer(call);
            return isClockCall(call) ? answer : s.schedule(Promise.resolve(answer), call.fn);
          });
          const resolved = new Map<string, number[]>();
          const work = ops.map((op) =>
            s.schedule(Promise.resolve(), op.kind).then(async () => {
              const id = ids[op.key];
              if (op.kind === 'bump') {
                server.bump(id);
                return;
              }
              const rows = await fetchKey(keys[op.key]);
              expectFromKey(rows, id, server.version(id));
              resolved.set(id, [...(resolved.get(id) ?? []), rows[0].total_record ?? -1]);
            }),
          );
          await s.waitFor(Promise.all(work));
          for (const versions of resolved.values()) {
            expect(versions).toEqual([...versions].sort((a, b) => a - b));
          }
          setApiTransportForTests(server.answer as Transport);
          for (const [index, key] of keys.entries()) {
            await expect(fetchKey(key)).resolves.toEqual(rowsFor(ids[index], server.version(ids[index])));
          }
        },
      ),
    );
  });
});
