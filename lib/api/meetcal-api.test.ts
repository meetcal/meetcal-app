/**
 * @jest-environment-options {"deviceTimeZone": "Pacific/Auckland"}
 */
import {
  clearHttpValidatorCache,
  deleteSavedSession,
  deleteSavedSessions,
  fetchApiAdaptiveRecords,
  fetchApiAthletes,
  fetchApiAthletesWithSession,
  fetchApiClubAthletes,
  fetchApiClubMeetStats,
  fetchApiClubNames,
  fetchApiIntlRankings,
  fetchApiMeetByName,
  fetchApiMeetPackageConditional,
  fetchApiMeets,
  fetchApiNationalRankings,
  fetchApiQualifyingTotals,
  fetchApiRecentResultsByNames,
  fetchApiRecords,
  fetchApiResultsByNames,
  fetchApiSchedule,
  fetchApiStandards,
  fetchApiYearBestsByNames,
  fetchApiWsoAgeGroups,
  fetchApiYearBests,
  fetchApiWsoList,
  fetchApiWsoRecords,
  fetchSavedSessions,
  fetchUserPreferences,
  formatApiTime,
  mapApiAthlete,
  mapApiAthletes,
  mapApiLiftingResult,
  mapApiMeet,
  mapApiSchedule,
  mapApiYearBests,
  mapPackageSchedule,
  MEET_PACKAGE_INCLUDE,
  MEET_PACKAGE_TIMEOUT_MS,
  getServerClockSample,
  getServerClockSkewMs,
  getTrustedNow,
  MAX_PLAUSIBLE_CLOCK_SKEW_MS,
  MeetCalApiError,
  resetServerClockForTests,
  MeetCalApiTimeoutError,
  NAMES_QUERY_CHUNK_SIZE,
  normalizePlatform,
  SERVER_CLOCK_RESAMPLE_MS,
  SMALL_ROWS_NAMES_CHUNK_SIZE,
  patchAutoUnsavePreference,
  putSavedSession,
  searchApi,
} from './meetcal-api';
import { HTTP_VALIDATOR_CACHE_LIMIT } from './http-cache';
import { callQuery, isClockCall } from './json-transport-stub';
import { setApiTransportForTests, TransportRequestError, type ApiCall } from './transport';
import { UNKNOWN_PLATFORM } from '@/data/types/athletes';
import { generateSessionId } from '@/utils/session';
import {
  ATTEMPT_HISTORY_YEARS,
  getHistoryCutoffDate,
  YEAR_BESTS_YEARS,
} from '@/utils/dateTime';

/** The client's per-call default (`DEFAULT_TIMEOUT_MS` in meetcal-api.ts). */
const DEFAULT_TIMEOUT_MS = 10000;
/** How long the first request waits for its clock sample (`SERVER_CLOCK_FIRST_SAMPLE_GRACE_MS`). */
const FIRST_SAMPLE_GRACE_MS = 2000;
const HOUR_MS = 60 * 60 * 1000;

// --- fake transport ---------------------------------------------------------

type Responder = (call: ApiCall) => unknown;

/**
 * Swaps in a fake transport. Clock calls (`system:serverTime`) never reach
 * `respond`: `clock` answers them, by default with the device clock, so the
 * first request's wait for its clock sample never stalls a test.
 */
function installTransport(respond: Responder, clock: Responder = () => Date.now()) {
  const transport = jest.fn(
    async (call: ApiCall): Promise<unknown> => (isClockCall(call) ? clock(call) : respond(call)),
  );
  setApiTransportForTests(transport);
  const allCalls = (): ApiCall[] => transport.mock.calls.map(([call]) => call);
  const dataCalls = (): ApiCall[] => allCalls().filter((call) => !isClockCall(call));
  const clockCalls = (): ApiCall[] => allCalls().filter((call) => isClockCall(call));
  const lastCall = (): ApiCall => {
    const calls = dataCalls();
    if (calls.length === 0) throw new Error('no data call was made');
    return calls[calls.length - 1];
  };
  return { transport, dataCalls, clockCalls, lastCall };
}

/** Answers every call with `body`; a conditional query gets it as `{ etag, body }`. */
function answer(body: unknown, etag: string | null = null): Responder {
  return (call) => (call.conditional ? { etag, body } : body);
}

/** What a Convex function's `ConvexError({ status, error })` reaches the client as. */
function apiFailure(status: number, data: Record<string, unknown> = { error: 'failed' }) {
  return new TransportRequestError(
    `query failed with ${status}`,
    status,
    JSON.stringify({ status, ...data }),
  );
}

type Reply = { etag?: string | null; body?: unknown; json?: unknown } | { fail: number };

/** Answers data calls from `replies` in order; `{ fail }` rejects with that status. */
function queueTransport(replies: Reply[]) {
  const fake = installTransport(() => {
    const reply = replies.shift();
    if (!reply) throw new Error('unexpected call');
    if ('fail' in reply) throw apiFailure(reply.fail);
    return reply;
  });
  return { ...fake, sentTag: (index: number) => fake.dataCalls()[index].args.ifNoneMatch };
}

