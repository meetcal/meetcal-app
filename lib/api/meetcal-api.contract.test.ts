/**
 * @jest-environment-options {"deviceTimeZone": "America/Los_Angeles"}
 */
/**
 * Contract fixtures: the bodies below are the literal JSON `serde_json` emits
 * for the backend's response structs (meetcal-backend `app/src/routes/...`),
 * with the values its integration tests insert (`app/tests/meets.rs`,
 * `users.rs`, `results.rs`). They are fed through the real client with
 * `fetch` stubbed to return the *string*, never a JS object re-serialised by
 * a helper, so a serde quirk the mappers must tolerate — `45.0` for an `f64`
 * session number, `null` for an `Option`, an `i64` millisecond timestamp, a
 * `BTreeMap` keyed by name, a section left out by `skip_serializing_if` —
 * reaches `JSON.parse` exactly as it does on a phone.
 */
import {
  clearHttpValidatorCache,
  fetchApiAthletesWithSession,
  fetchApiMeetPackageConditional,
  fetchApiMeets,
  fetchApiResultsByNames,
  fetchApiSchedule,
  fetchApiYearBestsByNames,
  fetchSavedSessions,
  mapApiAthletes,
  mapApiYearBests,
  mapPackageSchedule,
  searchApi,
} from './meetcal-api';
import type { MeetName } from '@/data/types/meet';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '6.2.0' } },
}));
jest.mock('expo-application', () => ({
  __esModule: true,
  nativeApplicationVersion: '6.1.9',
}));

const MEET = '2026 USA Weightlifting National Championships, Powered by Rogue Fitness' as MeetName;

// --- serde output, verbatim -------------------------------------------------

/** `Vec<Meets>` (`routes/meets/types.rs`), the row `tests/meets.rs` inserts. */
const MEETS_JSON =
  '[{"id":"test-meet-freshness","federation":"USAW","end_date":"2026-10-02",' +
  '"name":"Freshness Test Meet","start_date":"2026-10-01","time_zone":"America/New_York",' +
  '"venue_city":"c","venue_name":"v","venue_state":"OH","venue_street":"s","venue_zip":"43215",' +
  '"status":"upcoming","venue_map_pdf_url":null,"venue_map_apple_url":null}]';

/** `Vec<MeetSchedule>`: `session_id` is an `f64`, so serde writes `45.0`. */
const SCHEDULE_JSON =
  `[{"date":"2026-06-20","meet":"${MEET}","platform":"Red","session_id":45.0,` +
  '"start_time":"08:00:00","weigh_in_time":"06:00:00","weight_class":"+110"},' +
  `{"date":"2026-06-20","meet":"${MEET}","platform":"Blue","session_id":45.0,` +
  '"start_time":"08:00:00","weigh_in_time":"06:00:00","weight_class":"110"}]';

/**
 * `Vec<SessionsAthletes>` (`get_sessions_for_athletes.rs`). The second row is
 * the LEFT JOIN case `tests/meets.rs` covers: registered before sessions were
 * assigned, so every session field is `None`.
 */
const ATHLETES_SESSIONS_JSON =
  '[{"member_id":"1","name":"Package Test Lifter","age":30.0,"club":"Test Club","wso":null,' +
  '"gender":"Male","weight_class":"89","entry_total":250.0,"adaptive":false,' +
  '"session_number":45.0,"session_platform":"Red","date":"2026-06-20",' +
  '"start_time":"08:00:00","weigh_in_time":"06:00:00"},' +
  '{"member_id":"0","name":"Test Unassigned","age":25.0,"club":"Test Club","wso":null,' +
  '"gender":"Male","weight_class":"89","entry_total":200.0,"adaptive":false,' +
  '"session_number":null,"session_platform":null,"date":null,"start_time":null,' +
  '"weigh_in_time":null}]';

/** One `LiftingResults` row (`routes/results/types.rs`): `id` is an `i64`, lifts are `f64`. */
function liftingResultJson(id: number, eventId: string, meet: string, date: string): string {
  return (
    `{"id":${id},"event_id":"${eventId}","federation":"USAW","meet":"${meet}","date":"${date}",` +
    '"name":"Bounded History Lifter","age":"Open Men\'s 89kg","body_weight":88.0,' +
    '"snatch1":90.0,"snatch2":0.0,"snatch3":0.0,"snatch_best":90.0,' +
    '"cj1":110.0,"cj2":0.0,"cj3":0.0,"cj_best":110.0,"total":200.0,"adaptive":false}'
  );
}

