import {
  APP_VERSION,
  buildApiUrl,
  clearHttpValidatorCache,
  deleteSavedSession,
  deleteSavedSessions,
  fetchApiAdaptiveRecords,
  fetchApiAthletesWithSession,
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
  getJson,
  getJsonArray,
  getJsonObject,
  mapApiAthlete,
  mapApiAthletes,
  mapApiLiftingResult,
  mapApiMeet,
  mapApiSchedule,
  mapApiYearBests,
  mapPackageSchedule,
  MEET_PACKAGE_TIMEOUT_MS,
  MeetCalApiError,
  MeetCalApiServerTimeoutError,
  MeetCalApiTimeoutError,
  NAMES_QUERY_CHUNK_SIZE,
  SMALL_ROWS_NAMES_CHUNK_SIZE,
  patchAutoUnsavePreference,
  putSavedSession,
  resolveAppVersion,
  searchApi,
} from './meetcal-api';
import { HTTP_VALIDATOR_CACHE_LIMIT } from './http-cache';
import {
  ATTEMPT_HISTORY_YEARS,
  getHistoryCutoffDate,
  YEAR_BESTS_YEARS,
} from '@/utils/dateTime';

// Hoisted by jest above the imports; placed here to satisfy import/first.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '6.2.0' } },
}));
jest.mock('expo-application', () => ({
  __esModule: true,
  nativeApplicationVersion: '6.1.9',
}));

/** The API's request ceiling; a client timeout above it can never fire first. */
const BACKEND_REQUEST_CEILING_MS = 15000;