function never(): Promise<never> {
  return new Promise<never>(() => {});
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

function meetRow(name: string, venue = 'Hall') {
  return {
    name,
    start_date: '2026-06-20',
    end_date: '2026-06-21',
    time_zone: 'America/New_York',
    status: 'upcoming',
    venue_name: venue,
    venue_city: 'City',
    venue_state: 'ST',
    venue_street: '1 Main',
    venue_zip: '00000',
  };
}

beforeEach(() => {
  resetServerClockForTests();
  clearHttpValidatorCache();
  // The `__DEV__` slow-request log fires whenever fake time passes 500ms.
  jest.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  setApiTransportForTests(null);
  resetServerClockForTests();
  clearHttpValidatorCache();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('meetcal API client', () => {
  it('carries the Clerk token on authenticated calls and never on public reads or the clock', async () => {
    const { lastCall, clockCalls } = installTransport((call) =>
      call.fn === 'users:preferences' ? { auto_unsave_started_sessions: true } : answer([])(call),
    );

    await expect(fetchUserPreferences('clerk-token')).resolves.toEqual({
      auto_unsave_started_sessions: true,
    });
    expect(lastCall()).toEqual({
      path: '/users/me/preferences',
      fn: 'users:preferences',
      kind: 'query',
      args: {},
      token: 'clerk-token',
    });

    await fetchApiClubNames();
    expect(lastCall().fn).toBe('reference:clubs');
    expect(lastCall().token).toBeUndefined();
    // The clock mutation that rode alongside the signed-in call is public too.
    expect(clockCalls().length).toBeGreaterThan(0);
    expect(clockCalls().every((call) => call.token === undefined)).toBe(true);
  });

  it('reads plain array list endpoints', async () => {
    const { dataCalls } = installTransport(answer(['Carolina', 'Ohio']));

    await expect(fetchApiWsoList()).resolves.toEqual(['Carolina', 'Ohio']);
    await expect(fetchApiWsoAgeGroups('Carolina')).resolves.toEqual(['Carolina', 'Ohio']);
    await expect(fetchApiClubNames()).resolves.toEqual(['Carolina', 'Ohio']);

    expect(dataCalls().map(({ fn, args }) => [fn, args])).toEqual([
      ['reference:wsoList', {}],
      ['reference:wsoAgeGroups', { wso: 'Carolina' }],
      ['reference:clubs', {}],
    ]);
    expect(dataCalls().every((call) => call.kind === 'query' && call.conditional === true)).toBe(true);
  });

  it('rejects the retired wrapped WSO list shape', async () => {
    installTransport(answer({ wsos: ['Carolina', 'Ohio'] }));

    await expect(fetchApiWsoList()).rejects.toThrow('/data/wso/ expected an array response');
  });

  it('sends name lists as one array argument, so a comma inside a name stays one name', async () => {
    const { lastCall } = installTransport(answer([]));

    await fetchApiResultsByNames(['Nordstrom, Alexander', 'Athlete B']);

    expect(lastCall()).toMatchObject({
      path: '/lifting-results/by-names',
      fn: 'results:byNames',
      kind: 'query',
    });
    expect(lastCall().args.names).toEqual(['Nordstrom, Alexander', 'Athlete B']);
    expect(lastCall().args.latestOnly).toBeUndefined();
  });

  it('always sends a cutoff for recent results, defaulting to the shared history window', async () => {
    const { lastCall } = installTransport(answer([]));

    await fetchApiRecentResultsByNames(['Athlete A']);

    expect(lastCall().fn).toBe('results:recent');
    expect(lastCall().args.names).toEqual(['Athlete A']);
    expect(lastCall().args.cutoffDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // One cutoff policy: the UTC-only `getHistoryCutoffDate`, not a second
    // device-local copy of the same arithmetic.
    expect(lastCall().args.cutoffDate).toBe(getHistoryCutoffDate(ATTEMPT_HISTORY_YEARS));
  });

  it('defaults the year-bests cutoff to the shared one-year window', async () => {
    const { lastCall } = installTransport(answer([]));

    await fetchApiYearBestsByNames(['Athlete A']);

    expect(lastCall().fn).toBe('results:bests');
    expect(lastCall().args.cutoffDate).toBe(getHistoryCutoffDate(YEAR_BESTS_YEARS));
  });

  it.each<[string, () => Promise<unknown>, Partial<ApiCall>, unknown]>([
    [
      'fetchApiMeetByName',
      () => fetchApiMeetByName('Test Meet'),
      { path: '/meets/details', fn: 'meets:details', args: { meet: 'Test Meet' }, conditional: true },
      meetRow('Test Meet'),
    ],
    [
      'fetchApiAthletes',
      () => fetchApiAthletes('Test Meet' as never),
      { path: '/meets/athletes', fn: 'meets:athletes', args: { meet: 'Test Meet' } },
      [],
    ],
    [
      'fetchApiYearBests',
      () => fetchApiYearBests('Athlete A', '2025-06-20'),
      {
        path: '/lifting-results/year',
        fn: 'results:yearBests',
        args: { name: 'Athlete A', cutoffDate: '2025-06-20' },
      },
      { best_snatch: 100, best_cj: 120, best_total: 220 },
    ],
    [
      'searchApi',
      () => searchApi('Athlete', '2025-01-01', '2025-12-31'),
      {
        path: '/search',
        fn: 'results:search',
        args: { query: 'Athlete', startDate: '2025-01-01', endDate: '2025-12-31' },
      },
      { matched_name: null, suggestions: [], results: [] },
    ],
    [
      'fetchApiRecords',
      () => fetchApiRecords(),
      { path: '/data/records', fn: 'reference:records', args: {}, conditional: true },
      [],
    ],
    [
      'fetchApiStandards',
      () => fetchApiStandards(),
      { path: '/data/standards', fn: 'reference:standards', args: {}, conditional: true },
      [],
    ],
    [
      'fetchApiQualifyingTotals',
      () => fetchApiQualifyingTotals(),
      { path: '/data/qualifying-totals', fn: 'reference:qualifyingTotals', args: {}, conditional: true },
      [],
    ],
    [
      'fetchApiIntlRankings',
      () => fetchApiIntlRankings(),
      { path: '/data/intl-rankings', fn: 'reference:intlRankings', args: {}, conditional: true },
      [],
    ],
    [
      'fetchApiNationalRankings',
      () => fetchApiNationalRankings('USAW', 'Senior 89'),
      {
        path: '/data/nat-rankings',
        fn: 'reference:nationalRankings',
        args: { federation: 'USAW', ageCategory: 'Senior 89' },
        conditional: true,
      },
      [],
    ],
    [
      'fetchApiWsoRecords',
      () => fetchApiWsoRecords('Ohio', 'Senior', 'Men'),
      {
        path: '/data/wso/records',
        fn: 'reference:wsoRecords',
        args: { wso: 'Ohio', ageCategory: 'Senior', gender: 'Men' },
        conditional: true,
      },
      [],
    ],
    [
      'fetchApiAdaptiveRecords',
      () => fetchApiAdaptiveRecords('Men', 'BWL'),
      {
        path: '/data/adaptive',
        fn: 'reference:adaptiveRecords',
        args: { gender: 'Men', excludeFederation: 'BWL' },
        conditional: true,
      },
      [],
    ],
    [
      'fetchApiClubAthletes',
      () => fetchApiClubAthletes('Club A'),
      { path: '/clubs/athletes', fn: 'reference:clubAthletes', args: { club: 'Club A' } },
      [],
    ],
    [
      'fetchApiClubMeetStats',
      () => fetchApiClubMeetStats('Club A', 'Test Meet'),
      {
        path: '/clubs/meet-stats',
        fn: 'reference:clubMeetStats',
        args: { club: 'Club A', meet: 'Test Meet' },
      },
      {},
    ],
  ])('%s makes one public query call with the route arguments', async (_name, invoke, expected, body) => {
    const { dataCalls } = installTransport(answer(body));

    await invoke();

    expect(dataCalls()).toHaveLength(1);
    const [call] = dataCalls();
    expect(call.path).toBe(expected.path);
    expect(call.fn).toBe(expected.fn);
    expect(call.kind).toBe('query');
    // `toEqual` ignores an `ifNoneMatch: undefined` member, which is what a
    // first conditional read sends.
    expect(call.args).toEqual(expected.args);
    expect(call.args.ifNoneMatch).toBeUndefined();
    expect(call.conditional === true).toBe(expected.conditional === true);
    expect(call.token).toBeUndefined();
  });

  it('skips the details request when the caller already has the meet', async () => {
    const { dataCalls, transport } = installTransport((call) =>
      call.fn === 'meets:schedule'
        ? answer([
            {
              date: '2026-06-20',
              platform: 'Red',
              session_id: 1,
              start_time: '09:00:00',
              weigh_in_time: '07:00:00',
              weight_class: '60kg',
            },
          ])(call)
        : answer({
            name: 'Test Meet',
            start_date: '2026-06-20',
            end_date: '2026-06-21',
            time_zone: 'America/Los_Angeles',
            venue_name: 'Venue',
            venue_street: '1 Main',
            venue_city: 'LA',
            venue_state: 'CA',
            venue_zip: '90001',
            status: 'upcoming',
          })(call),
    );
    const meet = mapApiMeet({
      name: 'Test Meet',
      status: 'upcoming',
      start_date: '2026-06-20',
      end_date: '2026-06-21',
      time_zone: 'America/Los_Angeles',
      venue_name: 'Venue',
      venue_street: '1 Main',
      venue_city: 'LA',
      venue_state: 'CA',
      venue_zip: '90001',
    });

    const schedule = await fetchApiSchedule('Test Meet', meet);

    expect(dataCalls().map((call) => call.fn)).toEqual(['meets:schedule']);
    expect(dataCalls()[0].args).toEqual({ meet: 'Test Meet' });
    expect(schedule[0].date).toBe('June 20, 2026');

    // Without the meet the details request still rides alongside.
    transport.mockClear();
    await fetchApiSchedule('Test Meet');
    expect(dataCalls().map((call) => call.fn).sort()).toEqual(['meets:details', 'meets:schedule']);
  });

  it('revalidates the meet package with ifNoneMatch and honours an answer without a body', async () => {
    const { lastCall } = installTransport(() => ({ etag: '"abc"' }));

    await expect(
      fetchApiMeetPackageConditional('Test Meet' as never, '2024-01-01', '"abc"'),
    ).resolves.toEqual({ status: 'not_modified' });
    expect(lastCall()).toEqual({
      path: '/meets/package',
      fn: 'meets:packageForMeet',
      kind: 'query',
      conditional: true,
      args: {
        meet: 'Test Meet',
        historyCutoffDate: '2024-01-01',
        include: ['year_bests'],
        ifNoneMatch: '"abc"',
      },
    });
  });

  it('trusts a bodiless package answer only for the tag the caller holds', async () => {
    // No tag in the answer: it can only be vouching for the one that was sent.
    installTransport(() => ({}));
    await expect(
      fetchApiMeetPackageConditional('Test Meet' as never, '2024-01-01', '"abc"'),
    ).resolves.toEqual({ status: 'not_modified' });

    // A different tag, or no tag sent at all, leaves the caller with nothing.
    installTransport(() => ({ etag: '"other"' }));
    await expect(
      fetchApiMeetPackageConditional('Test Meet' as never, '2024-01-01', '"abc"'),
    ).rejects.toThrow('/meets/package answered without a body');
    await expect(
      fetchApiMeetPackageConditional('Test Meet' as never, '2024-01-01', null),
    ).rejects.toThrow('/meets/package answered without a body');

    // Not the `{ etag, body }` envelope at all.
    installTransport(() => null);
    await expect(fetchApiMeetPackageConditional('Test Meet' as never)).rejects.toThrow(
      '/meets/package expected an object response',
    );
  });

  it('asks the package for the year-bests section only and tolerates the rest being absent', async () => {
    const { lastCall } = installTransport(answer({ meet: {}, schedule: [], athletes: [], meet_results: [] }));

    const fetched = await fetchApiMeetPackageConditional('Test Meet', '2024-01-01', null);
    expect(fetched.status).toBe('fresh');
    if (fetched.status === 'fresh') {
      expect(fetched.package.recent_results_by_name).toBeUndefined();
      expect(fetched.package.attempt_estimates).toBeUndefined();
      expect(fetched.package.year_bests_by_name).toBeUndefined();
    }
    expect(MEET_PACKAGE_INCLUDE).toEqual(['year_bests']);
    expect(lastCall().args.include).toEqual(['year_bests']);
    // A copy, so nothing downstream can edit the exported constant.
    expect(lastCall().args.include).not.toBe(MEET_PACKAGE_INCLUDE);
  });

  it('returns the package and its etag on a fresh answer', async () => {
    const pkg = { meet: {}, schedule: [], athletes: [], meet_results: [] };
    const { lastCall } = installTransport(answer(pkg, '"def"'));

    await expect(
      fetchApiMeetPackageConditional('Test Meet' as never, '2024-01-01', null),
    ).resolves.toEqual({ status: 'fresh', etag: '"def"', package: pkg });
    expect(lastCall().args.ifNoneMatch).toBeUndefined();
  });

  it('turns the package year_bests list into the name-keyed map the app reads', async () => {
    const wire = {
      meet: {},
      schedule: [],
      athletes: [],
      meet_results: [],
      year_bests: [
        { name: 'Andrés Álvarez', best_snatch: 95, best_cj: 110, best_total: 205 },
        { name: 'Athlete B', best_snatch: 0, best_cj: 0, best_total: 0 },
      ],
    };
    installTransport(answer(wire, '"pkg"'));

    const fetched = await fetchApiMeetPackageConditional('Test Meet' as never, '2024-01-01', null);

    if (fetched.status !== 'fresh') throw new Error('expected a fresh package');
    expect(fetched.etag).toBe('"pkg"');
    expect(fetched.package).toEqual({
      meet: {},
      schedule: [],
      athletes: [],
      meet_results: [],
      year_bests_by_name: {
        'Andrés Álvarez': { best_snatch: 95, best_cj: 110, best_total: 205 },
        'Athlete B': { best_snatch: 0, best_cj: 0, best_total: 0 },
      },
    });
    expect('year_bests' in fetched.package).toBe(false);

    installTransport(answer({ ...wire, year_bests: [] }));
    const empty = await fetchApiMeetPackageConditional('Test Meet' as never);
    expect(empty.status === 'fresh' && empty.package.year_bests_by_name).toEqual({});
  });

  it.each<[string, unknown, string]>([
    ['not a list', { 'Athlete A': { best_snatch: 1, best_cj: 1, best_total: 2 } }, '/meets/package.year_bests expected an array response'],
    ['a row missing a best', [{ name: 'A', best_snatch: 1, best_cj: 1, best_total: 2 }, { name: 'B', best_snatch: 1, best_cj: 1 }], '/meets/package.year_bests[1] missing fields: best_total'],
    ['a row without a name', [{ best_snatch: 1, best_cj: 1, best_total: 2 }], '/meets/package.year_bests[0] missing fields: name'],
    ['a non-string name', [{ name: 7, best_snatch: 1, best_cj: 1, best_total: 2 }], '/meets/package.year_bests[0] has invalid name'],
    ['a non-object row', [null], '/meets/package.year_bests[0] expected an object response'],
  ])('rejects a package whose year_bests is %s', async (_case, yearBests, message) => {
    installTransport(answer({ meet: {}, schedule: [], athletes: [], meet_results: [], year_bests: yearBests }));

    await expect(fetchApiMeetPackageConditional('Test Meet' as never)).rejects.toThrow(message);
  });

  it('gives the package call its own, longer timeout', async () => {
    jest.useFakeTimers();
    installTransport(() => never());
    let settled = false;
    const pending = fetchApiMeetPackageConditional('Test Meet' as never)
      .catch((error: unknown) => error)
      .finally(() => {
        settled = true;
      });

    await flushMicrotasks();
    jest.advanceTimersByTime(DEFAULT_TIMEOUT_MS);
    await flushMicrotasks();
    expect(settled).toBe(false);

    jest.advanceTimersByTime(MEET_PACKAGE_TIMEOUT_MS - DEFAULT_TIMEOUT_MS);
    const failure = await pending;
    expect(failure).toBeInstanceOf(MeetCalApiTimeoutError);
    expect((failure as MeetCalApiTimeoutError).message).toBe(
      `GET /meets/package timed out after ${MEET_PACKAGE_TIMEOUT_MS}ms`,
    );
    expect((failure as MeetCalApiTimeoutError).timeoutMs).toBe(MEET_PACKAGE_TIMEOUT_MS);
  });

  it('sends batch year bests with the cutoff and maps the named list back to a map', async () => {
    const { lastCall } = installTransport(
      answer([
        { name: 'Athlete A', best_snatch: 100, best_cj: 120, best_total: 220 },
        { name: 'Athlete B', best_snatch: 90, best_cj: 110, best_total: 200 },
      ]),
    );

    await expect(
      fetchApiYearBestsByNames(['Athlete A', 'Athlete B'], '2025-06-19'),
    ).resolves.toEqual({
      'Athlete A': { bestSnatch: 100, bestCJ: 120, bestTotal: 220 },
      'Athlete B': { bestSnatch: 90, bestCJ: 110, bestTotal: 200 },
    });

    expect(lastCall()).toEqual({
      path: '/lifting-results/bests',
      fn: 'results:bests',
      kind: 'query',
      args: { names: ['Athlete A', 'Athlete B'], cutoffDate: '2025-06-19' },
    });
  });

  it('keys batch year bests by names that are not ASCII', async () => {
    // Convex object keys must be ASCII, which is why the wire format is a list.
    const names = ['Andrés Álvarez', 'Zoë Ørsted', '李娜', 'Nordstrom, Alexander'];
    const { lastCall } = installTransport(
      answer(names.map((name, i) => ({ name, best_snatch: 80 + i, best_cj: 100 + i, best_total: 180 + 2 * i }))),
    );

    const bests = await fetchApiYearBestsByNames(names, '2025-06-19');

    expect(lastCall().args.names).toEqual(names);
    expect(Object.keys(bests)).toEqual(names);
    expect(bests['Andrés Álvarez']).toEqual({ bestSnatch: 80, bestCJ: 100, bestTotal: 180 });
    expect(bests['李娜']).toEqual({ bestSnatch: 82, bestCJ: 102, bestTotal: 184 });
  });

  it('rejects a malformed batch year-bests row, naming its index', async () => {
    const good = { name: 'Athlete A', best_snatch: 100, best_cj: 120, best_total: 220 };

    installTransport(answer([good, { name: 'Athlete B', best_snatch: 100, best_cj: 120 }]));
    await expect(fetchApiYearBestsByNames(['Athlete A', 'Athlete B'])).rejects.toThrow(
      '/lifting-results/bests[1] missing fields: best_total',
    );

    installTransport(answer([good, { best_snatch: 1, best_cj: 1, best_total: 2 }]));
    await expect(fetchApiYearBestsByNames(['Athlete A', 'Athlete B'])).rejects.toThrow(
      '/lifting-results/bests[1] missing fields: name',
    );

    installTransport(answer([{ ...good, name: 42 }]));
    await expect(fetchApiYearBestsByNames(['Athlete A'])).rejects.toThrow(
      '/lifting-results/bests[0] has invalid name',
    );

    installTransport(answer([good, null]));
    await expect(fetchApiYearBestsByNames(['Athlete A'])).rejects.toThrow(
      '/lifting-results/bests[1] expected an object response',
    );
  });

  it('rejects the retired name-keyed map shape for batch year bests', async () => {
    installTransport(answer({ 'Athlete A': { best_snatch: 100, best_cj: 120, best_total: 220 } }));

    await expect(fetchApiYearBestsByNames(['Athlete A'])).rejects.toThrow(
      '/lifting-results/bests expected an array response',
    );
  });

  it('throws when runtime response validation fails', async () => {
    installTransport(answer({ names: ['not', 'an', 'array'] }));

    await expect(fetchApiMeets()).rejects.toThrow('/meets expected an array response');
  });
});

describe('meetcal API mappers', () => {
  it('maps meet, schedule, athlete, result, and best rows into app shapes', () => {
    const meet = mapApiMeet({
      id: 'meet-1',
      name: 'Test Meet',
      federation: 'USAW',
      status: 'upcoming',
      start_date: '2026-06-20',
      end_date: '2026-06-21',
      time_zone: 'America/New_York',
      venue_name: 'Test Venue',
      venue_street: '1 Main',
      venue_city: 'Columbus',
      venue_state: 'OH',
      venue_zip: '43215',
    });

    expect(meet.name).toBe('Test Meet');
    expect(meet.venue.address.state).toBe('OH');
    expect(meet.time.timeZoneIdentifier).toBe('America/New_York');

    const schedule = mapApiSchedule([
      {
        date: '2026-06-20',
        meet: 'Test Meet',
        platform: 'blue',
        session_id: 2,
        start_time: '13:30:00',
        weigh_in_time: '11:30:00',
        weight_class: '73kg',
      },
    ], meet);

    expect(schedule[0].sessions[0].number).toBe(2);
    expect(schedule[0].sessions[0].startTime).toBe('1:30 PM');
    expect(schedule[0].sessions[0].platforms[0]).toEqual({
      platform: 'Blue',
      weightClass: '73kg',
      platformStartTime: '1:30 PM',
    });

    const athlete = mapApiAthlete({
      member_id: '123',
      adaptive: false,
      age: 24,
      club: 'Club',
      entry_total: 250,
      gender: 'Men',
      meet: 'Test Meet',
      name: 'Athlete A',
      session_number: 2,
      session_platform: 'Blue',
      weight_class: '73kg',
      wso: null,
    });

    expect(athlete).toMatchObject({
      memberId: '123',
      entryTotal: 250,
      session: { number: 2, platform: 'Blue' },
    });

    expect(mapApiLiftingResult({
      id: 10,
      event_id: 'event-1',
      federation: 'USAW',
      meet: 'Test Meet',
      date: '2026-06-20',
      name: 'Athlete A',
      age: 'Open Men 73kg',
      body_weight: 72.5,
      snatch1: 100,
      snatch2: 105,
      snatch3: 0,
      snatch_best: 105,
      cj1: 130,
      cj2: 135,
      cj3: 0,
      cj_best: 135,
      total: 240,
      adaptive: false,
    })).toMatchObject({
      id: 10,
      event_id: 'event-1',
      body_weight: 72.5,
      snatch_best: 105,
      cj_best: 135,
    });

    expect(mapApiYearBests({
      best_snatch: 105,
      best_cj: 135,
      best_total: 240,
    })).toEqual({
      bestSnatch: 105,
      bestCJ: 135,
      bestTotal: 240,
    });
  });

  it('maps package schedules into existing offline schedule shape', () => {
    const schedule = mapPackageSchedule({
      meet: {
        id: 'meet-1',
        name: 'Test Meet',
        federation: 'USAW',
        status: 'upcoming',
        start_date: '2026-06-20',
        end_date: '2026-06-21',
        time_zone: 'America/New_York',
        venue_name: 'Test Venue',
        venue_street: '1 Main',
        venue_city: 'Columbus',
        venue_state: 'OH',
        venue_zip: '43215',
      },
      schedule: [
        {
          date: '2026-06-20',
          sessions: [
            {
              session_id: 1,
              start_time: '08:00:00',
              weigh_in_time: '06:00:00',
              platforms: [
                { platform: 'Red', weight_class: '60kg' },
                { platform: 'White', weight_class: '65kg' },
              ],
            },
          ],
        },
      ],
      athletes: [],
      meet_results: [],
      attempt_estimates: [],
      year_bests_by_name: {},
      recent_results_by_name: {},
    });

    expect(schedule).toHaveLength(1);
    expect(schedule[0].sessions[0].platforms).toHaveLength(2);
    expect(formatApiTime('08:00:00')).toBe('8:00 AM');
  });

  it('keeps a Gold schedule platform as Gold and canonicalizes casing, never remapping to Red', () => {
    const schedule = mapApiSchedule([
      { date: '2026-06-20', meet: 'Test Meet', platform: 'RED ', session_id: 1, start_time: '08:00', weigh_in_time: '06:00', weight_class: '60kg' },
      { date: '2026-06-20', meet: 'Test Meet', platform: 'gold', session_id: 1, start_time: '08:00', weigh_in_time: '06:00', weight_class: '65kg' },
      { date: '2026-06-20', meet: 'Test Meet', platform: 'stars & stripes', session_id: 2, start_time: '10:00', weigh_in_time: '08:00', weight_class: '71kg' },
      { date: '2026-06-20', meet: 'Test Meet', platform: '  ', session_id: 3, start_time: '12:00', weigh_in_time: '10:00', weight_class: '81kg' },
    ]);
    const sessions = schedule[0].sessions;
    expect(sessions[0].platforms.map((p) => p.platform)).toEqual(['Red', 'Gold']);
    expect(sessions[1].platforms.map((p) => p.platform)).toEqual(['Stars & Stripes']);
    expect(sessions[2].platforms.map((p) => p.platform)).toEqual([UNKNOWN_PLATFORM]);
    expect(normalizePlatform('unknown-color')).toBe('Unknown-color');
  });

  it('gives Red and Gold athletes in one session distinct platforms and session ids', () => {
    const base = {
      member_id: '1', name: 'Athlete A', adaptive: false, age: 24, club: 'Club',
      entry_total: 250, gender: 'Men', weight_class: '73kg', session_number: 4,
    };
    const red = mapApiAthlete({ ...base, session_platform: 'Red' });
    const gold = mapApiAthlete({ ...base, member_id: '2', name: 'Athlete B', session_platform: 'Gold' });
    expect(red.session?.platform).toBe('Red');
    expect(gold.session?.platform).toBe('Gold');
    expect(generateSessionId('Test Meet' as never, 4, red.session!.platform)).not.toBe(
      generateSessionId('Test Meet' as never, 4, gold.session!.platform),
    );
  });

  it('keeps lifting-result age as the API category string', () => {
    expect(mapApiLiftingResult({
      meet: 'Test Meet',
      date: '2026-06-20',
      name: 'Athlete A',
      age: 'Open Men 73kg',
      body_weight: 72.5,
      snatch1: 100,
      snatch2: 105,
      snatch3: 0,
      snatch_best: 105,
      cj1: 130,
      cj2: 135,
      cj3: 0,
      cj_best: 135,
      total: 240,
    }).age).toBe('Open Men 73kg');
  });

  it.each([
    null,
    { name: 123 },
    { name: '   ' },
    { name: 'Athlete A', session_number: 0, session_platform: 'Red' },
  ])(
    'rejects unsalvageable athlete fields at the API mapper: %p', (invalid) => {
      const row = invalid === null ? null : {
        member_id: '123', adaptive: false, age: 24, club: 'Club',
        entry_total: 250, gender: 'Men', weight_class: '73kg',
        ...invalid,
      };
      expect(() => mapApiAthlete(row as never)).toThrow(/athlete/);
    },
  );

  it('defaults nullable club and entry total instead of failing the row', () => {
    const athlete = mapApiAthlete({
      member_id: '123', name: 'Athlete A', adaptive: false, age: 24,
      club: null, entry_total: null, gender: 'Men', weight_class: '73kg',
    } as never);
    expect(athlete.club).toBe('');
    expect(athlete.entryTotal).toBe(0);
    expect(mapApiAthlete({
      member_id: '123', name: 'Athlete A', adaptive: false, age: 24,
      club: 'Club', entry_total: '250', gender: 'Men', weight_class: '73kg',
    } as never).entryTotal).toBe(250);
  });

  it('drops only the unsalvageable rows from a roster', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const base = {
      member_id: '1', adaptive: false, age: 24, club: 'Club',
      entry_total: 250, gender: 'Men', weight_class: '73kg',
    };
    const athletes = mapApiAthletes(
      [
        { ...base, name: 'Athlete A' },
        { ...base, name: '' },
        { ...base, name: 'Athlete B', club: null },
      ] as never,
      '/meets/athletes',
    );
    expect(athletes.map((athlete) => athlete.name)).toEqual(['Athlete A', 'Athlete B']);
    expect(warn).toHaveBeenCalledWith(
      '[api] /meets/athletes: dropped 1 of 3 malformed athlete rows',
    );
    warn.mockRestore();
  });

  it('coerces missing athlete ages to 0 rather than NaN', () => {
    expect(mapApiAthlete({
      member_id: '123',
      adaptive: false,
      age: Number.NaN,
      club: 'Club',
      entry_total: 250,
      gender: 'Men',
      name: 'Athlete A',
      weight_class: '73kg',
    }).age).toBe(0);
  });

  it('drops invalid clock strings instead of echoing them', () => {
    expect(formatApiTime('not-a-time')).toBe('');
    expect(formatApiTime('25:99')).toBe('');
  });

  it('titles schedule days in the meet zone and never renders "Invalid Date"', () => {
    const row = {
      meet: 'Test Meet',
      platform: 'Red',
      session_id: 1,
      start_time: '09:00:00',
      weigh_in_time: '07:00:00',
      weight_class: '60kg',
    };
    // A device far east of the meet: a device-local anchor would flip the
    // day. The file's docblock pins the device zone
    // (jest/device-timezone-environment.js); assigning process.env.TZ in a
    // test would not change it.
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Pacific/Auckland');
    const schedule = mapApiSchedule([
      { ...row, date: '2026-06-20' },
      { ...row, date: '2026-06-21T00:00:00' },
      { ...row, date: 'TBD' },
    ]);
    expect(schedule.map((day) => day.date)).toEqual([
      'June 20, 2026',
      'June 21, 2026',
      'TBD',
    ]);
    expect(schedule[2].fullDate).toBe('TBD');
  });

  it('computes New York DST offset from the meet date, not the device zone', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Pacific/Auckland');
    const summer = mapApiMeet({
      name: 'Summer Meet',
      federation: 'USAW',
      status: 'upcoming',
      start_date: '2026-06-20',
      end_date: '2026-06-21',
      time_zone: 'America/New_York',
      venue_name: 'Venue',
      venue_street: '1 Main',
      venue_city: 'Columbus',
      venue_state: 'OH',
      venue_zip: '43215',
    });
    const winter = mapApiMeet({
      name: 'Winter Meet',
      federation: 'USAW',
      status: 'upcoming',
      start_date: '2026-01-15',
      end_date: '2026-01-16',
      time_zone: 'America/New_York',
      venue_name: 'Venue',
      venue_street: '1 Main',
      venue_city: 'Columbus',
      venue_state: 'OH',
      venue_zip: '43215',
    });
    expect(summer.time.utcOffset).toBe(4);
    expect(winter.time.utcOffset).toBe(5);
    // `time.abbreviation` is the single source of truth every screen renders
    // next to a session time, so it has to be resolved at the *meet's* date.
    // `getTimeZoneAbbreviation(id)` with no instant formats today instead, and
    // the screens that called it that way showed "EDT" on a December meet.
    expect(summer.time.abbreviation).toBe('EDT');
    expect(winter.time.abbreviation).toBe('EST');
  });

  it('falls unknown IANA zones back to America/New_York for identifier math', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const meet = mapApiMeet({
      name: 'Mystery Meet',
      federation: 'USAW',
      status: 'not-a-status',
      start_date: '2026-06-20',
      end_date: '2026-06-21',
      time_zone: 'Not/AZone',
      venue_name: 'Venue',
      venue_street: '1 Main',
      venue_city: 'Columbus',
      venue_state: 'OH',
      venue_zip: '43215',
    });
    expect(meet.time.timeZoneIdentifier).toBe('America/New_York');
    expect(meet.status).toBe('upcoming');
    expect(meet.timeZoneUnknown).toBe(true);
    // Not only in __DEV__: this is the one signal that the meet's times are
    // being shown in the wrong zone.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown meet time zone'));
    warn.mockRestore();
  });

  it('keeps offset, abbreviation and identifier consistent when the zone is unknown', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    // A real IANA zone the app does not support. `utcOffset` used to come
    // from the raw zone (Europe/London: -1) while every conversion used the
    // New York fallback (+4).
    const meet = mapApiMeet({
      name: 'Abroad Meet',
      status: 'upcoming',
      start_date: '2026-06-20',
      end_date: '2026-06-21',
      time_zone: 'Europe/London',
      venue_name: 'Venue',
      venue_street: '1 Main',
      venue_city: 'London',
      venue_state: '',
      venue_zip: '',
    });
    expect(meet.timeZoneUnknown).toBe(true);
    expect(meet.time.timeZoneIdentifier).toBe('America/New_York');
    expect(meet.time.utcOffset).toBe(4);
    expect(meet.time.abbreviation).toBe('EDT');
    expect(meet.time.timeZone).toBe('Europe/London');

    const known = mapApiMeet({
      name: 'Home Meet',
      status: 'upcoming',
      start_date: '2026-06-20',
      end_date: '2026-06-21',
      time_zone: 'America/Chicago',
      venue_name: 'Venue',
      venue_street: '1 Main',
      venue_city: 'Chicago',
      venue_state: 'IL',
      venue_zip: '60601',
    });
    expect(known.timeZoneUnknown).toBe(false);
    expect(known.time.utcOffset).toBe(5);
    expect(known.time.abbreviation).toBe('CDT');
  });

  it('gives an id-less lifting result a stable composite event id instead of ""', () => {
    const base = {
      meet: 'Test Meet',
      date: '2026-06-20',
      name: 'Athlete A',
      age: 'Open',
      body_weight: 70,
      snatch1: 0, snatch2: 0, snatch3: 0, snatch_best: 0,
      cj1: 0, cj2: 0, cj3: 0, cj_best: 0, total: 0,
    };
    expect(mapApiLiftingResult({ ...base, event_id: 'evt-1' }).event_id).toBe('evt-1');
    const derived = mapApiLiftingResult({ ...base }).event_id;
    expect(derived).not.toBe('');
    expect(derived).toBe(mapApiLiftingResult({ ...base, event_id: '' }).event_id);
    expect(derived).not.toBe(mapApiLiftingResult({ ...base, date: '2026-06-21' }).event_id);
  });
});