/**
 * `MeetPackage` for `include=year_bests` (`get_meet_package.rs`): the two
 * sections not asked for are `None` and `skip_serializing_if` drops the keys
 * entirely rather than writing `null`.
 */
const PACKAGE_JSON =
  '{"meet":{"id":"test-meet-freshness","name":"Freshness Test Meet","federation":"USAW",' +
  '"status":"upcoming","start_date":"2026-10-01","end_date":"2026-10-02",' +
  '"time_zone":"America/New_York","venue_name":"v","venue_street":"s","venue_city":"c",' +
  '"venue_state":"OH","venue_zip":"43215","venue_map_pdf_url":null,"venue_map_apple_url":null},' +
  '"schedule":[{"date":"2026-10-01","sessions":[{"session_id":1.0,"start_time":"09:00:00",' +
  '"weigh_in_time":"07:00:00","platforms":[{"platform":"Red","weight_class":"89"}]}]}],' +
  '"athletes":[{"member_id":"1","name":"Package Test Lifter","age":30.0,"club":"Test Club",' +
  '"wso":null,"gender":"Male","weight_class":"89","entry_total":250.0,"adaptive":false,' +
  '"session":{"session_number":1.0,"session_platform":"Red","date":"2026-10-01",' +
  '"start_time":"09:00:00","weigh_in_time":"07:00:00"}}],' +
  '"meet_results":[],' +
  '"year_bests_by_name":{"Package Test Lifter":{"best_snatch":95.0,"best_cj":110.0,"best_total":205.0}}}';

/** `BTreeMap<String, YearBests>`: keys come out sorted, values are `f64`. */
const YEAR_BESTS_JSON =
  '{"Another Lifter":{"best_snatch":0.0,"best_cj":0.0,"best_total":0.0},' +
  '"Package Test Lifter":{"best_snatch":95.0,"best_cj":110.0,"best_total":205.0}}';

/**
 * `SavedSessionsResponse` (`routes/users/saved_sessions.rs`). The first row is
 * the lifecycle test's PUT read back; the second is the bulk test's, saved
 * with only the three required fields, so every `Option` is `null` and the
 * `COALESCE`d `athlete_names` is `[]`. `updated_at` is `i64` milliseconds.
 */
const SAVED_SESSIONS_JSON =
  `{"sessions":[{"session_id":"2026-Nationals-45-Red","meet":"${MEET}",` +
  '"session_number":45.0,"platform":"Red","weight_class":"+110","start_time":"08:00:00",' +
  '"date":"2026-06-20","notes":"test note","athlete_names":["Kyle Schulman"],' +
  '"updated_at":1718880000123},' +
  `{"session_id":"2026-Nationals-45-Red-Bulk","meet":"${MEET}",` +
  '"session_number":45.0,"platform":"Red","weight_class":null,"start_time":null,' +
  '"date":null,"notes":null,"athlete_names":[],"updated_at":1718880000456}]}';

// --- harness ----------------------------------------------------------------

type FetchCall = { url: string; init: RequestInit | undefined };

/**
 * A `fetch` that answers every request with the literal `text`. Nothing here
 * re-serialises: what the client parses is the string this file declares.
 */
function stubFetch(text: string, options: { etag?: string } = {}): FetchCall[] {
  const calls: FetchCall[] = [];
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name === 'etag' ? options.etag ?? null : null) },
      text: async () => text,
    };
  }) as unknown as typeof fetch;
  return calls;
}

