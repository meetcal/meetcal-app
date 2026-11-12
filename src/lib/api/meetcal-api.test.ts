import { clearHttpValidatorCache } from '@/lib/api/revalidated-reads';
import { deleteSavedSession, deleteSavedSessions, fetchSavedSessions, putSavedSession } from '@/lib/api/saved-sessions-api';
import { fetchApiAdaptiveRecords, fetchApiIntlRankings, fetchApiNationalRankings, fetchApiQualifyingTotals, fetchApiRecords, fetchApiStandards, fetchApiWsoAgeGroups, fetchApiWsoList, fetchApiWsoRecords } from '@/lib/api/reference-api';
import { fetchApiAthletes, fetchApiAthletesWithSession, fetchApiMeetByName, fetchApiMeets, fetchApiSchedule } from '@/lib/api/meets-api';
import { fetchApiClubMeets, fetchApiClubMeetStats, fetchApiClubNames } from '@/lib/api/clubs-api';
import { fetchApiMeetPackageConditional, MEET_PACKAGE_INCLUDE, MEET_PACKAGE_TIMEOUT_MS } from '@/lib/api/meet-package-api';
import { fetchApiRecentResultsByNames, fetchApiResultsByNames, fetchApiYearBestsByNames, NAMES_QUERY_CHUNK_SIZE, SMALL_ROWS_NAMES_CHUNK_SIZE, searchApi } from '@/lib/api/results-api';
import { fetchUserPreferences, patchAutoUnsavePreference } from '@/lib/api/user-preferences-api';
import { resetServerClockForTests } from '@/lib/api/server-clock';
import { MeetCalApiError, MeetCalApiTimeoutError } from '@/lib/api/meetcal-api';
import { refreshServerEntitlement, fetchAccessPass } from '@/lib/api/entitlement-api';
import { issueSiriToken, revokeApiToken } from '@/lib/api/siri-tokens-api';
import { callQuery, isClockCall } from './json-transport-stub';
import { setAccessPassSource } from './premium-queries';
import { setApiTransportForTests, TransportRequestError, type ApiCall } from './transport';
import { ATTEMPT_HISTORY_YEARS, getHistoryCutoffDate, YEAR_BESTS_YEARS } from '@/utils/dateTime';
import { itemAt } from '@/test-support/checked-access';

const DEFAULT_TIMEOUT_MS = 10000;

type Responder = (call: ApiCall) => unknown;

function installTransport(respond: Responder, clock: Responder = () => Date.now()) {
  const transport = jest.fn(
    async (call: ApiCall): Promise<unknown> => (isClockCall(call) ? clock(call) : respond(call)),
  );
  setApiTransportForTests(transport);
  const allCalls = (): ApiCall[] => transport.mock.calls.map(([{ signal: _signal, ...call }]) => call);
  const dataCalls = (): ApiCall[] => allCalls().filter((call) => !isClockCall(call));
  const clockCalls = (): ApiCall[] => allCalls().filter((call) => isClockCall(call));
  const lastCall = (): ApiCall => {
    const calls = dataCalls();
    if (calls.length === 0) throw new Error('no data call was made');
    return itemAt(calls, -1);
  };
  return { transport, dataCalls, clockCalls, lastCall };
}

function answer(body: unknown, etag: string | null = null): Responder {
  return (call) => (call.conditional ? { etag, body } : body);
}

function apiFailure(status: number, data: Record<string, unknown> = { error: 'failed' }) {
  return new TransportRequestError(
    `query failed with ${status}`,
    status,
    JSON.stringify({ status, ...data }),
  );
}

type Reply = { etag?: string | null; body?: unknown; json?: unknown } | { fail: number };

