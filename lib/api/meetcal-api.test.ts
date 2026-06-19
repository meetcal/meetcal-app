import {
  buildApiUrl,
  fetchApiClubNames,
  fetchApiMeets,
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
});