describe('meetcal API client error and auth boundaries', () => {
  it('rejects a conditional answer that is not the { etag, body } envelope', async () => {
    installTransport(() => null);
    await expect(fetchApiMeets()).rejects.toThrow('/meets expected an object response');

    installTransport(() => [meetRow('Meet A')]);
    await expect(fetchApiMeets()).rejects.toThrow('/meets expected an object response');
  });

  it('reports a timeout as a distinct error type, not a bare Error', async () => {
    // Callers throttle timeout logs and fall back to cache, but report every
    // other failure. Telling them apart used to mean matching the message,
    // which silently stopped matching.
    jest.useFakeTimers();
    installTransport(() => never());

    const pending = fetchApiMeets().catch((error: unknown) => error);
    jest.advanceTimersByTime(DEFAULT_TIMEOUT_MS);
    const failure = await pending;

    expect(failure).toBeInstanceOf(MeetCalApiTimeoutError);
    expect(failure).not.toBeInstanceOf(MeetCalApiError);
    expect((failure as MeetCalApiTimeoutError).path).toBe('/meets');
    expect((failure as MeetCalApiTimeoutError).timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
    expect((failure as MeetCalApiTimeoutError).message).toBe(
      `GET /meets timed out after ${DEFAULT_TIMEOUT_MS}ms`,
    );
  });

  it('labels a mutation that times out as POST', async () => {
    jest.useFakeTimers();
    installTransport(() => never());

    const pending = patchAutoUnsavePreference('clerk-token', true).catch((error: unknown) => error);
    jest.advanceTimersByTime(DEFAULT_TIMEOUT_MS);
    const failure = await pending;

    expect(failure).toBeInstanceOf(MeetCalApiTimeoutError);
    expect((failure as MeetCalApiTimeoutError).message).toBe(
      `POST /users/me/preferences/auto-unsave timed out after ${DEFAULT_TIMEOUT_MS}ms`,
    );
  });

  it('does not time out a call that answers just inside the limit, and leaves no timer behind', async () => {
    jest.useFakeTimers();
    const reply = deferred<unknown>();
    installTransport(() => reply.promise);

    const pending = fetchApiClubAthletes('Club A');
    jest.advanceTimersByTime(DEFAULT_TIMEOUT_MS - 1);
    reply.resolve([{ name: 'Athlete A' }]);

    await expect(pending).resolves.toEqual([{ name: 'Athlete A' }]);
    expect(jest.getTimerCount()).toBe(0);
    // A slow call is still named in the development log.
    expect(console.info).toHaveBeenCalledWith('[perf] slow api request', {
      elapsedMs: DEFAULT_TIMEOUT_MS - 1,
      path: '/clubs/athletes',
      fn: 'reference:clubAthletes',
    });
  });

  it('reports a rejected call as MeetCalApiError with its status and body', async () => {
    installTransport(() => {
      throw apiFailure(404, { error: 'nope' });
    });

    const failure = await fetchApiMeets().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(MeetCalApiError);
    expect(failure).not.toBeInstanceOf(MeetCalApiTimeoutError);
    expect((failure as MeetCalApiError).status).toBe(404);
    expect(JSON.parse((failure as MeetCalApiError).body)).toEqual({ status: 404, error: 'nope' });
    expect((failure as MeetCalApiError).message).toBe('query failed with 404');
  });

  it('lets a connection failure through as is, never as an API status', async () => {
    // The outbox retries anything that is not a MeetCalApiError; a dropped
    // socket must not look like the server refusing the write.
    const dropped = new Error('Connection lost while action was in flight');
    installTransport(() => {
      throw dropped;
    });

    const failure = await fetchApiAthletes('Test Meet' as never).catch((error: unknown) => error);

    expect(failure).toBe(dropped);
    expect(failure).not.toBeInstanceOf(MeetCalApiError);
    expect(failure).not.toBeInstanceOf(MeetCalApiTimeoutError);
  });

  it('does not call the backend when the name list is empty', async () => {
    const { transport } = installTransport(answer([]));
    await expect(fetchApiResultsByNames([])).resolves.toEqual([]);
    await expect(fetchApiRecentResultsByNames([])).resolves.toEqual([]);
    await expect(fetchApiYearBestsByNames([])).resolves.toEqual({});
    // Not even the clock sample.
    expect(transport).not.toHaveBeenCalled();
  });

  it('chunks oversized name lists', async () => {
    const { dataCalls } = installTransport(answer([]));
    const names = Array.from({ length: NAMES_QUERY_CHUNK_SIZE + 1 }, (_, i) => `Athlete ${i}`);

    await fetchApiResultsByNames(names);
    await fetchApiRecentResultsByNames(names, '2024-01-01');

    expect(dataCalls().map((call) => [call.fn, (call.args.names as string[]).length])).toEqual([
      ['results:byNames', NAMES_QUERY_CHUNK_SIZE],
      ['results:byNames', 1],
      ['results:recent', NAMES_QUERY_CHUNK_SIZE],
      ['results:recent', 1],
    ]);
    expect(dataCalls().slice(2).every((call) => call.args.cutoffDate === '2024-01-01')).toBe(true);
    expect(dataCalls().flatMap((call) => call.args.names as string[])).toEqual([...names, ...names]);
  });

  it('sends one request for exactly a chunk of names and two for one more', async () => {
    const { dataCalls, transport } = installTransport(answer([]));
    const names = (count: number) => Array.from({ length: count }, (_, i) => `Athlete ${i}`);

    await fetchApiYearBestsByNames(names(SMALL_ROWS_NAMES_CHUNK_SIZE));
    expect(dataCalls()).toHaveLength(1);

    transport.mockClear();
    await fetchApiYearBestsByNames(names(SMALL_ROWS_NAMES_CHUNK_SIZE + 1));
    expect(dataCalls()).toHaveLength(2);
    expect(dataCalls().map((call) => (call.args.names as string[]).length)).toEqual([
      SMALL_ROWS_NAMES_CHUNK_SIZE,
      1,
    ]);
  });

  it('merges the bests from every chunk', async () => {
    installTransport((call) =>
      (call.args.names as string[]).map((name) => ({ name, best_snatch: 1, best_cj: 2, best_total: 3 })),
    );
    const roster = Array.from({ length: SMALL_ROWS_NAMES_CHUNK_SIZE + 5 }, (_, i) => `Athlete ${i}`);

    const bests = await fetchApiYearBestsByNames(roster);

    expect(Object.keys(bests)).toHaveLength(roster.length);
    expect(bests[`Athlete ${roster.length - 1}`]).toEqual({ bestSnatch: 1, bestCJ: 2, bestTotal: 3 });
  });

  it('sorts a national start list by bests in 16 requests, not 40, and never over the API cap', async () => {
    const { dataCalls } = installTransport(answer([]));
    // The 2026 national roster size the start list comment measured.
    const roster = Array.from({ length: 1562 }, (_, i) => `Athlete ${i}`);

    await fetchApiYearBestsByNames(roster);

    expect(dataCalls()).toHaveLength(16);
    const sizes = dataCalls().map((call) => (call.args.names as string[]).length);
    // The server's name-list cap is 100 for every client; one more is a 400.
    expect(Math.max(...sizes)).toBe(100);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(1562);
  });

  it('keeps full-history batches at the memory-bounded chunk size', async () => {
    const { dataCalls } = installTransport(answer([]));
    const names = Array.from({ length: SMALL_ROWS_NAMES_CHUNK_SIZE }, (_, i) => `Athlete ${i}`);

    await fetchApiResultsByNames(names);

    expect(dataCalls().map((call) => (call.args.names as string[]).length)).toEqual([
      NAMES_QUERY_CHUNK_SIZE,
      NAMES_QUERY_CHUNK_SIZE,
      20,
    ]);
  });

  it('stops at the first failing chunk instead of returning a partial roster', async () => {
    let call = 0;
    const { dataCalls } = installTransport(() => {
      call += 1;
      if (call === 1) return [];
      throw apiFailure(500);
    });
    const names = Array.from({ length: NAMES_QUERY_CHUNK_SIZE * 2 + 1 }, (_, i) => `Athlete ${i}`);

    const failure = await fetchApiResultsByNames(names).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(MeetCalApiError);
    expect((failure as MeetCalApiError).status).toBe(500);
    // The third chunk is never asked for.
    expect(dataCalls()).toHaveLength(2);
  });

  it('asks for one session of the roster, matches the platform client-side, and omits an absent filter', async () => {
    const athlete = {
      member_id: '1', name: 'Athlete A', adaptive: false, age: 24, club: 'Club',
      entry_total: 250, gender: 'Men', weight_class: '73kg',
      session_number: 2, session_platform: 'Blue',
    };
    // A hand-entered row: the server's exact `platform: 'Blue'` compare would
    // miss it, the app's case-insensitive match must not.
    const paddedAthlete = { ...athlete, member_id: '2', name: 'Athlete B', session_platform: 'BLUE ' };
    const goldAthlete = { ...athlete, member_id: '3', name: 'Athlete C', session_platform: 'Gold' };
    const { dataCalls } = installTransport(answer([athlete, paddedAthlete, goldAthlete]));

    const rows = await fetchApiAthletesWithSession('Test Meet' as never, 2, 'Blue');
    expect(rows.map((row) => row.name)).toEqual(['Athlete A', 'Athlete B']);
    expect(rows.map((row) => row.session)).toEqual([
      { number: 2, platform: 'Blue' },
      { number: 2, platform: 'Blue' },
    ]);
    expect(dataCalls()[0]).toMatchObject({
      path: '/meets/athletes-sessions',
      fn: 'meets:athletesSessions',
      kind: 'query',
    });
    // What the query actually filters on, as the Rust route's parameters.
    expect(callQuery(dataCalls()[0])).toEqual({ meet: 'Test Meet', session_number: '2' });
    expect(dataCalls()[0].args.sessionNumber).toBe(2);
    expect(dataCalls()[0].args.platform).toBeUndefined();

    await fetchApiAthletesWithSession('Test Meet' as never);
    expect(callQuery(dataCalls()[1])).toEqual({ meet: 'Test Meet' });

    // Platform without a session number cannot be narrowed client-side
    // cheaply, so it still goes to the server as the canonical name.
    await fetchApiAthletesWithSession('Test Meet' as never, undefined, 'Gold');
    expect(callQuery(dataCalls()[2])).toEqual({ meet: 'Test Meet', platform: 'Gold' });

    installTransport(answer({ athletes: [athlete] }));
    await expect(fetchApiAthletesWithSession('Test Meet' as never)).rejects.toThrow(
      '/meets/athletes-sessions expected an array response',
    );
  });

  it('rejects a single-athlete year-bests payload missing a best', async () => {
    installTransport(answer({ best_snatch: 100, best_cj: 120 }));
    await expect(fetchApiYearBests('Athlete A', '2025-06-20')).rejects.toThrow(
      '/lifting-results/year missing fields: best_total',
    );
  });

  it('requires an auth token for saved sessions', async () => {
    const { transport } = installTransport(answer({}));
    await expect(fetchSavedSessions('')).rejects.toThrow('requires an auth token');
    await expect(fetchUserPreferences('   ')).rejects.toThrow('requires an auth token');
    expect(transport).not.toHaveBeenCalled();
  });

  it('reads saved sessions with the token', async () => {
    const { lastCall } = installTransport(answer({ sessions: [] }));
    await expect(fetchSavedSessions('clerk-token')).resolves.toEqual([]);
    expect(lastCall()).toEqual({
      path: '/users/me/saved-sessions',
      fn: 'users:savedSessions',
      kind: 'query',
      args: {},
      token: 'clerk-token',
    });
  });

  it('rejects saved-session payloads that are not arrays', async () => {
    installTransport(answer({ sessions: { nope: true } }));
    await expect(fetchSavedSessions('clerk-token')).rejects.toThrow(
      '/users/me/saved-sessions.sessions expected an array response',
    );
  });

  it('rejects saved-session rows missing required fields', async () => {
    installTransport(answer({
      sessions: [{ session_id: 's1', meet: 'Meet' }],
    }));
    await expect(fetchSavedSessions('clerk-token')).rejects.toThrow('missing fields');
  });

  it('maps a valid saved-session payload', async () => {
    installTransport(answer({
      sessions: [{
        session_id: 's1',
        meet: 'Test Meet',
        session_number: 2,
        platform: 'Red',
        athlete_names: ['Athlete A'],
        updated_at: 1,
      }],
    }));
    await expect(fetchSavedSessions('clerk-token')).resolves.toEqual([
      {
        session_id: 's1',
        meet: 'Test Meet',
        session_number: 2,
        platform: 'Red',
        weight_class: null,
        start_time: null,
        date: null,
        notes: null,
        athlete_names: ['Athlete A'],
        updated_at: 1,
      },
    ]);
  });

  it('rejects preferences when the flag is not a boolean', async () => {
    installTransport(answer({ auto_unsave_started_sessions: 'yes' }));
    await expect(fetchUserPreferences('clerk-token')).rejects.toThrow('expected a boolean');
  });

  describe('authenticated /users/me writes', () => {
    // Response shapes from convex/users.ts, which answers what meetcal-backend
    // app/src/routes/users/saved_sessions.rs (SaveSessionResponse,
    // DeleteSavedSessionResponse, DeleteSavedSessionsResponse) and
    // preferences.rs did.
    const body = {
      meet: '2026 Nationals',
      session_number: 3,
      platform: 'Red',
      weight_class: '71kg',
      start_time: '10:00 AM',
      date: '2026-06-20',
      athlete_names: ['Athlete A'],
    };

    it('refuses to send any write without a usable token', async () => {
      const { transport } = installTransport(answer({}));
      await expect(putSavedSession('', 's1', body)).rejects.toThrow('putSavedSession requires an auth token');
      await expect(deleteSavedSession('  ', 's1')).rejects.toThrow('deleteSavedSession requires an auth token');
      await expect(deleteSavedSessions(null as unknown as string)).rejects.toThrow(
        'deleteSavedSessions requires an auth token',
      );
      await expect(patchAutoUnsavePreference(undefined as unknown as string, true)).rejects.toThrow(
        'patchAutoUnsavePreference requires an auth token',
      );
      expect(transport).not.toHaveBeenCalled();
    });

    it('saves one session through users:putSavedSession with the token and the id intact', async () => {
      const id = '2026 Nationals/Finals-3-Red';
      const { lastCall } = installTransport(answer({ session_id: id, updated_at: 1717171717000 }));

      await expect(putSavedSession('clerk-token', id, body)).resolves.toEqual({
        session_id: id,
        updated_at: 1717171717000,
      });

      // A `/` in a meet name is just part of the `sessionId` argument; the
      // path only names the route for logs.
      expect(lastCall()).toEqual({
        path: `/users/me/saved-sessions/${id}`,
        fn: 'users:putSavedSession',
        kind: 'mutation',
        token: 'clerk-token',
        args: { sessionId: id, ...body },
      });
    });

    it('rejects a save acknowledgement that is missing or mistypes its fields', async () => {
      installTransport(answer({ session_id: 's1' }));
      await expect(putSavedSession('clerk-token', 's1', body)).rejects.toThrow('missing fields: updated_at');
      installTransport(answer({ session_id: 's1', updated_at: '1' }));
      await expect(putSavedSession('clerk-token', 's1', body)).rejects.toThrow('invalid payload');
      installTransport(answer(null));
      await expect(putSavedSession('clerk-token', 's1', body)).rejects.toThrow(
        'putSavedSession expected an object response',
      );
    });

    it('surfaces 401 and 400 on a write as MeetCalApiError with the status', async () => {
      installTransport(() => {
        throw apiFailure(401, { error: 'unauthorized' });
      });
      const unauthorized = await putSavedSession('clerk-token', 's1', body).catch((e: unknown) => e);
      expect(unauthorized).toBeInstanceOf(MeetCalApiError);
      expect((unauthorized as MeetCalApiError).status).toBe(401);

      installTransport(() => {
        throw apiFailure(400, { error: 'too many saved sessions', max: 500 });
      });
      const refused = await putSavedSession('clerk-token', 's1', body).catch((e: unknown) => e);
      expect(refused).toBeInstanceOf(MeetCalApiError);
      expect((refused as MeetCalApiError).status).toBe(400);
      expect((refused as MeetCalApiError).body).toContain('too many saved sessions');
    });

    it('deletes one saved session by id and reads the acknowledgement', async () => {
      const { lastCall } = installTransport(answer({ deleted: false }));
      await expect(deleteSavedSession('clerk-token', 'a b-1-Red')).resolves.toEqual({ deleted: false });
      expect(lastCall()).toEqual({
        path: '/users/me/saved-sessions/a b-1-Red',
        fn: 'users:deleteSavedSession',
        kind: 'mutation',
        token: 'clerk-token',
        args: { sessionId: 'a b-1-Red' },
      });
    });

    it('scopes a bulk delete to one meet, or to every meet when none is given', async () => {
      const { lastCall } = installTransport(answer({ deleted_count: 4 }));
      await expect(deleteSavedSessions('clerk-token', 'Meet & Greet')).resolves.toEqual({ deleted_count: 4 });
      expect(lastCall()).toEqual({
        path: '/users/me/saved-sessions',
        fn: 'users:deleteSavedSessions',
        kind: 'mutation',
        token: 'clerk-token',
        args: { meet: 'Meet & Greet' },
      });

      await deleteSavedSessions('clerk-token');
      expect(lastCall().fn).toBe('users:deleteSavedSessions');
      expect(lastCall().kind).toBe('mutation');
      // No `meet` member at all once undefined is dropped: every meet.
      expect(callQuery(lastCall())).toEqual({});
      expect(lastCall().args.meet).toBeUndefined();
    });

    it('does not read a malformed delete acknowledgement as success', async () => {
      // The outbox clears a pending delete once this resolves. An answer that
      // is not the backend's shape (an older envelope, a function that
      // returned nothing) must keep the delete queued, not report it done.
      installTransport(answer({}));
      await expect(deleteSavedSession('clerk-token', 's1')).rejects.toThrow('deleteSavedSession');
      installTransport(answer({ deleted: 'true' }));
      await expect(deleteSavedSession('clerk-token', 's1')).rejects.toThrow('deleteSavedSession');
      installTransport(answer(null));
      await expect(deleteSavedSession('clerk-token', 's1')).rejects.toThrow('expected an object response');
      installTransport(answer({ error: 'nope' }));
      await expect(deleteSavedSessions('clerk-token', 'Meet')).rejects.toThrow('deleteSavedSessions');
      installTransport(answer({ deleted_count: '4' }));
      await expect(deleteSavedSessions('clerk-token')).rejects.toThrow('deleteSavedSessions');
      installTransport(answer([]));
      await expect(deleteSavedSessions('clerk-token')).rejects.toThrow('expected an object response');
    });

    it('sets the auto-unsave preference and validates the echoed flag', async () => {
      const { lastCall } = installTransport(answer({ auto_unsave_started_sessions: true }));
      await expect(patchAutoUnsavePreference('clerk-token', true)).resolves.toEqual({
        auto_unsave_started_sessions: true,
      });
      expect(lastCall()).toEqual({
        path: '/users/me/preferences/auto-unsave',
        fn: 'users:setAutoUnsave',
        kind: 'mutation',
        token: 'clerk-token',
        args: { enabled: true },
      });

      installTransport(answer({ auto_unsave_started_sessions: 'true' }));
      await expect(patchAutoUnsavePreference('clerk-token', true)).rejects.toThrow('expected a boolean');
      installTransport(answer({ enabled: true }));
      await expect(patchAutoUnsavePreference('clerk-token', true)).rejects.toThrow('missing fields');
    });
  });

  it('rejects search results that are not an array', async () => {
    installTransport(answer({
      matched_name: null,
      suggestions: ['A'],
      results: { bad: true },
    }));
    await expect(searchApi('A')).rejects.toThrow('/search.results expected an array response');
  });

  it('rejects search suggestions that are not all strings', async () => {
    installTransport(answer({ matched_name: null, suggestions: ['A', 1], results: [] }));
    await expect(searchApi('A')).rejects.toThrow('/search.suggestions expected a string array response');
  });

  it('rejects meet packages whose collection fields are not arrays', async () => {
    installTransport(answer({
      meet: { name: 'Meet' },
      schedule: [],
      athletes: { nope: true },
      meet_results: [],
    }));
    await expect(fetchApiMeetPackageConditional('Test Meet')).rejects.toThrow(
      '/meets/package.athletes expected an array response',
    );
  });

  it('rejects an object where a row array query is expected', async () => {
    // Callers go straight to `.filter`/`.map`, so an envelope answer used to
    // surface as "rows.filter is not a function" inside a fetcher rather than
    // naming the query.
    installTransport(answer({ rows: [] }));
    await expect(fetchApiClubAthletes('Club A')).rejects.toThrow(
      '/clubs/athletes expected an array response',
    );
    await expect(fetchApiRecords()).rejects.toThrow('/data/records expected an array response');
  });

  it('accepts an empty row array', async () => {
    installTransport(answer([]));
    await expect(fetchApiClubAthletes('Club A')).resolves.toEqual([]);
    await expect(fetchApiRecords()).resolves.toEqual([]);
  });

  it('rejects an array where a single object is expected', async () => {
    installTransport(answer([]));
    await expect(fetchApiClubMeetStats('Club A', 'Test Meet')).rejects.toThrow(
      '/clubs/meet-stats expected an object response',
    );
  });
});

describe('conditional reads for meet queries', () => {
  beforeEach(() => {
    // The meets list's arguments carry the current hour; pin it so every
    // call in a test shares one cache key.
    jest.useFakeTimers({ now: new Date('2026-06-20T12:30:00.000Z') });
  });

  it('stores the etag from a full answer and answers a bodiless one with the remembered meets', async () => {
    const { sentTag, dataCalls } = queueTransport([
      { etag: '"v1"', body: [meetRow('Meet A')] },
      { etag: '"v1"' },
    ]);

    const first = await fetchApiMeets();
    expect(sentTag(0)).toBeUndefined();

    const second = await fetchApiMeets();
    expect(sentTag(1)).toBe('"v1"');
    expect(dataCalls().every((call) => call.fn === 'meets:list' && call.conditional === true)).toBe(true);
    expect(second).toEqual(first);
    expect(second[0].name).toBe('Meet A');
    // Freshly mapped objects each time: a caller mutating one cannot edit the cache.
    expect(second[0]).not.toBe(first[0]);
  });

  it('trusts a bodiless answer that names no tag for the tag that was sent', async () => {
    const { sentTag } = queueTransport([
      { etag: '"v1"', body: [meetRow('Meet A')] },
      {},
    ]);

    await fetchApiMeets();
    await expect(fetchApiMeets()).resolves.toMatchObject([{ name: 'Meet A' }]);
    expect(sentTag(1)).toBe('"v1"');
  });

  it('replaces the remembered body when the etag changes', async () => {
    const { sentTag } = queueTransport([
      { etag: '"v1"', body: [meetRow('Meet A')] },
      { etag: '"v2"', body: [meetRow('Meet B')] },
      { etag: '"v2"' },
    ]);

    await fetchApiMeets();
    await expect(fetchApiMeets()).resolves.toMatchObject([{ name: 'Meet B' }]);
    expect(sentTag(1)).toBe('"v1"');
    await expect(fetchApiMeets()).resolves.toMatchObject([{ name: 'Meet B' }]);
    expect(sentTag(2)).toBe('"v2"');
  });

  it('revalidates meet details and schedule per query', async () => {
    const schedule = [
      {
        date: '2026-06-20',
        platform: 'red',
        session_id: 1,
        start_time: '09:00:00',
        weigh_in_time: '07:00:00',
        weight_class: '60kg',
      },
    ];
    const { dataCalls } = installTransport((call) => {
      const isSchedule = call.fn === 'meets:schedule';
      const tag = isSchedule ? '"s1"' : '"d1"';
      if (call.args.ifNoneMatch === tag) return { etag: tag };
      return { etag: tag, body: isSchedule ? schedule : meetRow('Meet A') };
    });

    const first = await fetchApiSchedule('Meet A');
    const second = await fetchApiSchedule('Meet A');
    expect(second).toEqual(first);
    expect(second[0].sessions[0].platforms[0].platform).toBe('Red');

    const validators = dataCalls().map((call) => [call.fn, call.args.ifNoneMatch]);
    expect(validators).toHaveLength(4);
    expect(validators).toEqual(
      expect.arrayContaining([
        ['meets:schedule', undefined],
        ['meets:details', undefined],
        ['meets:schedule', '"s1"'],
        ['meets:details', '"d1"'],
      ]),
    );
  });

  it('does not remember a body that failed shape validation', async () => {
    const { sentTag } = queueTransport([
      { etag: '"bad"', body: { not: 'an array' } },
      { etag: '"v1"', body: [meetRow('Meet A')] },
    ]);

    await expect(fetchApiMeets()).rejects.toThrow('expected an array response');
    await expect(fetchApiMeets()).resolves.toMatchObject([{ name: 'Meet A' }]);
    expect(sentTag(1)).toBeUndefined();
  });

  it('keeps throwing on rejected calls and keeps the tag for next time', async () => {
    const { sentTag } = queueTransport([
      { etag: '"v1"', body: [meetRow('Meet A')] },
      { fail: 500 },
      { etag: '"v1"' },
    ]);

    await fetchApiMeets();
    const failure = await fetchApiMeets().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MeetCalApiError);
    expect((failure as MeetCalApiError).status).toBe(500);
    await expect(fetchApiMeets()).resolves.toMatchObject([{ name: 'Meet A' }]);
    expect(sentTag(2)).toBe('"v1"');
  });

  it('still returns 404 as null for meet details, and throws anything else', async () => {
    queueTransport([{ fail: 404 }]);
    await expect(fetchApiMeetByName('Gone Meet')).resolves.toBeNull();

    queueTransport([{ fail: 500 }]);
    const failure = await fetchApiMeetByName('Broken Meet').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MeetCalApiError);
    expect((failure as MeetCalApiError).status).toBe(500);
  });

  it('bounds the number of remembered queries', async () => {
    const replies: Reply[] = [];
    for (let i = 0; i <= HTTP_VALIDATOR_CACHE_LIMIT; i += 1) {
      replies.push({ etag: `"d${i}"`, body: meetRow(`Meet ${i}`) });
    }
    // Meet 0 is the oldest entry and was evicted: no tag, full body.
    replies.push({ etag: '"d0"', body: meetRow('Meet 0') });
    const { sentTag } = queueTransport(replies);

    for (let i = 0; i <= HTTP_VALIDATOR_CACHE_LIMIT; i += 1) {
      await fetchApiMeetByName(`Meet ${i}`);
    }
    await expect(fetchApiMeetByName('Meet 0')).resolves.toMatchObject({ name: 'Meet 0' });
    expect(sentTag(HTTP_VALIDATOR_CACHE_LIMIT + 1)).toBeUndefined();
  });

  it('answers a bodiless reply from the entry read before the call, even if it was evicted in flight', async () => {
    let releaseFirst: (() => void) | undefined;
    installTransport(async (call) => {
      const name = String(call.args.meet);
      if (call.args.ifNoneMatch) {
        // Hold the revalidation until the cache has been churned.
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        return { etag: call.args.ifNoneMatch };
      }
      return { etag: `"${name}"`, body: meetRow(name) };
    });

    await fetchApiMeetByName('Meet 0');
    const pending = fetchApiMeetByName('Meet 0');
    for (let i = 1; i <= HTTP_VALIDATOR_CACHE_LIMIT; i += 1) {
      await fetchApiMeetByName(`Meet ${i}`);
    }
    expect(releaseFirst).toBeDefined();
    releaseFirst?.();
    await expect(pending).resolves.toMatchObject({ name: 'Meet 0' });
  });

  it('answers a bodiless reply with the newer entry a concurrent call stored in flight', async () => {
    let releaseSlow: (() => void) | undefined;
    let conditionalCalls = 0;
    installTransport(async (call) => {
      if (!call.args.ifNoneMatch) {
        return { etag: '"v1"', body: [meetRow('Meet A')] };
      }
      conditionalCalls += 1;
      if (conditionalCalls === 1) {
        // The slow revalidation: the server answered while "v1" was current.
        await new Promise<void>((resolve) => {
          releaseSlow = resolve;
        });
        return { etag: '"v1"' };
      }
      return { etag: '"v2"', body: [meetRow('Meet B')] };
    });

    await fetchApiMeets();
    const slow = fetchApiMeets();
    await expect(fetchApiMeets()).resolves.toMatchObject([{ name: 'Meet B' }]);
    releaseSlow?.();
    await expect(slow).resolves.toMatchObject([{ name: 'Meet B' }]);
  });

  it('retries without a tag when a bodiless answer names a different tag than was sent', async () => {
    const { sentTag, dataCalls } = queueTransport([
      { etag: '"v1"', body: [meetRow('Meet A')] },
      { etag: '"other"' },
      { etag: '"v2"', body: [meetRow('Meet B')] },
    ]);

    await fetchApiMeets();
    await expect(fetchApiMeets()).resolves.toMatchObject([{ name: 'Meet B' }]);
    expect(dataCalls()).toHaveLength(3);
    expect(sentTag(1)).toBe('"v1"');
    expect(sentTag(2)).toBeUndefined();
  });

  it('treats a bodiless answer to a call that carried no tag as an error after one retry', async () => {
    const { sentTag, dataCalls } = queueTransport([{ etag: '"v1"' }, { etag: '"v1"' }]);

    await expect(fetchApiMeets()).rejects.toThrow('/meets answered without a body');
    expect(dataCalls()).toHaveLength(2);
    expect(sentTag(0)).toBeUndefined();
    expect(sentTag(1)).toBeUndefined();

    // The retry is a real second chance, not a formality.
    queueTransport([{ etag: '"v1"' }, { etag: '"v1"', body: [meetRow('Meet A')] }]);
    await expect(fetchApiMeets()).resolves.toMatchObject([{ name: 'Meet A' }]);
  });

  it('forgets the tag when a full answer carries no usable etag', async () => {
    const { sentTag } = queueTransport([
      { etag: '"v1"', body: [meetRow('Meet A')] },
      { etag: null, body: [meetRow('Meet B')] },
      { etag: '  ', body: [meetRow('Meet B')] },
      { etag: null, body: [meetRow('Meet B')] },
    ]);
    await fetchApiMeets();
    await fetchApiMeets();
    await fetchApiMeets();
    await fetchApiMeets();
    expect(sentTag(1)).toBe('"v1"');
    expect(sentTag(2)).toBeUndefined();
    expect(sentTag(3)).toBeUndefined();
  });

  it('keys the meets list on the hour it asks about', async () => {
    const { sentTag, dataCalls } = queueTransport([
      { etag: '"v1"', body: [meetRow('Meet A')] },
      { etag: '"v1"' },
      { etag: '"v1"', body: [meetRow('Meet A')] },
    ]);

    await fetchApiMeets();
    jest.setSystemTime(new Date('2026-06-20T12:59:59.000Z'));
    await fetchApiMeets();
    jest.setSystemTime(new Date('2026-06-20T13:00:00.000Z'));
    await fetchApiMeets();

    expect(dataCalls().map((call) => call.args.now)).toEqual([
      Date.parse('2026-06-20T12:00:00.000Z'),
      Date.parse('2026-06-20T12:00:00.000Z'),
      Date.parse('2026-06-20T13:00:00.000Z'),
    ]);
    expect(sentTag(1)).toBe('"v1"');
    // A new hour is a new question; the old hour's tag does not answer it.
    expect(sentTag(2)).toBeUndefined();
  });
});