function queueTransport(replies: Reply[]) {
  const fake = installTransport(() => {
    const reply = replies.shift();
    if (!reply) throw new Error('unexpected call');
    if ('fail' in reply) throw apiFailure(reply.fail);
    return reply;
  });
  return { ...fake, sentTag: (index: number) => itemAt(fake.dataCalls(), index).args.ifNoneMatch };
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
      'fetchApiClubMeets',
      () => fetchApiClubMeets('Club A'),
      { path: '/clubs/meets', fn: 'reference:clubMeets', args: { club: 'Club A' } },
      { meets: [], truncated: false },
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
    const call = itemAt(dataCalls(), 0);
    expect(call.path).toBe(expected.path);
    expect(call.fn).toBe(expected.fn);
    expect(call.kind).toBe('query');
    expect(call.args).toEqual(expected.args);
    expect(call.args.ifNoneMatch).toBeUndefined();
    expect(call.conditional === true).toBe(expected.conditional === true);
    expect(call.token).toBeUndefined();
  });

  it('fetches a schedule in one request, without the meet details', async () => {
    const { dataCalls } = installTransport(
      answer([
        {
          date: '2026-06-20',
          platform: 'Red',
          session_id: 1,
          start_time: '09:00:00',
          weigh_in_time: '07:00:00',
          weight_class: '60kg',
        },
      ]),
    );

    const schedule = await fetchApiSchedule('Test Meet');

    expect(dataCalls().map((call) => call.fn)).toEqual(['meets:schedule']);
    expect(itemAt(dataCalls(), 0).args).toEqual({ meet: 'Test Meet' });
    expect(itemAt(schedule, 0).date).toBe('June 20, 2026');
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
    installTransport(() => ({}));
    await expect(
      fetchApiMeetPackageConditional('Test Meet' as never, '2024-01-01', '"abc"'),
    ).resolves.toEqual({ status: 'not_modified' });

    installTransport(() => ({ etag: '"other"' }));
    await expect(
      fetchApiMeetPackageConditional('Test Meet' as never, '2024-01-01', '"abc"'),
    ).rejects.toThrow('/meets/package answered without a body');
    await expect(
      fetchApiMeetPackageConditional('Test Meet' as never, '2024-01-01', null),
    ).rejects.toThrow('/meets/package answered without a body');

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
      expect(fetched.package).not.toHaveProperty('recent_results_by_name');
      expect(fetched.package).not.toHaveProperty('attempt_estimates');
      expect(fetched.package.year_bests_by_name).toBeUndefined();
    }
    expect(MEET_PACKAGE_INCLUDE).toEqual(['year_bests']);
    expect(lastCall().args.include).toEqual(['year_bests']);
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

  it("keys batch year bests by the caller's spellings, matched through the name fold", async () => {
    installTransport(
      answer([
        { name: 'Jane Doe', best_snatch: 80, best_cj: 100, best_total: 180 },
        { name: 'Somebody Else', best_snatch: 1, best_cj: 1, best_total: 2 },
      ]),
    );

    const bests = await fetchApiYearBestsByNames([' Jane Doe', 'jane  doe', 'Nobody']);

    expect(bests).toEqual({
      ' Jane Doe': { bestSnatch: 80, bestCJ: 100, bestTotal: 180 },
      'jane  doe': { bestSnatch: 80, bestCJ: 100, bestTotal: 180 },
    });
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

describe('meetcal API client error and auth boundaries', () => {
  it('rejects a conditional answer that is not the { etag, body } envelope', async () => {
    installTransport(() => null);
    await expect(fetchApiMeets()).rejects.toThrow('/meets expected an object response');

    installTransport(() => [meetRow('Meet A')]);
    await expect(fetchApiMeets()).rejects.toThrow('/meets expected an object response');
  });

  it('reports a timeout as a distinct error type, not a bare Error', async () => {
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

    const pending = fetchApiClubMeets('Club A');
    jest.advanceTimersByTime(DEFAULT_TIMEOUT_MS - 1);
    reply.resolve({ meets: [{ meet: 'Meet A', date: '2026-03-27' }], truncated: false });

    await expect(pending).resolves.toEqual([{ meet: 'Meet A', date: '2026-03-27' }]);
    expect(jest.getTimerCount()).toBe(0);
    expect(console.info).toHaveBeenCalledWith('[perf] slow api request', {
      elapsedMs: DEFAULT_TIMEOUT_MS - 1,
      path: '/clubs/meets',
      fn: 'reference:clubMeets',
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
    const roster = Array.from({ length: 1562 }, (_, i) => `Athlete ${i}`);

    await fetchApiYearBestsByNames(roster);

    expect(dataCalls()).toHaveLength(16);
    const sizes = dataCalls().map((call) => (call.args.names as string[]).length);
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
    expect(dataCalls()).toHaveLength(2);
  });

  it('asks for one session of the roster, matches the platform client-side, and omits an absent filter', async () => {
    const athlete = {
      member_id: '1', name: 'Athlete A', adaptive: false, age: 24, club: 'Club',
      entry_total: 250, gender: 'Men', weight_class: '73kg',
      session_number: 2, session_platform: 'Blue',
    };
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
    expect(callQuery(itemAt(dataCalls(), 0))).toEqual({ meet: 'Test Meet', session_number: '2' });
    expect(itemAt(dataCalls(), 0).args.sessionNumber).toBe(2);
    expect(itemAt(dataCalls(), 0).args.platform).toBeUndefined();

    await fetchApiAthletesWithSession('Test Meet' as never);
    expect(callQuery(itemAt(dataCalls(), 1))).toEqual({ meet: 'Test Meet' });

    await fetchApiAthletesWithSession('Test Meet' as never, undefined, 'Gold');
    expect(callQuery(itemAt(dataCalls(), 2))).toEqual({ meet: 'Test Meet', platform: 'Gold' });

    installTransport(answer({ athletes: [athlete] }));
    await expect(fetchApiAthletesWithSession('Test Meet' as never)).rejects.toThrow(
      '/meets/athletes-sessions expected an array response',
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
      expect(callQuery(lastCall())).toEqual({});
      expect(lastCall().args.meet).toBeUndefined();
    });

    it('sends a write revision with every saved-session write, and none when not given', async () => {
      const revision = { device: '5b1f3c1e-8f0a-4c55-9d43-2b6f8f6e9a10', rev: 42 };
      let installed = installTransport(answer({ session_id: 's1', updated_at: 1 }));
      await putSavedSession('clerk-token', 's1', body, revision);
      expect(installed.lastCall().args).toEqual({ sessionId: 's1', ...body, ...revision });

      installed = installTransport(answer({ deleted: true }));
      await deleteSavedSession('clerk-token', 's1', revision);
      expect(installed.lastCall().args).toEqual({ sessionId: 's1', ...revision });

      installed = installTransport(answer({ deleted_count: 1 }));
      await deleteSavedSessions('clerk-token', 'Meet', revision);
      expect(installed.lastCall().args).toEqual({ meet: 'Meet', ...revision });
      await deleteSavedSessions('clerk-token', undefined, revision);
      expect(installed.lastCall().args).toEqual(revision);

      await deleteSavedSessions('clerk-token', 'Meet');
      expect(installed.lastCall().args).toEqual({ meet: 'Meet' });
    });

    it('reads a superseded write (one the server ignored as older) as success', async () => {
      installTransport(answer({ session_id: 's1', updated_at: 1, superseded: true }));
      await expect(putSavedSession('clerk-token', 's1', body, { device: 'device-1', rev: 1 })).resolves.toEqual({
        session_id: 's1',
        updated_at: 1,
      });
      installTransport(answer({ deleted: false, superseded: true }));
      await expect(deleteSavedSession('clerk-token', 's1', { device: 'device-1', rev: 1 })).resolves.toEqual({
        deleted: false,
      });
    });

    it.each([
      ['a blank device', { device: ' ', rev: 1 }],
      ['a device over 64 characters', { device: 'x'.repeat(65), rev: 1 }],
      ['a device that is not text', { device: 7 as unknown as string, rev: 1 }],
      ['a rev of 0', { device: 'device-1', rev: 0 }],
      ['a fractional rev', { device: 'device-1', rev: 1.5 }],
      ['an unsafe rev', { device: 'device-1', rev: Number.MAX_SAFE_INTEGER + 1 }],
      ['a rev that is not a number', { device: 'device-1', rev: '1' as unknown as number }],
    ])('refuses to send %s as a write revision', async (_, revision) => {
      const { transport } = installTransport(answer({}));
      await expect(putSavedSession('clerk-token', 's1', body, revision)).rejects.toThrow('putSavedSession requires');
      await expect(deleteSavedSession('clerk-token', 's1', revision)).rejects.toThrow('deleteSavedSession requires');
      await expect(deleteSavedSessions('clerk-token', 'Meet', revision)).rejects.toThrow('deleteSavedSessions requires');
      expect(transport).not.toHaveBeenCalled();
    });

    it('does not read a malformed delete acknowledgement as success', async () => {
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

  it.each([
    [[{ date: '2026-06-20' }], '/meets/package.schedule[0].sessions expected an array response'],
    [['TBD'], '/meets/package.schedule[0] expected an object response'],
    [
      [{ date: '2026-06-20', sessions: [{ session_id: 1, platforms: 'Red' }] }],
      '/meets/package.schedule[0].sessions[0].platforms expected an array response',
    ],
    [
      [{ date: '2026-06-20', sessions: [{ session_id: 1, platforms: [null] }] }],
      '/meets/package.schedule[0].sessions[0].platforms[0] expected an object response',
    ],
  ])('rejects a meet package whose schedule is malformed, naming the field', async (schedule, message) => {
    installTransport(answer({ meet: { name: 'Meet' }, schedule, athletes: [], meet_results: [] }));
    await expect(fetchApiMeetPackageConditional('Test Meet')).rejects.toThrow(message);
  });

  it('rejects an object where a row array query is expected', async () => {
    installTransport(answer({ rows: [] }));
    await expect(fetchApiRecords()).rejects.toThrow('/data/records expected an array response');
  });

  it('accepts an empty row array', async () => {
    installTransport(answer([]));
    await expect(fetchApiRecords()).resolves.toEqual([]);
  });

  it('rejects an array where a single object is expected', async () => {
    installTransport(answer([]));
    await expect(fetchApiClubMeetStats('Club A', 'Test Meet')).rejects.toThrow(
      '/clubs/meet-stats expected an object response',
    );
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
      () => fetchApiSchedule('Meet A'),
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
    ['fetchApiResultsByNames', () => fetchApiResultsByNames(['Athlete A']), [resultRow], [{ event_id: 'e1', total: 220 }]],
    ['fetchApiRecentResultsByNames', () => fetchApiRecentResultsByNames(['Athlete A'], '2024-01-01'), [resultRow], [{ event_id: 'e1', snatch2: 0 }]],
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
      A: { best_snatch: 0, best_cj: 12, best_total: 0 },
      B: { best_snatch: 0, best_cj: 0, best_total: 7 },
      C: { best_snatch: 0, best_cj: 0, best_total: 205.5 },
    });
  });
});

describe('request timeouts', () => {
  afterEach(() => {
    setApiTransportForTests(null);
    jest.useRealTimers();
  });

  it('aborts a request that times out, so it cannot land after a newer write', async () => {
    jest.useFakeTimers();
    let signal: AbortSignal | undefined;
    setApiTransportForTests(async (call) => {
      if (call.kind === 'clock') return Date.now();
      signal = call.signal;
      return new Promise(() => {});
    });
    const pending = deleteSavedSession('token', 'session-1').catch((error: unknown) => error);
    await Promise.resolve();
    expect(signal?.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS + 1);
    expect(await pending).toBeInstanceOf(MeetCalApiTimeoutError);
    expect(signal?.aborted).toBe(true);
  });
});

describe('premium reads and the access pass', () => {
  afterEach(() => setAccessPassSource(null));

  it('carry the pass on premium queries only, as their `pass` argument, and none without a subscriber', async () => {
    const { dataCalls } = installTransport(() => ({ etag: '"r1"', json: '[]' }));
    await fetchApiRecords();
    setAccessPassSource(async () => ({ pass: 'p1', rotatesAt: Date.now() + 60_000 }));
    clearHttpValidatorCache();
    await fetchApiRecords();
    await fetchApiSchedule('Spring Open' as never).catch(() => {});
    expect(dataCalls().map((call) => [call.fn, call.args.pass, call.token])).toEqual([
      ['reference:records', undefined, undefined],
      ['reference:records', 'p1', undefined],
      ['meets:schedule', undefined, undefined],
    ]);
  });

  it('sends a refused read once more with a new pass', async () => {
    const passes = ['old', 'new'];
    setAccessPassSource(async () => ({ pass: passes.shift() ?? 'none', rotatesAt: Date.now() + 60_000 }));
    const { dataCalls } = installTransport((call) => {
      if (call.args.pass === 'old') throw new TransportRequestError('query failed with 403', 403, '{"status":403,"error":"access pass expired"}');
      return { etag: '"r1"', json: '[]' };
    });
    await expect(fetchApiRecords()).resolves.toEqual([]);
    expect(dataCalls().map((call) => call.args.pass)).toEqual(['old', 'new']);
  });

  it('gets the pass with the Clerk token, and checks its shape', async () => {
    const { lastCall } = installTransport(() => ({ pass: 'p1', rotatesAt: 5 }));
    await expect(fetchAccessPass('clerk-token')).resolves.toEqual({ pass: 'p1', rotatesAt: 5 });
    expect(lastCall()).toMatchObject({ fn: 'accessPass:pass', kind: 'query', token: 'clerk-token' });
    installTransport(() => ({ pass: '', rotatesAt: 5 }));
    await expect(fetchAccessPass('clerk-token')).rejects.toThrow('non-empty string');
  });

  it('asks the server to check the subscription with the Clerk token', async () => {
    const { lastCall } = installTransport(() => ({ active: true }));
    await expect(refreshServerEntitlement('clerk-token')).resolves.toEqual({ active: true });
    expect(lastCall()).toMatchObject({ fn: 'entitlements:refresh', kind: 'action', token: 'clerk-token' });
    installTransport(() => ({ active: 'yes' }));
    await expect(refreshServerEntitlement('clerk-token')).rejects.toThrow('expected a boolean');
  });

  it("issues Siri's token with the Clerk token, and checks its shape", async () => {
    const { lastCall } = installTransport(() => ({ token: 'jwt', tokenId: 't1', expiresAt: 9 }));
    await expect(issueSiriToken('clerk-token')).resolves.toEqual({ token: 'jwt', tokenId: 't1', expiresAt: 9 });
    expect(lastCall()).toMatchObject({ fn: 'apiTokens:issue', kind: 'action', token: 'clerk-token', args: { client: 'siri' } });
    installTransport(() => ({ token: 'jwt', tokenId: '', expiresAt: 9 }));
    await expect(issueSiriToken('clerk-token')).rejects.toThrow('tokenId expected a non-empty string');
    await expect(issueSiriToken('')).rejects.toThrow('requires an auth token');
  });

  it('ends a token with the token itself, or with a Clerk session and its id', async () => {
    const { lastCall } = installTransport(() => null);
    await revokeApiToken('jwt');
    expect(lastCall()).toMatchObject({ fn: 'apiTokens:revoke', kind: 'mutation', token: 'jwt', args: {} });
    await revokeApiToken('clerk-token', 't1');
    expect(lastCall()).toMatchObject({ token: 'clerk-token', args: { tokenId: 't1' } });
  });
});