describe('meetcal API client', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('builds query strings with comma-separated array values', () => {
    expect(buildApiUrl('/lifting-results/by-names', {
      names: ['Athlete A', 'Athlete B'],
      cutoff_date: undefined,
    })).toBe(
      'https://api.meetcal.app/lifting-results/by-names?names=Athlete+A%2CAthlete+B',
    );
  });

  it('sends bearer auth headers for authenticated requests', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ auto_unsave_started_sessions: true }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(fetchUserPreferences('clerk-token')).resolves.toEqual({
      auto_unsave_started_sessions: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.meetcal.app/users/me/preferences',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer clerk-token',
        }),
      }),
    );
  });

  it('returns parsed JSON as unknown, never as a caller-inferred type', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ rows: 'not an array' }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    // Compile-time regression (`bun run typecheck` covers test files): with a
    // generic `getJson<T>`, this annotation inferred `T = string[]` and cast
    // the object body past `JSON.parse` unchecked. It must not compile.
    // @ts-expect-error unknown is not assignable to string[]
    const rows: string[] = await getJson('/meets/athletes');
    expect(Array.isArray(rows)).toBe(false);
  });

  it('reads plain array list endpoints', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(['Carolina', 'Ohio']),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(fetchApiWsoList()).resolves.toEqual(['Carolina', 'Ohio']);
    await expect(fetchApiWsoAgeGroups('Carolina')).resolves.toEqual(['Carolina', 'Ohio']);
    await expect(fetchApiClubNames()).resolves.toEqual(['Carolina', 'Ohio']);
  });

  it('rejects the retired wrapped WSO list shape', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ wsos: ['Carolina', 'Ohio'] }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(fetchApiWsoList()).rejects.toThrow('/data/wso/ expected an array response');
  });

  it('declares the app version on every request', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify([]),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    expect(APP_VERSION).toBe('6.2.0');
    await fetchApiClubNames();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.meetcal.app/clubs',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-MeetCal-App': '6.2.0' }),
      }),
    );
  });

  it('posts name lists so a comma inside a name stays one name', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify([]),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await fetchApiResultsByNames(['Nordstrom, Alexander', 'Athlete B']);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.meetcal.app/lifting-results/by-names',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ names: ['Nordstrom, Alexander', 'Athlete B'] }),
      }),
    );
  });

  it('always sends a cutoff for recent results, defaulting to the shared history window', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify([]),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await fetchApiRecentResultsByNames(['Athlete A']);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    const body = JSON.parse(init.body) as { names: string[]; cutoff_date: string };
    expect(body.names).toEqual(['Athlete A']);
    expect(body.cutoff_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // One cutoff policy: the UTC-only `getHistoryCutoffDate`, not a second
    // device-local copy of the same arithmetic.
    expect(body.cutoff_date).toBe(getHistoryCutoffDate(ATTEMPT_HISTORY_YEARS));
  });

  it('defaults the year-bests cutoff to the shared one-year window', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({}),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await fetchApiYearBestsByNames(['Athlete A']);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(JSON.parse(init.body).cutoff_date).toBe(getHistoryCutoffDate(YEAR_BESTS_YEARS));
  });

  it('prefers the Expo version and falls back to the native bundle version', () => {
    expect(resolveAppVersion('6.2.0', '6.1.9')).toBe('6.2.0');
    expect(resolveAppVersion('', '6.1.9')).toBe('6.1.9');
    expect(resolveAppVersion(undefined, '6.1.9')).toBe('6.1.9');
    expect(resolveAppVersion('  ', null)).toBe('');
  });

  it('skips the details request when the caller already has the meet', async () => {
    const fetchMock = jest.fn(async (url: string) => ({
      ok: true,
      status: 200,
      text: async () =>
        url.includes('/meets/schedule')
          ? JSON.stringify([
              {
                date: '2026-06-20',
                platform: 'Red',
                session_id: 1,
                start_time: '09:00:00',
                weigh_in_time: '07:00:00',
                weight_class: '60kg',
              },
            ])
          : JSON.stringify({
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
            }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;
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

    const urls = fetchMock.mock.calls.map(([url]) => url);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('/meets/schedule');
    expect(schedule[0].date).toBe('June 20, 2026');

    // Without the meet the details request still rides alongside.
    fetchMock.mockClear();
    await fetchApiSchedule('Test Meet');
    expect(fetchMock.mock.calls.map(([url]) => url).some((url) => url.includes('/meets/details'))).toBe(true);
  });

  it('revalidates the meet package with If-None-Match and honours 304', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: false,
      status: 304,
      headers: { get: (name: string) => (name === 'etag' ? '"abc"' : null) },
      text: async () => '',
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      fetchApiMeetPackageConditional('Test Meet' as never, '2024-01-01', '"abc"'),
    ).resolves.toEqual({ status: 'not_modified' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.meetcal.app/meets/package?meet=Test+Meet&history_cutoff_date=2024-01-01&include=year_bests',
      expect.objectContaining({
        headers: expect.objectContaining({ 'If-None-Match': '"abc"' }),
      }),
    );
  });

  it('asks the package for the year-bests section only and tolerates the rest being absent', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () =>
        JSON.stringify({ meet: {}, schedule: [], athletes: [], meet_results: [] }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const fetched = await fetchApiMeetPackageConditional('Test Meet', '2024-01-01', null);
    expect(fetched.status).toBe('fresh');
    if (fetched.status === 'fresh') {
      expect(fetched.package.recent_results_by_name).toBeUndefined();
      expect(fetched.package.attempt_estimates).toBeUndefined();
      expect(fetched.package.year_bests_by_name).toBeUndefined();
    }
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(new URL(url).searchParams.get('include')).toBe('year_bests');
  });

  it('keeps the package timeout under the backend request ceiling', () => {
    expect(MEET_PACKAGE_TIMEOUT_MS).toBeLessThan(BACKEND_REQUEST_CEILING_MS);
  });

  it('returns the package and its etag on a fresh response', async () => {
    const pkg = { meet: {}, schedule: [], athletes: [], meet_results: [] };
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name === 'etag' ? '"def"' : null) },
      text: async () => JSON.stringify(pkg),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      fetchApiMeetPackageConditional('Test Meet' as never, '2024-01-01', null),
    ).resolves.toEqual({ status: 'fresh', etag: '"def"', package: pkg });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(init.headers['If-None-Match']).toBeUndefined();
  });

  it('posts batch year bests with the cutoff', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          'Athlete A': {
            best_snatch: 100,
            best_cj: 120,
            best_total: 220,
          },
          'Athlete B': {
            best_snatch: 90,
            best_cj: 110,
            best_total: 200,
          },
        }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      fetchApiYearBestsByNames(['Athlete A', 'Athlete B'], '2025-06-19'),
    ).resolves.toEqual({
      'Athlete A': { bestSnatch: 100, bestCJ: 120, bestTotal: 220 },
      'Athlete B': { bestSnatch: 90, bestCJ: 110, bestTotal: 200 },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.meetcal.app/lifting-results/bests',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ names: ['Athlete A', 'Athlete B'], cutoff_date: '2025-06-19' }),
      }),
    );
  });

  it('throws when runtime response validation fails', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ names: ['not', 'an', 'array'] }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

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
    const originalTz = process.env.TZ;
    // A device far east of the meet: a device-local anchor would flip the day.
    process.env.TZ = 'Pacific/Auckland';
    try {
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
    } finally {
      process.env.TZ = originalTz;
    }
  });

  it('computes New York DST offset from the meet date, not the device zone', () => {
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
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function mockFetch(body: string, status = 200) {
    const fetchMock = jest.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
    }));
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  it('rejects empty JSON bodies', async () => {
    mockFetch('');
    await expect(fetchApiMeets()).rejects.toThrow('returned an empty body');
  });

  it('reports a timeout as a distinct error type, not a bare Error', async () => {
    // Callers throttle timeout logs and fall back to cache, but report every
    // other failure. Telling them apart used to mean matching the message,
    // which silently stopped matching.
    jest.useFakeTimers();
    try {
      global.fetch = jest.fn(async (_url: unknown, init: unknown) => {
        const { signal } = init as { signal: AbortSignal };
        return await new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            const abortError = new Error('Aborted');
            abortError.name = 'AbortError';
            reject(abortError);
          });
        });
      }) as unknown as typeof fetch;

      const pending = fetchApiMeets().catch((error: unknown) => error);
      jest.runOnlyPendingTimers();
      const failure = await pending;
      expect(failure).toBeInstanceOf(MeetCalApiTimeoutError);
      expect(failure).not.toBeInstanceOf(MeetCalApiError);
      expect((failure as MeetCalApiTimeoutError).path).toBe('/meets');
      expect((failure as MeetCalApiTimeoutError).timeoutMs).toBeGreaterThan(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('treats the server-side 408 (empty body) as a timeout, not a plain API error', async () => {
    mockFetch('', 408);
    const failure = await fetchApiMeets().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MeetCalApiServerTimeoutError);
    // Callers already branch on the timeout class; the server's timeout must
    // land in that branch too.
    expect(failure).toBeInstanceOf(MeetCalApiTimeoutError);
    expect(failure).not.toBeInstanceOf(MeetCalApiError);
    expect((failure as MeetCalApiServerTimeoutError).status).toBe(408);
    expect((failure as MeetCalApiServerTimeoutError).path).toBe('/meets');
  });

  it('reports a non-2xx response as MeetCalApiError with its status', async () => {
    mockFetch('{"error":"nope"}', 404);
    const failure = await fetchApiMeets().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MeetCalApiError);
    expect(failure).not.toBeInstanceOf(MeetCalApiTimeoutError);
    expect((failure as MeetCalApiError).status).toBe(404);
  });

  it('rejects invalid JSON bodies', async () => {
    mockFetch('{not-json');
    await expect(fetchApiMeets()).rejects.toThrow('returned invalid JSON');
  });

  it('does not fetch when the name list is empty', async () => {
    const fetchMock = mockFetch('[]');
    await expect(fetchApiResultsByNames([])).resolves.toEqual([]);
    await expect(fetchApiYearBestsByNames([])).resolves.toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('chunks oversized name lists', async () => {
    const fetchMock = mockFetch('[]');
    const names = Array.from({ length: NAMES_QUERY_CHUNK_SIZE + 1 }, (_, i) => `Athlete ${i}`);
    await fetchApiResultsByNames(names);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends one request for exactly a chunk of names and two for one more', async () => {
    const fetchMock = mockFetch('{}');
    const names = (count: number) => Array.from({ length: count }, (_, i) => `Athlete ${i}`);

    await fetchApiYearBestsByNames(names(SMALL_ROWS_NAMES_CHUNK_SIZE));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockClear();
    await fetchApiYearBestsByNames(names(SMALL_ROWS_NAMES_CHUNK_SIZE + 1));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.mock.calls.map(
      (call) => JSON.parse((call as unknown as [string, RequestInit])[1].body as string).names,
    );
    expect(bodies.map((chunk: string[]) => chunk.length)).toEqual([SMALL_ROWS_NAMES_CHUNK_SIZE, 1]);
  });

  it('sorts a national start list by bests in 16 requests, not 40, and never over the API cap', async () => {
    const fetchMock = mockFetch('{}');
    // The 2026 national roster size the start list comment measured.
    const roster = Array.from({ length: 1562 }, (_, i) => `Athlete ${i}`);

    await fetchApiYearBestsByNames(roster);

    expect(fetchMock).toHaveBeenCalledTimes(16);
    const sizes = fetchMock.mock.calls.map(
      (call) => JSON.parse((call as unknown as [string, RequestInit])[1].body as string).names.length,
    );
    // The API's MAX_NAME_LIST_LEN is 100 for every client; one more is a 400.
    expect(Math.max(...sizes)).toBe(100);
    expect(sizes.reduce((a: number, b: number) => a + b, 0)).toBe(1562);
  });

  it('keeps full-history batches at the memory-bounded chunk size', async () => {
    const fetchMock = mockFetch('[]');
    const names = Array.from({ length: SMALL_ROWS_NAMES_CHUNK_SIZE }, (_, i) => `Athlete ${i}`);

    await fetchApiResultsByNames(names);

    const sizes = fetchMock.mock.calls.map(
      (call) => JSON.parse((call as unknown as [string, RequestInit])[1].body as string).names.length,
    );
    expect(sizes).toEqual([NAMES_QUERY_CHUNK_SIZE, NAMES_QUERY_CHUNK_SIZE, 20]);
  });

  it('stops at the first failing chunk instead of returning a partial roster', async () => {
    let call = 0;
    global.fetch = jest.fn(async () => {
      call += 1;
      return call === 1
        ? { ok: true, status: 200, text: async () => '[]' }
        : { ok: false, status: 500, text: async () => '' };
    }) as unknown as typeof fetch;
    const names = Array.from({ length: NAMES_QUERY_CHUNK_SIZE + 1 }, (_, i) => `Athlete ${i}`);
    const failure = await fetchApiResultsByNames(names).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MeetCalApiError);
    expect((failure as MeetCalApiError).status).toBe(500);
  });

  it('asks for one session and platform of the roster and omits an absent filter', async () => {
    const athlete = {
      member_id: '1', name: 'Athlete A', adaptive: false, age: 24, club: 'Club',
      entry_total: 250, gender: 'Men', weight_class: '73kg',
      session_number: 2, session_platform: 'Blue',
    };
    const fetchMock = mockFetch(JSON.stringify([athlete]));

    const rows = await fetchApiAthletesWithSession('Test Meet' as never, 2, 'Blue');
    expect(rows.map((row) => row.session)).toEqual([{ number: 2, platform: 'Blue' }]);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      'https://api.meetcal.app/meets/athletes-sessions?meet=Test+Meet&session_number=2&platform=Blue',
    );

    await fetchApiAthletesWithSession('Test Meet' as never);
    expect((fetchMock.mock.calls[1] as unknown as [string])[0]).toBe(
      'https://api.meetcal.app/meets/athletes-sessions?meet=Test+Meet',
    );

    mockFetch(JSON.stringify({ athletes: [athlete] }));
    await expect(fetchApiAthletesWithSession('Test Meet' as never)).rejects.toThrow(
      '/meets/athletes-sessions expected an array response',
    );
  });

  it('rejects a single-athlete year-bests payload missing a best', async () => {
    mockFetch(JSON.stringify({ best_snatch: 100, best_cj: 120 }));
    await expect(fetchApiYearBests('Athlete A', '2025-06-20')).rejects.toThrow(
      '/lifting-results/year missing fields: best_total',
    );
  });

  it('requires an auth token for saved sessions', async () => {
    await expect(fetchSavedSessions('')).rejects.toThrow('requires an auth token');
    await expect(fetchUserPreferences('   ')).rejects.toThrow('requires an auth token');
  });

  it('rejects saved-session payloads that are not arrays', async () => {
    mockFetch(JSON.stringify({ sessions: { nope: true } }));
    await expect(fetchSavedSessions('clerk-token')).rejects.toThrow(
      '/users/me/saved-sessions.sessions expected an array response',
    );
  });

  it('rejects saved-session rows missing required fields', async () => {
    mockFetch(JSON.stringify({
      sessions: [{ session_id: 's1', meet: 'Meet' }],
    }));
    await expect(fetchSavedSessions('clerk-token')).rejects.toThrow('missing fields');
  });

  it('maps a valid saved-session payload', async () => {
    mockFetch(JSON.stringify({
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
    mockFetch(JSON.stringify({ auto_unsave_started_sessions: 'yes' }));
    await expect(fetchUserPreferences('clerk-token')).rejects.toThrow('expected a boolean');
  });

  describe('authenticated /users/me writes', () => {
    // Response shapes from meetcal-backend app/src/routes/users/saved_sessions.rs
    // (SaveSessionResponse, DeleteSavedSessionResponse,
    // DeleteSavedSessionsResponse) and preferences.rs.
    const body = {
      meet: '2026 Nationals',
      session_number: 3,
      platform: 'Red',
      weight_class: '71kg',
      start_time: '10:00 AM',
      date: '2026-06-20',
      athlete_names: ['Athlete A'],
    };

    function lastRequest(fetchMock: jest.Mock) {
      const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
      return { url, init, headers: init.headers as Record<string, string> };
    }

    it('refuses to send any write without a usable token', async () => {
      const fetchMock = mockFetch('{}');
      await expect(putSavedSession('', 's1', body)).rejects.toThrow('putSavedSession requires an auth token');
      await expect(deleteSavedSession('  ', 's1')).rejects.toThrow('deleteSavedSession requires an auth token');
      await expect(deleteSavedSessions(null as unknown as string)).rejects.toThrow(
        'deleteSavedSessions requires an auth token',
      );
      await expect(patchAutoUnsavePreference(undefined as unknown as string, true)).rejects.toThrow(
        'patchAutoUnsavePreference requires an auth token',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('PUTs one saved session to its encoded id with the bearer token and a JSON body', async () => {
      const id = '2026 Nationals/Finals-3-Red';
      const fetchMock = mockFetch(JSON.stringify({ session_id: id, updated_at: 1717171717000 }));

      await expect(putSavedSession('clerk-token', id, body)).resolves.toEqual({
        session_id: id,
        updated_at: 1717171717000,
      });

      const { url, init, headers } = lastRequest(fetchMock);
      // A `/` in a meet name must stay inside the one path segment.
      expect(url).toBe(
        'https://api.meetcal.app/users/me/saved-sessions/2026%20Nationals%2FFinals-3-Red',
      );
      expect(init.method).toBe('PUT');
      expect(headers.Authorization).toBe('Bearer clerk-token');
      expect(headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(init.body as string)).toEqual(body);
    });

    it('rejects a PUT acknowledgement that is missing or mistypes its fields', async () => {
      mockFetch(JSON.stringify({ session_id: 's1' }));
      await expect(putSavedSession('clerk-token', 's1', body)).rejects.toThrow('missing fields: updated_at');
      mockFetch(JSON.stringify({ session_id: 's1', updated_at: '1' }));
      await expect(putSavedSession('clerk-token', 's1', body)).rejects.toThrow('invalid payload');
      mockFetch('');
      await expect(putSavedSession('clerk-token', 's1', body)).rejects.toThrow('empty body');
    });

    it('surfaces 401 and 400 on a write as MeetCalApiError with the status', async () => {
      mockFetch('{"error":"unauthorized"}', 401);
      const unauthorized = await putSavedSession('clerk-token', 's1', body).catch((e: unknown) => e);
      expect(unauthorized).toBeInstanceOf(MeetCalApiError);
      expect((unauthorized as MeetCalApiError).status).toBe(401);

      mockFetch('{"error":"too many saved sessions","max":500}', 400);
      const refused = await putSavedSession('clerk-token', 's1', body).catch((e: unknown) => e);
      expect((refused as MeetCalApiError).status).toBe(400);
      expect((refused as MeetCalApiError).body).toContain('too many saved sessions');
    });

    it('DELETEs one saved session by encoded id and reads the acknowledgement', async () => {
      const fetchMock = mockFetch(JSON.stringify({ deleted: false }));
      await expect(deleteSavedSession('clerk-token', 'a b-1-Red')).resolves.toEqual({ deleted: false });
      const { url, init, headers } = lastRequest(fetchMock);
      expect(url).toBe('https://api.meetcal.app/users/me/saved-sessions/a%20b-1-Red');
      expect(init.method).toBe('DELETE');
      expect(init.body).toBeUndefined();
      expect(headers.Authorization).toBe('Bearer clerk-token');
    });

    it('scopes a bulk DELETE to one meet, or to every meet when none is given', async () => {
      const fetchMock = mockFetch(JSON.stringify({ deleted_count: 4 }));
      await expect(deleteSavedSessions('clerk-token', 'Meet & Greet')).resolves.toEqual({ deleted_count: 4 });
      expect(lastRequest(fetchMock).url).toBe(
        'https://api.meetcal.app/users/me/saved-sessions?meet=Meet+%26+Greet',
      );

      await deleteSavedSessions('clerk-token');
      expect(lastRequest(fetchMock).url).toBe('https://api.meetcal.app/users/me/saved-sessions');
      expect(lastRequest(fetchMock).init.method).toBe('DELETE');
    });

    it('does not read a malformed delete acknowledgement as success', async () => {
      // The outbox clears a pending delete once this resolves. A body that is
      // not the backend's shape (a proxy error page parsed as JSON, an older
      // envelope) must keep the delete queued, not report it done.
      mockFetch(JSON.stringify({}));
      await expect(deleteSavedSession('clerk-token', 's1')).rejects.toThrow('deleteSavedSession');
      mockFetch(JSON.stringify({ deleted: 'true' }));
      await expect(deleteSavedSession('clerk-token', 's1')).rejects.toThrow('deleteSavedSession');
      mockFetch(JSON.stringify({ error: 'nope' }));
      await expect(deleteSavedSessions('clerk-token', 'Meet')).rejects.toThrow('deleteSavedSessions');
      mockFetch(JSON.stringify({ deleted_count: '4' }));
      await expect(deleteSavedSessions('clerk-token')).rejects.toThrow('deleteSavedSessions');
      mockFetch('[]');
      await expect(deleteSavedSessions('clerk-token')).rejects.toThrow('expected an object response');
    });

    it('PATCHes the auto-unsave preference and validates the echoed flag', async () => {
      const fetchMock = mockFetch(JSON.stringify({ auto_unsave_started_sessions: true }));
      await expect(patchAutoUnsavePreference('clerk-token', true)).resolves.toEqual({
        auto_unsave_started_sessions: true,
      });
      const { url, init, headers } = lastRequest(fetchMock);
      expect(url).toBe('https://api.meetcal.app/users/me/preferences/auto-unsave');
      expect(init.method).toBe('PATCH');
      expect(JSON.parse(init.body as string)).toEqual({ enabled: true });
      expect(headers.Authorization).toBe('Bearer clerk-token');

      mockFetch(JSON.stringify({ auto_unsave_started_sessions: 'true' }));
      await expect(patchAutoUnsavePreference('clerk-token', true)).rejects.toThrow('expected a boolean');
      mockFetch(JSON.stringify({ enabled: true }));
      await expect(patchAutoUnsavePreference('clerk-token', true)).rejects.toThrow('missing fields');
    });
  });

  it('rejects search results that are not an array', async () => {
    mockFetch(JSON.stringify({
      matched_name: null,
      suggestions: ['A'],
      results: { bad: true },
    }));
    await expect(searchApi('A')).rejects.toThrow('/search.results expected an array response');
  });

  it('rejects meet packages whose collection fields are not arrays', async () => {
    mockFetch(JSON.stringify({
      meet: { name: 'Meet' },
      schedule: [],
      athletes: { nope: true },
      meet_results: [],
    }));
    await expect(fetchApiMeetPackageConditional('Test Meet')).rejects.toThrow(
      '/meets/package.athletes expected an array response',
    );
  });

  it('rejects an object where a row array endpoint is expected', async () => {
    // Callers go straight to `.filter`/`.map`, so an envelope response used to
    // surface as "rows.filter is not a function" inside a fetcher rather than
    // naming the endpoint.
    mockFetch(JSON.stringify({ rows: [] }));
    await expect(getJsonArray('/data/records')).rejects.toThrow(
      '/data/records expected an array response',
    );
  });

  it('accepts an empty row array', async () => {
    mockFetch('[]');
    await expect(getJsonArray('/data/records')).resolves.toEqual([]);
  });

  it('rejects an array where a single object is expected', async () => {
    mockFetch('[]');
    await expect(getJsonObject('/clubs/meet-stats')).rejects.toThrow(
      '/clubs/meet-stats expected an object response',
    );
  });
});

describe('conditional GETs for meet endpoints', () => {
  const originalFetch = global.fetch;

  type Reply = { status: number; etag?: string | null; body?: string };

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

  function queueFetch(replies: Reply[]) {
    const fetchMock = jest.fn(async () => {
      const reply = replies.shift();
      if (!reply) throw new Error('unexpected fetch');
      return {
        ok: reply.status >= 200 && reply.status < 300,
        status: reply.status,
        headers: {
          get: (name: string) => (name.toLowerCase() === 'etag' ? reply.etag ?? null : null),
        },
        text: async () => reply.body ?? '',
      };
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  function sentValidator(fetchMock: jest.Mock, call: number): string | undefined {
    const init = fetchMock.mock.calls[call][1] as { headers: Record<string, string> };
    return init.headers['If-None-Match'];
  }

  beforeEach(() => {
    clearHttpValidatorCache();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    clearHttpValidatorCache();
    jest.restoreAllMocks();
  });

  it('stores the ETag from a 200 and answers a 304 with the remembered meets', async () => {
    const fetchMock = queueFetch([
      { status: 200, etag: '"v1"', body: JSON.stringify([meetRow('Meet A')]) },
      { status: 304, etag: '"v1"' },
    ]);

    const first = await fetchApiMeets();
    expect(sentValidator(fetchMock, 0)).toBeUndefined();

    const second = await fetchApiMeets();
    expect(sentValidator(fetchMock, 1)).toBe('"v1"');
    expect(second).toEqual(first);
    expect(second[0].name).toBe('Meet A');
    // Freshly mapped objects each time: a caller mutating one cannot edit the cache.
    expect(second[0]).not.toBe(first[0]);
  });

  it('replaces the remembered body when the ETag changes', async () => {
    const fetchMock = queueFetch([
      { status: 200, etag: '"v1"', body: JSON.stringify([meetRow('Meet A')]) },
      { status: 200, etag: '"v2"', body: JSON.stringify([meetRow('Meet B')]) },
      { status: 304, etag: '"v2"' },
    ]);

    await fetchApiMeets();
    await expect(fetchApiMeets()).resolves.toMatchObject([{ name: 'Meet B' }]);
    expect(sentValidator(fetchMock, 1)).toBe('"v1"');
    await expect(fetchApiMeets()).resolves.toMatchObject([{ name: 'Meet B' }]);
    expect(sentValidator(fetchMock, 2)).toBe('"v2"');
  });

  it('revalidates meet details and schedule per URL', async () => {
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
    const fetchMock = jest.fn(async (url: string, init: { headers: Record<string, string> }) => {
      const isSchedule = url.includes('/meets/schedule');
      const tag = isSchedule ? '"s1"' : '"d1"';
      if (init.headers['If-None-Match'] === tag) {
        return { ok: false, status: 304, headers: { get: () => tag }, text: async () => '' };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: (name: string) => (name === 'etag' ? tag : null) },
        text: async () => JSON.stringify(isSchedule ? schedule : meetRow('Meet A')),
      };
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const first = await fetchApiSchedule('Meet A');
    const second = await fetchApiSchedule('Meet A');
    expect(second).toEqual(first);
    expect(second[0].sessions[0].platforms[0].platform).toBe('Red');

    const validators = fetchMock.mock.calls.map(([url, init]) => [
      url.includes('/meets/schedule') ? 'schedule' : 'details',
      init.headers['If-None-Match'],
    ]);
    expect(validators).toEqual(
      expect.arrayContaining([
        ['schedule', undefined],
        ['details', undefined],
        ['schedule', '"s1"'],
        ['details', '"d1"'],
      ]),
    );
  });

  it('does not remember a body that failed shape validation', async () => {
    const fetchMock = queueFetch([
      { status: 200, etag: '"bad"', body: JSON.stringify({ not: 'an array' }) },
      { status: 200, etag: '"v1"', body: JSON.stringify([meetRow('Meet A')]) },
    ]);

    await expect(fetchApiMeets()).rejects.toThrow('expected an array response');
    await expect(fetchApiMeets()).resolves.toMatchObject([{ name: 'Meet A' }]);
    expect(sentValidator(fetchMock, 1)).toBeUndefined();
  });

  it('keeps throwing on non-2xx statuses and keeps the validator for next time', async () => {
    const fetchMock = queueFetch([
      { status: 200, etag: '"v1"', body: JSON.stringify([meetRow('Meet A')]) },
      { status: 500, body: '{"error":"boom"}' },
      { status: 304, etag: '"v1"' },
    ]);

    await fetchApiMeets();
    const failure = await fetchApiMeets().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MeetCalApiError);
    expect((failure as MeetCalApiError).status).toBe(500);
    await expect(fetchApiMeets()).resolves.toMatchObject([{ name: 'Meet A' }]);
    expect(sentValidator(fetchMock, 2)).toBe('"v1"');
  });

  it('still returns 404 as null for meet details', async () => {
    queueFetch([{ status: 404, body: '{"error":"not found"}' }]);
    await expect(fetchApiMeetByName('Gone Meet')).resolves.toBeNull();
  });

  it('bounds the number of remembered URLs', async () => {
    const replies: Reply[] = [];
    for (let i = 0; i <= HTTP_VALIDATOR_CACHE_LIMIT; i += 1) {
      replies.push({ status: 200, etag: `"d${i}"`, body: JSON.stringify(meetRow(`Meet ${i}`)) });
    }
    // Meet 0 is the oldest entry and was evicted: no validator, full body.
    replies.push({ status: 200, etag: '"d0"', body: JSON.stringify(meetRow('Meet 0')) });
    const fetchMock = queueFetch(replies);

    for (let i = 0; i <= HTTP_VALIDATOR_CACHE_LIMIT; i += 1) {
      await fetchApiMeetByName(`Meet ${i}`);
    }
    await expect(fetchApiMeetByName('Meet 0')).resolves.toMatchObject({ name: 'Meet 0' });
    expect(sentValidator(fetchMock, HTTP_VALIDATOR_CACHE_LIMIT + 1)).toBeUndefined();
  });

  it('answers a 304 from the entry read before the request, even if it was evicted in flight', async () => {
    let releaseFirst: (() => void) | undefined;
    const fetchMock = jest.fn(async (url: string, init: { headers: Record<string, string> }) => {
      const name = new URL(url).searchParams.get('meet') ?? '';
      if (init.headers['If-None-Match']) {
        // Hold the revalidation until the cache has been churned.
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        return { ok: false, status: 304, headers: { get: () => init.headers['If-None-Match'] }, text: async () => '' };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: (h: string) => (h === 'etag' ? `"${name}"` : null) },
        text: async () => JSON.stringify(meetRow(name)),
      };
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await fetchApiMeetByName('Meet 0');
    const pending = fetchApiMeetByName('Meet 0');
    for (let i = 1; i <= HTTP_VALIDATOR_CACHE_LIMIT; i += 1) {
      await fetchApiMeetByName(`Meet ${i}`);
    }
    releaseFirst?.();
    await expect(pending).resolves.toMatchObject({ name: 'Meet 0' });
  });

  it('answers a 304 with the newer entry a concurrent request stored in flight', async () => {
    let releaseSlow: (() => void) | undefined;
    let conditionalCalls = 0;
    const fetchMock = jest.fn(async (_url: string, init: { headers: Record<string, string> }) => {
      if (!init.headers['If-None-Match']) {
        return {
          ok: true,
          status: 200,
          headers: { get: (h: string) => (h === 'etag' ? '"v1"' : null) },
          text: async (): Promise<string> => JSON.stringify([meetRow('Meet A')]),
        };
      }
      conditionalCalls += 1;
      if (conditionalCalls === 1) {
        // The slow revalidation: the server answered while "v1" was current.
        await new Promise<void>((resolve) => {
          releaseSlow = resolve;
        });
        return { ok: false, status: 304, headers: { get: () => '"v1"' }, text: async (): Promise<string> => '' };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: (h: string) => (h === 'etag' ? '"v2"' : null) },
        text: async (): Promise<string> => JSON.stringify([meetRow('Meet B')]),
      };
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await fetchApiMeets();
    const slow = fetchApiMeets();
    await expect(fetchApiMeets()).resolves.toMatchObject([{ name: 'Meet B' }]);
    releaseSlow?.();
    await expect(slow).resolves.toMatchObject([{ name: 'Meet B' }]);
  });

  it('retries without a validator when a 304 names a different ETag than was sent', async () => {
    const fetchMock = queueFetch([
      { status: 200, etag: '"v1"', body: JSON.stringify([meetRow('Meet A')]) },
      { status: 304, etag: '"other"' },
      { status: 200, etag: '"v2"', body: JSON.stringify([meetRow('Meet B')]) },
    ]);

    await fetchApiMeets();
    await expect(fetchApiMeets()).resolves.toMatchObject([{ name: 'Meet B' }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sentValidator(fetchMock, 1)).toBe('"v1"');
    expect(sentValidator(fetchMock, 2)).toBeUndefined();
  });

  it('treats a 304 to a request that carried no validator as an error, as before', async () => {
    queueFetch([{ status: 304, etag: '"v1"' }]);
    const failure = await fetchApiMeets().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MeetCalApiError);
    expect((failure as MeetCalApiError).status).toBe(304);
  });

  it('accepts a weak form of the sent ETag on a 304', async () => {
    queueFetch([
      { status: 200, etag: '"v1"', body: JSON.stringify([meetRow('Meet A')]) },
      { status: 304, etag: 'W/"v1"' },
    ]);
    await fetchApiMeets();
    await expect(fetchApiMeets()).resolves.toMatchObject([{ name: 'Meet A' }]);
  });

  it('forgets the validator when a 200 carries no ETag', async () => {
    const fetchMock = queueFetch([
      { status: 200, etag: '"v1"', body: JSON.stringify([meetRow('Meet A')]) },
      { status: 200, etag: null, body: JSON.stringify([meetRow('Meet B')]) },
      { status: 200, etag: null, body: JSON.stringify([meetRow('Meet B')]) },
    ]);
    await fetchApiMeets();
    await fetchApiMeets();
    await fetchApiMeets();
    expect(sentValidator(fetchMock, 2)).toBeUndefined();
  });
});

describe('conditional GETs for reference data', () => {
  const originalFetch = global.fetch;

  type Reply = { status: number; etag?: string | null; body?: unknown };

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

  function queueFetch(replies: Reply[]) {
    const fetchMock = jest.fn(async (_url: string, _init: { headers: Record<string, string> }) => {
      const reply = replies.shift();
      if (!reply) throw new Error('unexpected fetch');
      return {
        ok: reply.status >= 200 && reply.status < 300,
        status: reply.status,
        headers: {
          get: (name: string) => (name.toLowerCase() === 'etag' ? reply.etag ?? null : null),
        },
        text: async () => (reply.body === undefined ? '' : JSON.stringify(reply.body)),
      };
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  function sentValidator(fetchMock: jest.Mock, call: number): string | undefined {
    const init = fetchMock.mock.calls[call][1] as { headers: Record<string, string> };
    return init.headers['If-None-Match'];
  }

  beforeEach(() => {
    clearHttpValidatorCache();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    clearHttpValidatorCache();
    jest.restoreAllMocks();
  });

  it('answers a 304 with the rows validated when the ETag was stored', async () => {
    const fetchMock = queueFetch([
      { status: 200, etag: '"r1"', body: [recordRow()] },
      { status: 304, etag: '"r1"' },
    ]);

    const first = await fetchApiRecords();
    const second = await fetchApiRecords();

    expect(sentValidator(fetchMock, 0)).toBeUndefined();
    expect(sentValidator(fetchMock, 1)).toBe('"r1"');
    expect(second).toBe(first);
    expect(second).toEqual([recordRow()]);
  });

  it('hands out frozen rows, so a caller cannot rewrite what the next 304 returns', async () => {
    queueFetch([
      { status: 200, etag: '"r1"', body: [recordRow()] },
      { status: 304, etag: '"r1"' },
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
    queueFetch([
      { status: 200, etag: '"w1"', body: ['Ohio', 'Carolina'] },
      { status: 304, etag: '"w1"' },
    ]);

    const first = await fetchApiWsoList();
    first.sort();
    first.push('Mutated');
    await expect(fetchApiWsoList()).resolves.toEqual(['Ohio', 'Carolina']);
  });

  it('replaces the remembered rows when the ETag changes', async () => {
    const fetchMock = queueFetch([
      { status: 200, etag: '"s1"', body: [{ age_category: 'Senior', gender: 'Men', weight_class: '89kg', standard_a: 300, standard_b: 280 }] },
      { status: 200, etag: '"s2"', body: [{ age_category: 'Senior', gender: 'Men', weight_class: '89kg', standard_a: 310, standard_b: 290 }] },
      { status: 304, etag: '"s2"' },
    ]);

    await fetchApiStandards();
    await expect(fetchApiStandards()).resolves.toMatchObject([{ standard_a: 310 }]);
    expect(sentValidator(fetchMock, 1)).toBe('"s1"');
    await expect(fetchApiStandards()).resolves.toMatchObject([{ standard_a: 310 }]);
    expect(sentValidator(fetchMock, 2)).toBe('"s2"');
  });

  it('passes straight through on a route that sends no ETag', async () => {
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
    const fetchMock = queueFetch([
      { status: 200, etag: null, body: [row] },
      { status: 200, etag: null, body: [{ ...row, total: 385 }] },
    ]);

    await expect(fetchApiIntlRankings()).resolves.toEqual([row]);
    await expect(fetchApiIntlRankings()).resolves.toEqual([{ ...row, total: 385 }]);
    expect(sentValidator(fetchMock, 0)).toBeUndefined();
    expect(sentValidator(fetchMock, 1)).toBeUndefined();
  });

  it('throws on a body that fails validation and caches nothing', async () => {
    const fetchMock = queueFetch([
      { status: 200, etag: '"bad"', body: { error: 'wrapped' } },
      { status: 200, etag: '"q1"', body: [] },
      { status: 200, etag: '"c-bad"', body: ['Club A', 7] },
      { status: 200, etag: '"c1"', body: ['Club A'] },
    ]);

    await expect(fetchApiQualifyingTotals()).rejects.toThrow(
      '/data/qualifying-totals expected an array response',
    );
    await expect(fetchApiQualifyingTotals()).resolves.toEqual([]);
    expect(sentValidator(fetchMock, 1)).toBeUndefined();

    await expect(fetchApiClubNames()).rejects.toThrow('/clubs expected a string array response');
    await expect(fetchApiClubNames()).resolves.toEqual(['Club A']);
    expect(sentValidator(fetchMock, 3)).toBeUndefined();
  });

  it('reads a wrong-typed column as null and skips a non-object row', async () => {
    queueFetch([
      {
        status: 200,
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

  it('remembers each query variant under its own URL', async () => {
    const fetchMock = jest.fn(async (url: string, init: { headers: Record<string, string> }) => {
      const params = new URL(url).searchParams;
      const key = [params.get('age_category'), params.get('gender'), params.get('wso')].join('|');
      const tag = `"${key}"`;
      if (init.headers['If-None-Match'] === tag) {
        return { ok: false, status: 304, headers: { get: () => tag }, text: async () => '' };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: (name: string) => (name === 'etag' ? tag : null) },
        text: async () => JSON.stringify([{ name: key, total: 1, weight_class: '71kg', snatch: 1, cj: 1 }]),
      };
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    for (let pass = 0; pass < 2; pass += 1) {
      await expect(fetchApiNationalRankings('USAW', 'Senior 89')).resolves.toMatchObject([{ name: 'Senior 89||' }]);
      await expect(fetchApiNationalRankings('USAW', 'Junior 89')).resolves.toMatchObject([{ name: 'Junior 89||' }]);
      await expect(fetchApiAdaptiveRecords('Men', 'BWL')).resolves.toMatchObject([{ weight_class: '71kg' }]);
      await expect(fetchApiAdaptiveRecords('Women', 'BWL')).resolves.toMatchObject([{ weight_class: '71kg' }]);
      await expect(fetchApiWsoRecords('Ohio', 'Senior', 'Men')).resolves.toHaveLength(1);
    }

    const validators = fetchMock.mock.calls.map(([, init]) => init.headers['If-None-Match']);
    expect(validators.slice(0, 5)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(validators.slice(5)).toEqual([
      '"Senior 89||"',
      '"Junior 89||"',
      '"|Men|"',
      '"|Women|"',
      '"Senior|Men|Ohio"',
    ]);
  });

  it('keeps the meets validator through a session of reference-data browsing', async () => {
    const fetchMock = jest.fn(async (url: string, init: { headers: Record<string, string> }) => {
      const parsed = new URL(url);
      const tag = `"${parsed.pathname}?${parsed.searchParams.toString()}"`;
      if (init.headers['If-None-Match'] === tag) {
        return { ok: false, status: 304, headers: { get: () => tag }, text: async () => '' };
      }
      let body: unknown = [];
      if (parsed.pathname === '/meets') body = [];
      else if (parsed.pathname === '/meets/details') body = { name: 'M', start_date: '2026-06-20', end_date: '2026-06-21', time_zone: 'America/New_York' };
      else if (parsed.pathname === '/data/wso/' || parsed.pathname === '/clubs') body = ['A'];
      return {
        ok: true,
        status: 200,
        headers: { get: (name: string) => (name === 'etag' ? tag : null) },
        text: async () => JSON.stringify(body),
      };
    });
    global.fetch = fetchMock as unknown as typeof fetch;

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

    fetchMock.mockClear();
    await fetchApiMeets();
    expect(fetchMock.mock.calls[0][1].headers['If-None-Match']).toBe('"/meets?"');
  });
});

describe('by-names latest_only', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends latest_only only when asked', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify([]),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await fetchApiResultsByNames(['Athlete A'], { latestOnly: true });
    await fetchApiResultsByNames(['Athlete A']);
    await fetchApiResultsByNames(['Athlete A'], { latestOnly: false });

    const bodies = fetchMock.mock.calls.map(
      (call) => JSON.parse((call as unknown as [string, { body: string }])[1].body),
    );
    expect(bodies).toEqual([
      { names: ['Athlete A'], latest_only: true },
      { names: ['Athlete A'] },
      { names: ['Athlete A'] },
    ]);
  });

  it('keeps latest_only on every chunk', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify([]),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const names = Array.from({ length: SMALL_ROWS_NAMES_CHUNK_SIZE + 1 }, (_, i) => `Athlete ${i}`);

    await fetchApiResultsByNames(names, { latestOnly: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      const body = JSON.parse((call as unknown as [string, { body: string }])[1].body);
      expect(body.latest_only).toBe(true);
    }
  });
});