describe('conditional reads for reference data', () => {
  const recordRow = (overrides: Record<string, unknown> = {}) => ({
    age_category: 'Senior',
    gender: 'Men',
    weight_class: '89kg',
    record_type: 'USAW',
    snatch_record: 170,
    cj_record: 210,
    total_record: 380,
    ...overrides,
  });

  it('answers a bodiless reply with the rows validated when the etag was stored', async () => {
    const { sentTag } = queueTransport([
      { etag: '"r1"', body: [recordRow()] },
      { etag: '"r1"' },
    ]);

    const first = await fetchApiRecords();
    const second = await fetchApiRecords();

    expect(sentTag(0)).toBeUndefined();
    expect(sentTag(1)).toBe('"r1"');
    expect(second).toBe(first);
    expect(second).toEqual([recordRow()]);
  });

  it('hands out frozen rows, so a caller cannot rewrite what the next unchanged answer returns', async () => {
    queueTransport([
      { etag: '"r1"', body: [recordRow()] },
      { etag: '"r1"' },
    ]);

    const rows = await fetchApiRecords();
    expect(Object.isFrozen(rows)).toBe(true);
    expect(Object.isFrozen(rows[0])).toBe(true);
    try {
      (rows[0] as { total_record: number | null }).total_record = 1;
    } catch {
      // Strict-mode code throws; sloppy-mode code is silently ignored.
    }
    expect(rows[0].total_record).toBe(380);
    await expect(fetchApiRecords()).resolves.toEqual([recordRow()]);
  });

  it('returns a fresh copy of a cached string list on every call', async () => {
    queueTransport([
      { etag: '"w1"', body: ['Ohio', 'Carolina'] },
      { etag: '"w1"' },
    ]);

    const first = await fetchApiWsoList();
    first.sort();
    first.push('Mutated');
    await expect(fetchApiWsoList()).resolves.toEqual(['Ohio', 'Carolina']);
  });

  it('replaces the remembered rows when the etag changes', async () => {
    const { sentTag } = queueTransport([
      { etag: '"s1"', body: [{ age_category: 'Senior', gender: 'Men', weight_class: '89kg', standard_a: 300, standard_b: 280 }] },
      { etag: '"s2"', body: [{ age_category: 'Senior', gender: 'Men', weight_class: '89kg', standard_a: 310, standard_b: 290 }] },
      { etag: '"s2"' },
    ]);

    await fetchApiStandards();
    await expect(fetchApiStandards()).resolves.toMatchObject([{ standard_a: 310 }]);
    expect(sentTag(1)).toBe('"s1"');
    await expect(fetchApiStandards()).resolves.toMatchObject([{ standard_a: 310 }]);
    expect(sentTag(2)).toBe('"s2"');
  });

  it('passes straight through when the query answers without an etag', async () => {
    const row = {
      meet: 'Worlds',
      ranking: 1,
      name: 'Athlete A',
      weight_class: '89kg',
      total: 380,
      percent_a: 101.5,
      gender: 'Men',
      age_category: 'Senior',
    };
    const { sentTag } = queueTransport([
      { etag: null, body: [row] },
      { etag: null, body: [{ ...row, total: 385 }] },
    ]);

    await expect(fetchApiIntlRankings()).resolves.toEqual([row]);
    await expect(fetchApiIntlRankings()).resolves.toEqual([{ ...row, total: 385 }]);
    expect(sentTag(0)).toBeUndefined();
    expect(sentTag(1)).toBeUndefined();
  });

  it('throws on a body that fails validation and caches nothing', async () => {
    const { sentTag } = queueTransport([
      { etag: '"bad"', body: { error: 'wrapped' } },
      { etag: '"q1"', body: [] },
      { etag: '"c-bad"', body: ['Club A', 7] },
      { etag: '"c1"', body: ['Club A'] },
    ]);

    await expect(fetchApiQualifyingTotals()).rejects.toThrow(
      '/data/qualifying-totals expected an array response',
    );
    await expect(fetchApiQualifyingTotals()).resolves.toEqual([]);
    expect(sentTag(1)).toBeUndefined();

    await expect(fetchApiClubNames()).rejects.toThrow('/clubs expected a string array response');
    await expect(fetchApiClubNames()).resolves.toEqual(['Club A']);
    expect(sentTag(3)).toBeUndefined();
  });

  it('reads a wrong-typed column as null and skips a non-object row', async () => {
    queueTransport([
      {
        etag: '"q1"',
        body: [
          { event_name: 'Nationals', age_category: 'Senior', gender: 'Men', weight_class: '89kg', qualifying_total: '300', extra: 1 },
          null,
          'row',
          [1, 2],
        ],
      },
    ]);

    await expect(fetchApiQualifyingTotals()).resolves.toEqual([
      {
        event_name: 'Nationals',
        age_category: 'Senior',
        gender: 'Men',
        weight_class: '89kg',
        qualifying_total: null,
      },
    ]);
  });

  it('remembers each query variant under its own arguments', async () => {
    const { dataCalls } = installTransport((call) => {
      const key = [call.args.ageCategory ?? '', call.args.gender ?? '', call.args.wso ?? ''].join('|');
      const tag = `"${key}"`;
      if (call.args.ifNoneMatch === tag) return { etag: tag };
      return { etag: tag, body: [{ name: key, total: 1, weight_class: '71kg', snatch: 1, cj: 1 }] };
    });

    for (let pass = 0; pass < 2; pass += 1) {
      await expect(fetchApiNationalRankings('USAW', 'Senior 89')).resolves.toMatchObject([{ name: 'Senior 89||' }]);
      await expect(fetchApiNationalRankings('USAW', 'Junior 89')).resolves.toMatchObject([{ name: 'Junior 89||' }]);
      await expect(fetchApiAdaptiveRecords('Men', 'BWL')).resolves.toMatchObject([{ weight_class: '71kg' }]);
      await expect(fetchApiAdaptiveRecords('Women', 'BWL')).resolves.toMatchObject([{ weight_class: '71kg' }]);
      await expect(fetchApiWsoRecords('Ohio', 'Senior', 'Men')).resolves.toHaveLength(1);
    }

    const validators = dataCalls().map((call) => call.args.ifNoneMatch);
    expect(validators.slice(0, 5)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(validators.slice(5)).toEqual([
      '"Senior 89||"',
      '"Junior 89||"',
      '"|Men|"',
      '"|Women|"',
      '"Senior|Men|Ohio"',
    ]);
  });

  it('treats an omitted optional argument like an absent one', async () => {
    const { sentTag } = queueTransport([
      { etag: '"o1"', body: [] },
      { etag: '"o1"' },
    ]);

    await fetchApiWsoRecords('Ohio');
    await fetchApiWsoRecords('Ohio', undefined, undefined);
    expect(sentTag(1)).toBe('"o1"');
  });

  it('keeps the meets tag through a session of reference-data browsing', async () => {
    jest.useFakeTimers({ now: new Date('2026-06-20T12:30:00.000Z') });
    const tagFor = (call: ApiCall) =>
      `"${call.fn}?${new URLSearchParams(callQuery(call)).toString()}"`;
    const { dataCalls, transport } = installTransport((call) => {
      const tag = tagFor(call);
      if (call.args.ifNoneMatch === tag) return { etag: tag };
      let body: unknown = [];
      if (call.fn === 'meets:list') body = [];
      else if (call.fn === 'meets:details') body = { name: 'M', start_date: '2026-06-20', end_date: '2026-06-21', time_zone: 'America/New_York' };
      else if (call.fn === 'reference:wsoList' || call.fn === 'reference:clubs') body = ['A'];
      return { etag: tag, body };
    });

    await fetchApiMeets();
    await fetchApiRecords();
    await fetchApiStandards();
    await fetchApiQualifyingTotals();
    await fetchApiIntlRankings();
    await fetchApiWsoList();
    await fetchApiClubNames();
    await fetchApiAdaptiveRecords('Men', 'BWL');
    await fetchApiAdaptiveRecords('Women', 'BWL');
    for (let i = 0; i < 8; i += 1) {
      await fetchApiMeetByName(`Meet ${i}`);
      await fetchApiSchedule(`Meet ${i}`, mapApiMeet({
        name: `Meet ${i}`,
        start_date: '2026-06-20',
        end_date: '2026-06-21',
        time_zone: 'America/New_York',
        status: 'upcoming',
        venue_city: '',
        venue_name: '',
        venue_state: '',
        venue_street: '',
        venue_zip: '',
      }));
    }
    for (let i = 0; i < 30; i += 1) {
      await fetchApiNationalRankings('USAW', `Category ${i}`);
    }

    transport.mockClear();
    await fetchApiMeets();
    const [meetsCall] = dataCalls();
    expect(meetsCall.fn).toBe('meets:list');
    expect(meetsCall.args.ifNoneMatch).toBe(tagFor(meetsCall));
  });
});

describe('JSON text answers', () => {
  const scheduleRow = {
    date: '2026-06-20',
    platform: 'Red',
    session_id: 1,
    start_time: '09:00:00',
    weigh_in_time: '07:00:00',
    weight_class: '60kg',
  };
  const recordRow = {
    age_category: 'Senior',
    gender: 'Men',
    weight_class: '89kg',
    record_type: 'USAW',
    snatch_record: 170,
    cj_record: 210,
    total_record: 380,
  };
  const athleteRow = {
    member_id: '1', name: 'Athlete A', adaptive: false, age: 24, club: 'Club',
    entry_total: 250, gender: 'Men', weight_class: '73kg',
    session_number: 2, session_platform: 'Blue',
  };
  const resultRow = {
    id: 1, event_id: 'e1', meet: 'Test Meet', date: '2026-06-20', name: 'Athlete A',
    age: 'Open', body_weight: 72.5, snatch1: 100, snatch2: 0, snatch3: 0, snatch_best: 100,
    cj1: 120, cj2: 0, cj3: 0, cj_best: 120, total: 220,
  };

  /**
   * A conditional query that tags its text answer `"t1"` and answers the tag
   * alone when the caller sends it back.
   */
  function textRevalidating(body: unknown) {
    return installTransport((call) =>
      call.args.ifNoneMatch === '"t1"' ? { etag: '"t1"' } : { etag: '"t1"', json: JSON.stringify(body) },
    );
  }

  it.each<[string, () => Promise<unknown>, string, unknown, unknown]>([
    ['fetchApiMeets', () => fetchApiMeets(), 'meets:list', [meetRow('Meet A')], [{ name: 'Meet A', venue: { name: 'Hall' } }]],
    ['fetchApiMeetByName', () => fetchApiMeetByName('Meet A'), 'meets:details', meetRow('Meet A'), { name: 'Meet A' }],
    [
      'fetchApiSchedule',
      () => fetchApiSchedule('Meet A', mapApiMeet(meetRow('Meet A'))),
      'meets:schedule',
      [scheduleRow],
      [{ fullDate: '2026-06-20', sessions: [{ number: 1, startTime: '9:00 AM' }] }],
    ],
    ['fetchApiRecords', () => fetchApiRecords(), 'reference:records', [recordRow], [recordRow]],
    [
      'fetchApiStandards',
      () => fetchApiStandards(),
      'reference:standards',
      [{ age_category: 'Senior', gender: 'Men', weight_class: '89kg', standard_a: 300, standard_b: 280 }],
      [{ standard_a: 300, standard_b: 280 }],
    ],
    [
      'fetchApiQualifyingTotals',
      () => fetchApiQualifyingTotals(),
      'reference:qualifyingTotals',
      [{ event_name: 'Nationals', age_category: 'Senior', gender: 'Men', weight_class: '89kg', qualifying_total: 300 }],
      [{ event_name: 'Nationals', qualifying_total: 300 }],
    ],
    [
      'fetchApiIntlRankings',
      () => fetchApiIntlRankings(),
      'reference:intlRankings',
      [{ meet: 'Worlds', ranking: 1, name: 'Athlete A', weight_class: '89kg', total: 380, percent_a: 101.5, gender: 'Men', age_category: 'Senior' }],
      [{ meet: 'Worlds', total: 380 }],
    ],
    [
      'fetchApiNationalRankings',
      () => fetchApiNationalRankings('USAW', 'Senior 89'),
      'reference:nationalRankings',
      [{ name: 'Athlete A', total: 380 }],
      [{ name: 'Athlete A', total: 380 }],
    ],
    [
      'fetchApiWsoRecords',
      () => fetchApiWsoRecords('Ohio', 'Senior', 'Men'),
      'reference:wsoRecords',
      [{ wso: 'Ohio', age_category: 'Senior', gender: 'Men', weight_class: '89kg', snatch_record: 150, cj_record: 190, total_record: 340 }],
      [{ wso: 'Ohio', total_record: 340 }],
    ],
    [
      'fetchApiAdaptiveRecords',
      () => fetchApiAdaptiveRecords('Men', 'BWL'),
      'reference:adaptiveRecords',
      [{ weight_class: '71kg', snatch: 60, cj: 80, total: 140 }],
      [{ weight_class: '71kg', total: 140 }],
    ],
    ['fetchApiWsoList', () => fetchApiWsoList(), 'reference:wsoList', ['Ohio', 'Carolina'], ['Ohio', 'Carolina']],
    ['fetchApiWsoAgeGroups', () => fetchApiWsoAgeGroups('Ohio'), 'reference:wsoAgeGroups', ['Senior'], ['Senior']],
    ['fetchApiClubNames', () => fetchApiClubNames(), 'reference:clubs', ['Club A', 'Café Club'], ['Club A', 'Café Club']],
  ])('%s decodes an { etag, json } answer and reuses it when the tag comes back alone', async (_name, invoke, fn, body, expected) => {
    const { dataCalls } = textRevalidating(body);

    const first = await invoke();
    const second = await invoke();

    expect(first).toMatchObject(expected as object);
    expect(second).toEqual(first);
    expect(dataCalls().map((call) => [call.fn, call.args.ifNoneMatch])).toEqual([
      [fn, undefined],
      [fn, '"t1"'],
    ]);
  });

  it('decodes an { etag, json } meet package and answers not_modified for the stored tag', async () => {
    const wire = {
      meet: meetRow('Meet A'),
      schedule: [],
      athletes: [athleteRow],
      meet_results: [resultRow],
      year_bests: [{ name: 'Andrés Álvarez', best_snatch: 95, best_cj: 110, best_total: 205 }],
    };
    const { dataCalls } = textRevalidating(wire);

    const first = await fetchApiMeetPackageConditional('Meet A' as never, '2024-01-01', null);
    if (first.status !== 'fresh') throw new Error('expected a fresh package');
    expect(first.etag).toBe('"t1"');
    const { year_bests: _wire, ...rest } = wire;
    expect(first.package).toEqual({
      ...rest,
      year_bests_by_name: { 'Andrés Álvarez': { best_snatch: 95, best_cj: 110, best_total: 205 } },
    });

    await expect(
      fetchApiMeetPackageConditional('Meet A' as never, '2024-01-01', first.etag),
    ).resolves.toEqual({ status: 'not_modified' });
    expect(dataCalls().map((call) => call.args.ifNoneMatch)).toEqual([undefined, '"t1"']);
  });

  it.each<[string, () => Promise<unknown>, unknown[], unknown]>([
    ['fetchApiAthletes', () => fetchApiAthletes('Test Meet' as never), [athleteRow], [{ name: 'Athlete A', entryTotal: 250 }]],
    [
      'fetchApiAthletesWithSession',
      () => fetchApiAthletesWithSession('Test Meet' as never, 2, 'blue'),
      [athleteRow, { ...athleteRow, member_id: '2', name: 'Athlete B', session_platform: 'Gold' }],
      [{ name: 'Athlete A', session: { number: 2, platform: 'Blue' } }],
    ],
    ['fetchApiResultsByNames', () => fetchApiResultsByNames(['Athlete A']), [resultRow], [{ id: 1, total: 220 }]],
    ['fetchApiRecentResultsByNames', () => fetchApiRecentResultsByNames(['Athlete A'], '2024-01-01'), [resultRow], [{ id: 1, snatch2: 0 }]],
  ])('%s decodes a { json } answer and still accepts a plain array', async (_name, invoke, rows, expected) => {
    installTransport(() => ({ json: JSON.stringify(rows) }));
    const fromText = await invoke();
    expect(fromText).toMatchObject(expected as object);
    expect(fromText).toHaveLength((expected as unknown[]).length);

    installTransport(() => rows);
    await expect(invoke()).resolves.toEqual(fromText);
  });

  it.each<[string, () => Promise<unknown>, string, (json: unknown) => unknown]>([
    ['fetchApiAthletes', () => fetchApiAthletes('Test Meet' as never), '/meets/athletes', (json) => ({ json })],
    ['fetchApiAthletesWithSession', () => fetchApiAthletesWithSession('Test Meet' as never), '/meets/athletes-sessions', (json) => ({ json })],
    ['fetchApiResultsByNames', () => fetchApiResultsByNames(['Athlete A']), '/lifting-results/by-names', (json) => ({ json })],
    ['fetchApiRecentResultsByNames', () => fetchApiRecentResultsByNames(['Athlete A']), '/lifting-results/recent', (json) => ({ json })],
    ['fetchApiRecords', () => fetchApiRecords(), '/data/records', (json) => ({ etag: '"t1"', json })],
    ['fetchApiMeets', () => fetchApiMeets(), '/meets', (json) => ({ etag: '"t1"', json })],
    ['fetchApiMeetPackageConditional', () => fetchApiMeetPackageConditional('Test Meet' as never), '/meets/package', (json) => ({ etag: '"t1"', json })],
  ])('%s names its path when the JSON text is empty, unparseable or not text', async (_name, invoke, path, wrap) => {
    installTransport(() => wrap(''));
    await expect(invoke()).rejects.toThrow(`${path} returned an empty body`);

    installTransport(() => wrap('{"rows": ['));
    await expect(invoke()).rejects.toThrow(`${path} returned invalid JSON`);

    for (const notText of [null, 42, ['[]'], { rows: [] }]) {
      installTransport(() => wrap(notText));
      await expect(invoke()).rejects.toThrow(`${path} returned a non-text json field`);
    }
  });

  it('remembers nothing from a text answer that failed to decode', async () => {
    const { sentTag } = queueTransport([
      { etag: '"bad"', json: '[{' },
      { etag: '"t1"', json: JSON.stringify([recordRow]) },
    ]);

    await expect(fetchApiRecords()).rejects.toThrow('/data/records returned invalid JSON');
    await expect(fetchApiRecords()).resolves.toEqual([recordRow]);
    expect(sentTag(1)).toBeUndefined();
  });

  it('still fails an array endpoint whose JSON text is not an array', async () => {
    installTransport(() => ({ json: '{"rows":[]}' }));
    await expect(fetchApiResultsByNames(['Athlete A'])).rejects.toThrow(
      '/lifting-results/by-names expected an array response',
    );
    await expect(fetchApiAthletes('Test Meet' as never)).rejects.toThrow(
      '/meets/athletes expected an array response',
    );

    installTransport(() => ({ etag: '"t1"', json: '{"rows":[]}' }));
    await expect(fetchApiRecords()).rejects.toThrow('/data/records expected an array response');
    await expect(fetchApiMeets()).rejects.toThrow('/meets expected an array response');

    installTransport(() => ({ etag: '"t1"', json: 'null' }));
    await expect(fetchApiMeetPackageConditional('Test Meet' as never)).rejects.toThrow(
      '/meets/package expected an object response',
    );
  });

  it('coerces package year_bests values that are not finite numbers to 0, and parses numeric text', async () => {
    installTransport(
      answer({
        meet: {},
        schedule: [],
        athletes: [],
        meet_results: [],
        year_bests: [
          { name: 'A', best_snatch: null, best_cj: '12', best_total: Number.NaN },
          { name: 'B', best_snatch: 'abc', best_cj: Number.POSITIVE_INFINITY, best_total: 7 },
          { name: 'C', best_snatch: ' ', best_cj: {}, best_total: '205.5' },
        ],
      }),
    );

    const fetched = await fetchApiMeetPackageConditional('Test Meet' as never);

    if (fetched.status !== 'fresh') throw new Error('expected a fresh package');
    expect(fetched.package.year_bests_by_name).toEqual({
      // `toFiniteNumber`: numeric text is read as a number, like `entry_total`.
      A: { best_snatch: 0, best_cj: 12, best_total: 0 },
      B: { best_snatch: 0, best_cj: 0, best_total: 7 },
      C: { best_snatch: 0, best_cj: 0, best_total: 205.5 },
    });
  });
});

describe('by-names latestOnly', () => {
  it('sends latestOnly only when asked', async () => {
    const { dataCalls } = installTransport(answer([]));

    await fetchApiResultsByNames(['Athlete A'], { latestOnly: true });
    await fetchApiResultsByNames(['Athlete A']);
    await fetchApiResultsByNames(['Athlete A'], { latestOnly: false });

    expect(dataCalls().map((call) => call.args.latestOnly)).toEqual([true, undefined, undefined]);
    expect(dataCalls().map(callQuery)).toEqual([
      { names: 'Athlete A', latest_only: 'true' },
      { names: 'Athlete A' },
      { names: 'Athlete A' },
    ]);
  });

  it('keeps latestOnly on every chunk', async () => {
    const { dataCalls } = installTransport(answer([]));
    const names = Array.from({ length: SMALL_ROWS_NAMES_CHUNK_SIZE + 1 }, (_, i) => `Athlete ${i}`);

    await fetchApiResultsByNames(names, { latestOnly: true });

    expect(dataCalls()).toHaveLength(2);
    for (const call of dataCalls()) {
      expect(call.args.latestOnly).toBe(true);
    }
  });
});

describe('server clock', () => {
  const T0 = Date.parse('2026-06-20T12:00:00.000Z');

  it('has no trusted clock before the first response', () => {
    expect(getServerClockSample()).toBeNull();
    expect(getServerClockSkewMs()).toBeNull();
    expect(getTrustedNow()).toBeNull();
  });

  it('samples the clock mutation alongside the first request, so a fast device clock is corrected', async () => {
    const serverNow = T0;
    // The device is three hours ahead of the server.
    jest.useFakeTimers({ now: serverNow + 3 * HOUR_MS });
    const { clockCalls } = installTransport(answer([]), () => serverNow);

    await fetchApiMeets();

    expect(clockCalls()).toEqual([
      { path: '/clock', fn: 'system:serverTime', kind: 'mutation', args: {} },
    ]);
    expect(getServerClockSkewMs()).toBe(-3 * HOUR_MS);
    expect(getServerClockSample()).toEqual({
      skewMs: -3 * HOUR_MS,
      sampledAt: Date.now(),
    });
    expect(getTrustedNow()?.getTime()).toBe(serverNow);
    expect(Math.abs(getServerClockSkewMs() ?? 0)).toBeGreaterThan(MAX_PLAUSIBLE_CLOCK_SKEW_MS);
  });

  it('sends the clock call without holding the request back, and measures skew from the round-trip midpoint', async () => {
    jest.useFakeTimers({ now: T0 });
    const clock = deferred<number>();
    const { clockCalls, dataCalls } = installTransport(answer(['Club A']), () => clock.promise);

    const pending = fetchApiClubNames();
    // Both calls are out before either answers.
    expect(clockCalls()).toHaveLength(1);
    expect(dataCalls()).toHaveLength(1);

    // 400ms round trip; the server read its clock 1000ms after the send.
    jest.setSystemTime(T0 + 400);
    clock.resolve(T0 + 1000);

    await expect(pending).resolves.toEqual(['Club A']);
    // 1000 - (0 + 400) / 2
    expect(getServerClockSample()).toEqual({ skewMs: 800, sampledAt: T0 + 400 });
    expect(getTrustedNow()?.getTime()).toBe(T0 + 400 + 800);
  });

  it('evaluates the meets window on the server clock, rounded down to the hour', async () => {
    jest.useFakeTimers({ now: Date.parse('2026-06-20T14:10:00.000Z') });
    const { dataCalls } = installTransport(answer([]), () => Date.now() - 3 * HOUR_MS);

    // No sample yet: the device clock is all there is.
    await fetchApiMeets();
    await fetchApiMeets();

    expect(dataCalls().map((call) => call.args.now)).toEqual([
      Date.parse('2026-06-20T14:00:00.000Z'),
      Date.parse('2026-06-20T11:00:00.000Z'),
    ]);
  });

  it('keeps a fresh sample and refreshes a stale one in the background', async () => {
    jest.useFakeTimers({ now: T0 });
    let clockAnswer: () => unknown = () => Date.now() + 5000;
    const { clockCalls } = installTransport(answer([]), () => clockAnswer());

    await fetchApiClubNames();
    expect(getServerClockSkewMs()).toBe(5000);
    expect(clockCalls()).toHaveLength(1);

    // Exactly at the limit is still fresh.
    jest.setSystemTime(T0 + SERVER_CLOCK_RESAMPLE_MS);
    await fetchApiClubNames();
    expect(clockCalls()).toHaveLength(1);

    const refresh = deferred<number>();
    clockAnswer = () => refresh.promise;
    jest.setSystemTime(T0 + SERVER_CLOCK_RESAMPLE_MS + 1);
    // Not the first sample: the request does not wait for the refresh.
    await expect(fetchApiClubNames()).resolves.toEqual([]);
    expect(clockCalls()).toHaveLength(2);
    // One refresh in flight is shared, not repeated per request.
    await fetchApiClubNames();
    expect(clockCalls()).toHaveLength(2);
    expect(getServerClockSkewMs()).toBe(5000);

    refresh.resolve(Date.now() + 7000);
    await flushMicrotasks();
    expect(getServerClockSample()).toEqual({
      skewMs: 7000,
      sampledAt: T0 + SERVER_CLOCK_RESAMPLE_MS + 1,
    });
  });

  it('does not fail the request when the clock call fails or answers junk, and tries again next time', async () => {
    jest.useFakeTimers({ now: T0 });
    const clockAnswers: (() => unknown)[] = [
      () => {
        throw new Error('mutation failed');
      },
      () => 'soon',
      () => Number.NaN,
      () => T0 + 30_000,
    ];
    const { clockCalls } = installTransport(answer(['Club A']), () => clockAnswers.shift()?.());

    for (let i = 0; i < 3; i += 1) {
      await expect(fetchApiClubNames()).resolves.toEqual(['Club A']);
      expect(getServerClockSample()).toBeNull();
      expect(getTrustedNow()).toBeNull();
    }
    await fetchApiClubNames();

    expect(clockCalls()).toHaveLength(4);
    expect(getServerClockSkewMs()).toBe(30_000);
  });

  it('samples the clock even when the request it rides alongside fails', async () => {
    jest.useFakeTimers({ now: T0 });
    installTransport(
      () => {
        throw apiFailure(500);
      },
      () => T0 + 60_000,
    );

    await expect(fetchApiMeets()).rejects.toBeInstanceOf(MeetCalApiError);
    await flushMicrotasks();
    expect(getServerClockSkewMs()).toBe(60_000);
  });

  it('holds the first request at most the grace period for a clock call that never answers', async () => {
    jest.useFakeTimers({ now: T0 });
    installTransport(answer(['Club A']), () => never());
    let settled = false;
    const pending = fetchApiClubNames().finally(() => {
      settled = true;
    });

    await flushMicrotasks();
    jest.advanceTimersByTime(FIRST_SAMPLE_GRACE_MS - 1);
    await flushMicrotasks();
    expect(settled).toBe(false);

    jest.advanceTimersByTime(1);
    await expect(pending).resolves.toEqual(['Club A']);
    expect(getServerClockSample()).toBeNull();
    // The grace timer and the request timeout are cleared; only the stuck
    // sample's own abandonment timer is left.
    expect(jest.getTimerCount()).toBe(1);
  });

  it('does not hold later requests for a clock call that is still stuck', async () => {
    jest.useFakeTimers({ now: T0 });
    const { clockCalls } = installTransport(answer(['Club A']), () => never());

    const first = fetchApiClubNames();
    await flushMicrotasks();
    jest.advanceTimersByTime(FIRST_SAMPLE_GRACE_MS);
    await first;

    let settled = false;
    const second = fetchApiClubNames().finally(() => {
      settled = true;
    });
    await flushMicrotasks();
    expect(settled).toBe(true);
    await expect(second).resolves.toEqual(['Club A']);
    // It joined the sample in flight rather than starting another.
    expect(clockCalls()).toHaveLength(1);
  });

  it('does not hold a second request at startup for the clock call the first one started', async () => {
    jest.useFakeTimers({ now: T0 });
    const { clockCalls, dataCalls } = installTransport(answer(['Club A']), () => never());
    let firstSettled = false;
    let secondSettled = false;

    const first = fetchApiClubNames().finally(() => {
      firstSettled = true;
    });
    const second = fetchApiWsoList().finally(() => {
      secondSettled = true;
    });
    expect(clockCalls()).toHaveLength(1);
    expect(dataCalls()).toHaveLength(2);

    await flushMicrotasks();
    expect(secondSettled).toBe(true);
    expect(firstSettled).toBe(false);

    jest.advanceTimersByTime(FIRST_SAMPLE_GRACE_MS);
    await expect(first).resolves.toEqual(['Club A']);
    await expect(second).resolves.toEqual(['Club A']);
  });

  it('abandons a stuck clock call after 10s so a later request can start a new one', async () => {
    const SAMPLE_TIMEOUT_MS = 10000; // `SERVER_CLOCK_SAMPLE_TIMEOUT_MS`
    jest.useFakeTimers({ now: T0 });
    let clockAnswer: () => unknown = () => never();
    const { clockCalls } = installTransport(answer(['Club A']), () => clockAnswer());

    const first = fetchApiClubNames();
    await flushMicrotasks();
    jest.advanceTimersByTime(FIRST_SAMPLE_GRACE_MS);
    await first;

    // Just short of the limit the stuck call is still the one in flight.
    jest.advanceTimersByTime(SAMPLE_TIMEOUT_MS - FIRST_SAMPLE_GRACE_MS - 1);
    await fetchApiClubNames();
    expect(clockCalls()).toHaveLength(1);

    jest.advanceTimersByTime(1);
    await flushMicrotasks();
    clockAnswer = () => Date.now() + 42_000;
    // No sample yet, and this request starts the new one, so it waits for it.
    await expect(fetchApiClubNames()).resolves.toEqual(['Club A']);
    expect(clockCalls()).toHaveLength(2);
    expect(getServerClockSample()).toEqual({ skewMs: 42_000, sampledAt: T0 + SAMPLE_TIMEOUT_MS });
  });

  it('discards a sample whose round trip took longer than 5s, and keeps one of exactly 5s', async () => {
    const MAX_ROUND_TRIP_MS = 5000; // `MAX_CLOCK_SAMPLE_ROUND_TRIP_MS`
    jest.useFakeTimers({ now: T0 });
    let clock = deferred<number>();
    const { clockCalls } = installTransport(answer(['Club A']), () => clock.promise);

    const first = fetchApiClubNames();
    await flushMicrotasks();
    jest.advanceTimersByTime(FIRST_SAMPLE_GRACE_MS);
    await expect(first).resolves.toEqual(['Club A']);
    jest.advanceTimersByTime(MAX_ROUND_TRIP_MS + 1 - FIRST_SAMPLE_GRACE_MS);
    clock.resolve(Date.now() + 60_000);
    await flushMicrotasks();
    expect(getServerClockSample()).toBeNull();

    // The discarded sample is finished, so the next request starts another.
    const sentAt = Date.now();
    clock = deferred<number>();
    const second = fetchApiClubNames();
    await flushMicrotasks();
    jest.advanceTimersByTime(FIRST_SAMPLE_GRACE_MS);
    await second;
    jest.advanceTimersByTime(MAX_ROUND_TRIP_MS - FIRST_SAMPLE_GRACE_MS);
    clock.resolve(Date.now() + 60_000);
    await flushMicrotasks();
    expect(clockCalls()).toHaveLength(2);
    // 60s ahead of the receive time, measured from the midpoint.
    expect(getServerClockSample()).toEqual({
      skewMs: 60_000 + MAX_ROUND_TRIP_MS / 2,
      sampledAt: sentAt + MAX_ROUND_TRIP_MS,
    });
  });
});