describe('meetcal API contract (serde output through the real client)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    clearHttpValidatorCache();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('fetchApiMeets: /meets row with null map links and a known zone', async () => {
    stubFetch(MEETS_JSON);

    const [meet] = await fetchApiMeets();

    expect(meet).toMatchObject({
      id: 'test-meet-freshness',
      name: 'Freshness Test Meet',
      status: 'upcoming',
      venue: {
        name: 'v',
        address: { street: 's', city: 'c', state: 'OH', zip: '43215' },
      },
      venueMapPdfUrl: null,
      venueMapAppleUrl: null,
      dates: { start: '2026-10-01', end: '2026-10-02' },
      timeZoneUnknown: false,
    });
    // Every time field derives from the same zone, read at the meet's date
    // (October 1st is still daylight time in New York). `utcOffset` is the
    // app's convention: hours behind UTC, positive west of Greenwich.
    expect(meet.time).toEqual({
      timeZone: 'America/New_York',
      timeZoneIdentifier: 'America/New_York',
      abbreviation: 'EDT',
      utcOffset: 4,
    });
  });

  it('fetchApiSchedule: f64 session_id and HH:MM:SS times become one session with two platforms', async () => {
    stubFetch(MEETS_JSON);
    const [meet] = await fetchApiMeets();
    const calls = stubFetch(SCHEDULE_JSON);

    const schedule = await fetchApiSchedule(MEET, meet);

    // The meet was supplied, so only the schedule round trip happens.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      `https://api.meetcal.app/meets/schedule?meet=${encodeURIComponent(MEET).replace(/%20/g, '+')}`,
    );
    expect(schedule).toEqual([
      {
        date: 'June 20, 2026',
        fullDate: '2026-06-20',
        sessions: [
          {
            id: '45',
            number: 45,
            startTime: '8:00 AM',
            weighInTime: '6:00 AM',
            platforms: [
              { platform: 'Red', weightClass: '+110', platformStartTime: '8:00 AM' },
              { platform: 'Blue', weightClass: '110', platformStartTime: '8:00 AM' },
            ],
          },
        ],
      },
    ]);
    expect(Number.isInteger(schedule[0].sessions[0].number)).toBe(true);
  });

  it('fetchApiAthletesWithSession: an assigned row and a null-session row both survive', async () => {
    stubFetch(ATHLETES_SESSIONS_JSON);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const athletes = await fetchApiAthletesWithSession(MEET);

    expect(warn).not.toHaveBeenCalled();
    expect(athletes).toEqual([
      {
        memberId: '1',
        name: 'Package Test Lifter',
        age: 30,
        club: 'Test Club',
        wso: undefined,
        gender: 'Male',
        weightClass: '89',
        entryTotal: 250,
        adaptive: false,
        session: {
          number: 45,
          platform: 'Red',
          date: '2026-06-20',
          startTime: '8:00 AM',
          weighInTime: '6:00 AM',
        },
      },
      {
        memberId: '0',
        name: 'Test Unassigned',
        age: 25,
        club: 'Test Club',
        wso: undefined,
        gender: 'Male',
        weightClass: '89',
        entryTotal: 200,
        adaptive: false,
        session: undefined,
      },
    ]);
  });

  it('fetchApiAthletesWithSession: a session+platform query narrows server-side by session only, then filters locally', async () => {
    const calls = stubFetch(ATHLETES_SESSIONS_JSON);

    const athletes = await fetchApiAthletesWithSession(MEET, 45, 'red');

    expect(calls[0].url).toContain('session_number=45');
    expect(calls[0].url).not.toContain('platform=');
    expect(athletes.map((a) => a.name)).toEqual(['Package Test Lifter']);
  });

  it('fetchApiMeetPackageConditional: include=year_bests package with the other sections absent', async () => {
    const calls = stubFetch(PACKAGE_JSON, { etag: '"pkg-v1"' });

    const result = await fetchApiMeetPackageConditional(MEET, '2024-01-01', null);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('include=year_bests');
    expect(calls[0].url).toContain('history_cutoff_date=2024-01-01');
    expect(result.status).toBe('fresh');
    if (result.status !== 'fresh') throw new Error('unreachable');
    expect(result.etag).toBe('"pkg-v1"');

    const pkg = result.package;
    // `skip_serializing_if = "Option::is_none"`: the keys are missing, not null.
    expect('recent_results_by_name' in pkg).toBe(false);
    expect('attempt_estimates' in pkg).toBe(false);
    expect(pkg.meet_results).toEqual([]);
    expect(pkg.meet.id).toBe('test-meet-freshness');

    expect(mapApiAthletes(pkg.athletes, '/meets/package')).toEqual([
      {
        memberId: '1',
        name: 'Package Test Lifter',
        age: 30,
        club: 'Test Club',
        wso: undefined,
        gender: 'Male',
        weightClass: '89',
        entryTotal: 250,
        adaptive: false,
        session: {
          number: 1,
          platform: 'Red',
          date: '2026-10-01',
          startTime: '9:00 AM',
          weighInTime: '7:00 AM',
        },
      },
    ]);

    expect(mapPackageSchedule(pkg)).toEqual([
      {
        date: 'October 1, 2026',
        fullDate: '2026-10-01',
        sessions: [
          {
            id: '1',
            number: 1,
            startTime: '9:00 AM',
            weighInTime: '7:00 AM',
            platforms: [{ platform: 'Red', weightClass: '89', platformStartTime: '9:00 AM' }],
          },
        ],
      },
    ]);

    expect(mapApiYearBests(pkg.year_bests_by_name!['Package Test Lifter'])).toEqual({
      bestSnatch: 95,
      bestCJ: 110,
      bestTotal: 205,
    });
  });

  it('fetchApiYearBestsByNames: a BTreeMap keyed by name maps every entry', async () => {
    const calls = stubFetch(YEAR_BESTS_JSON);

    const bests = await fetchApiYearBestsByNames(['Package Test Lifter', 'Another Lifter'], '2025-01-01');

    expect(calls).toHaveLength(1);
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      names: ['Package Test Lifter', 'Another Lifter'],
      cutoff_date: '2025-01-01',
    });
    expect(bests).toEqual({
      'Another Lifter': { bestSnatch: 0, bestCJ: 0, bestTotal: 0 },
      'Package Test Lifter': { bestSnatch: 95, bestCJ: 110, bestTotal: 205 },
    });
  });

  it('fetchApiResultsByNames: i64 id, string age and 0.0 misses map without turning zeros into nulls', async () => {
    stubFetch(
      `[${liftingResultJson(41001, 'b1', 'Bounded Meet A', '2024-01-10')},` +
        `${liftingResultJson(41002, 'b2', 'Bounded Meet B', '2024-03-10')}]`,
    );

    const rows = await fetchApiResultsByNames(['Bounded History Lifter']);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      id: 41001,
      event_id: 'b1',
      meet: 'Bounded Meet A',
      date: '2024-01-10',
      name: 'Bounded History Lifter',
      age: "Open Men's 89kg",
      body_weight: 88,
      snatch1: 90,
      snatch2: 0,
      snatch3: 0,
      snatch_best: 90,
      cj1: 110,
      cj2: 0,
      cj3: 0,
      cj_best: 110,
      total: 200,
    });
    expect(rows[1]).toMatchObject({ id: 41002, event_id: 'b2', meet: 'Bounded Meet B' });
  });

  it('searchApi: a partial query answers matched_name null with suggestions', async () => {
    stubFetch('{"matched_name":null,"suggestions":["Alexander Nordstrom"],"results":[]}');

    await expect(searchApi('Alexan', '2025-01-01', '2025-12-31')).resolves.toEqual({
      matchedName: null,
      suggestions: ['Alexander Nordstrom'],
      results: [],
    });
  });

  it('searchApi: an exact match carries matched_name and LiftingResults rows', async () => {
    stubFetch(
      '{"matched_name":"Alexander Nordstrom","suggestions":[],"results":[' +
        `${liftingResultJson(7, 'e7', 'Search Meet', '2025-05-10')}]}`,
    );

    const search = await searchApi('Alexander Nordstrom', '2025-01-01', '2025-12-31');

    expect(search.matchedName).toBe('Alexander Nordstrom');
    expect(search.suggestions).toEqual([]);
    expect(search.results).toHaveLength(1);
    expect(search.results[0]).toMatchObject({
      id: 7,
      event_id: 'e7',
      meet: 'Search Meet',
      age: "Open Men's 89kg",
      total: 200,
    });
  });

  it('fetchSavedSessions: f64 session_number, null Options, [] athlete_names and i64 updated_at', async () => {
    const calls = stubFetch(SAVED_SESSIONS_JSON);

    const sessions = await fetchSavedSessions('clerk-token');

    expect(calls[0].url).toBe('https://api.meetcal.app/users/me/saved-sessions');
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe(
      'Bearer clerk-token',
    );
    expect(sessions).toEqual([
      {
        session_id: '2026-Nationals-45-Red',
        meet: MEET,
        session_number: 45,
        platform: 'Red',
        weight_class: '+110',
        start_time: '08:00:00',
        date: '2026-06-20',
        notes: 'test note',
        athlete_names: ['Kyle Schulman'],
        updated_at: 1718880000123,
      },
      {
        session_id: '2026-Nationals-45-Red-Bulk',
        meet: MEET,
        session_number: 45,
        platform: 'Red',
        weight_class: null,
        start_time: null,
        date: null,
        notes: null,
        athlete_names: [],
        updated_at: 1718880000456,
      },
    ]);
    expect(Number.isSafeInteger(sessions[0].updated_at)).toBe(true);
  });
});
