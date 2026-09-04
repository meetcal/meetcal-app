import {
  buildApiUrl,
  fetchApiClubNames,
  fetchApiMeets,
  fetchApiMeetPackage,
  fetchApiResultsByNames,
  fetchApiYearBestsByNames,
  fetchApiWsoAgeGroups,
  fetchApiWsoList,
  fetchSavedSessions,
  fetchUserPreferences,
  formatApiTime,
  mapApiAthlete,
  mapApiLiftingResult,
  mapApiMeet,
  mapApiSchedule,
  mapApiYearBests,
  mapPackageSchedule,
  NAMES_QUERY_CHUNK_SIZE,
  searchApi,
} from './meetcal-api';

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

  it('reads wrapped WSO list responses from deployed API versions', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ wsos: ['Carolina', 'Ohio'] }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(fetchApiWsoList()).resolves.toEqual(['Carolina', 'Ohio']);
  });

  it('fetches batch year bests with encoded names', async () => {
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
      'https://api.meetcal.app/lifting-results/bests?names=Athlete+A%2CAthlete+B&cutoff_date=2025-06-19',
      expect.any(Object),
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
    expect(summer.time.abbreviation).toMatch(/E[SD]T/);
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
});
