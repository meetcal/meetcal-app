import {
  APP_VERSION,
  buildApiUrl,
  defaultCutoffDate,
  fetchApiClubNames,
  fetchApiMeetPackageConditional,
  fetchApiMeets,
  fetchApiRecentResultsByNames,
  fetchApiResultsByNames,
  fetchApiYearBestsByNames,
  fetchApiWsoAgeGroups,
  fetchApiWsoList,
  fetchUserPreferences,
  formatApiTime,
  mapApiAthlete,
  mapApiLiftingResult,
  mapApiMeet,
  mapApiSchedule,
  mapApiYearBests,
  mapPackageSchedule,
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
});
