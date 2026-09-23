import {
  APP_VERSION,
  buildApiUrl,
  defaultCutoffDate,
  fetchApiClubNames,
  fetchApiMeetPackageConditional,
  fetchApiMeets,
  fetchApiMeetPackage,
  fetchApiRecentResultsByNames,
  fetchApiResultsByNames,
  fetchApiYearBestsByNames,
  fetchApiWsoAgeGroups,
  fetchApiWsoList,
  fetchSavedSessions,
  fetchUserPreferences,
  formatApiTime,
  getJsonArray,
  getJsonObject,
  mapApiAthlete,
  mapApiAthletes,
  mapApiLiftingResult,
  mapApiMeet,
  mapApiSchedule,
  mapApiYearBests,
  mapPackageSchedule,
  MeetCalApiError,
  MeetCalApiTimeoutError,
  NAMES_QUERY_CHUNK_SIZE,
  searchApi,
} from './meetcal-api';

// Hoisted by jest above the imports; placed here to satisfy import/first.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '6.2.0' } },
}));

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

  it('always sends a cutoff for recent results, defaulting to two years', async () => {
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
    expect(body.cutoff_date).toBe(defaultCutoffDate(2));
  });

  it('computes default cutoffs as ISO dates N years back', () => {
    expect(defaultCutoffDate(1, new Date('2026-09-23T12:00:00Z'))).toBe('2025-09-23');
    expect(defaultCutoffDate(2, new Date('2026-09-23T12:00:00Z'))).toBe('2024-09-23');
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
      'https://api.meetcal.app/meets/package?meet=Test+Meet&history_cutoff_date=2024-01-01',
      expect.objectContaining({
        headers: expect.objectContaining({ 'If-None-Match': '"abc"' }),
      }),
    );
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
    await expect(fetchApiMeetPackage('Test Meet')).rejects.toThrow(
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
