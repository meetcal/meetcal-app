/**
 * @jest-environment-options {"deviceTimeZone": "America/Los_Angeles"}
 */
/**
 * Contract fixtures: the bodies below are the literal JSON `serde_json` emits
 * for the backend's response structs (meetcal-backend `app/src/routes/...`),
 * with the values its integration tests insert (`app/tests/meets.rs`,
 * `users.rs`, `results.rs`). The Convex functions in `convex/` answer the
 * same shapes, with one exception: name-keyed bests (the Rust `BTreeMap`)
 * travel as a byte-ordered list of `{ name, best_snatch, best_cj, best_total }`
 * because Convex object keys must be ASCII and athlete names are not; the
 * client turns the list back into the map the app reads. They are fed through the real client
 * with only the transport stubbed: each answer is `JSON.parse` of the literal
 * string, never a JS object built by a helper, so a serde quirk the mappers
 * must tolerate — `45.0` for an `f64` session number, `null` for an `Option`,
 * an `i64` millisecond timestamp, a name-keyed bests list, a section left
 * out by `skip_serializing_if` — reaches the client as the wire would deliver
 * it.
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
  resetServerClockForTests,
  searchApi,
} from './meetcal-api';
import { isClockCall } from './json-transport-stub';
import { setApiTransportForTests, type ApiCall } from './transport';
import type { MeetName } from '@/data/types/meet';

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
 * entirely rather than writing `null`. The bests are `year_bests`, a list
 * (`convex/meets.ts` `yearBestsForNames`), where the Rust API sent the
 * `year_bests_by_name` map.
 */
function packageJson(yearBests: string): string {
  return PACKAGE_JSON_HEAD + `"year_bests":${yearBests}}`;
}

const PACKAGE_JSON_HEAD =
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
  '"meet_results":[],';

const PACKAGE_JSON = packageJson(
  '[{"name":"Package Test Lifter","best_snatch":95.0,"best_cj":110.0,"best_total":205.0}]',
);

/**
 * `results:bests` (`convex/results.ts`): one row per requested spelling in
 * byte order of name, unknown names with zeros; values are `f64`-shaped.
 */
const YEAR_BESTS_JSON =
  '[{"name":"Another Lifter","best_snatch":0.0,"best_cj":0.0,"best_total":0.0},' +
  '{"name":"Package Test Lifter","best_snatch":95.0,"best_cj":110.0,"best_total":205.0}]';

/**
 * Names outside ASCII, which a Convex object could not have carried as keys.
 * The first arrives JSON-escaped (`\u00e9`), the others as raw UTF-8.
 */
const NON_ASCII_BESTS_JSON =
  '[{"name":"Andr\\u00e9s \\u00c1lvarez","best_snatch":88.0,"best_cj":112.0,"best_total":200.0},' +
  '{"name":"Zoë Ørsted","best_snatch":70.0,"best_cj":90.0,"best_total":160.0},' +
  '{"name":"李娜","best_snatch":0.0,"best_cj":0.0,"best_total":0.0}]';

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

/** The unconditional queries that answer their rows as JSON text (`{ json }`). */
const JSON_TEXT_FNS = new Set([
  'meets:athletes',
  'meets:athletesSessions',
  'results:byNames',
  'results:recent',
]);

type AnswerForm = 'text' | 'structured';

/**
 * A transport that answers each Convex function from `routes`. Nothing here
 * re-serialises: what the client decodes is the string this file declares.
 *
 * - `text` (the default, what `convex/` sends): a conditional query answers
 *   `{ etag, json }` and the four row lists `{ json }`, with the literal
 *   string as `json`. Every other function gets the parsed value, as Convex
 *   delivers a structured answer.
 * - `structured`: the older shape, `{ etag, body }` / the bare value, which
 *   the client still accepts.
 *
 * The clock sample is answered here and never recorded. An unrouted function
 * fails the test. What was answered is kept in `stubAnswers`.
 */
let stubAnswers: unknown[] = [];

function stubTransport(
  routes: Record<string, string>,
  options: { etag?: string; form?: AnswerForm } = {},
): ApiCall[] {
  const calls: ApiCall[] = [];
  const form = options.form ?? 'text';
  const answers: unknown[] = [];
  stubAnswers = answers;
  const answerFor = (call: ApiCall): unknown => {
    const text = routes[call.fn];
    if (text === undefined) throw new Error(`unexpected call to ${call.fn} (${call.path})`);
    const etag = options.etag ?? null;
    if (form === 'text' && call.conditional) return { etag, json: text };
    if (form === 'text' && JSON_TEXT_FNS.has(call.fn)) return { json: text };
    const body: unknown = JSON.parse(text);
    return call.conditional ? { etag, body } : body;
  };
  setApiTransportForTests(async (call) => {
    if (isClockCall(call)) return Date.now();
    calls.push(call);
    const answer = answerFor(call);
    answers.push(answer);
    return answer;
  });
  return calls;
}

describe('meetcal API contract (serde output through the real client)', () => {
  beforeEach(() => {
    resetServerClockForTests();
    clearHttpValidatorCache();
  });

  afterEach(() => {
    setApiTransportForTests(null);
    resetServerClockForTests();
    jest.restoreAllMocks();
  });

  it('fetchApiMeets: /meets row with null map links and a known zone', async () => {
    const calls = stubTransport({ 'meets:list': MEETS_JSON });

    const [meet] = await fetchApiMeets();

    expect(calls.map((call) => [call.path, call.fn, call.kind])).toEqual([
      ['/meets', 'meets:list', 'query'],
    ]);

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
    stubTransport({ 'meets:list': MEETS_JSON });
    const [meet] = await fetchApiMeets();
    const calls = stubTransport({ 'meets:schedule': SCHEDULE_JSON });

    const schedule = await fetchApiSchedule(MEET, meet);

    // The meet was supplied, so only the schedule round trip happens.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ path: '/meets/schedule', fn: 'meets:schedule', conditional: true });
    // The meet name, commas and all, is one argument.
    expect(calls[0].args).toEqual({ meet: MEET });
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
    stubTransport({ 'meets:athletesSessions': ATHLETES_SESSIONS_JSON });
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
    const calls = stubTransport({ 'meets:athletesSessions': ATHLETES_SESSIONS_JSON });

    const athletes = await fetchApiAthletesWithSession(MEET, 45, 'red');

    expect(calls[0].args.sessionNumber).toBe(45);
    expect(calls[0].args.platform).toBeUndefined();
    expect(athletes.map((a) => a.name)).toEqual(['Package Test Lifter']);
  });

  it('fetchApiMeetPackageConditional: include=year_bests package with the other sections absent', async () => {
    const calls = stubTransport({ 'meets:packageForMeet': PACKAGE_JSON }, { etag: '"pkg-v1"' });

    const result = await fetchApiMeetPackageConditional(MEET, '2024-01-01', null);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ path: '/meets/package', conditional: true });
    expect(calls[0].args).toEqual({
      meet: MEET,
      historyCutoffDate: '2024-01-01',
      include: ['year_bests'],
    });
    expect(calls[0].args.ifNoneMatch).toBeUndefined();
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

    // The wire list arrives as the map the app has always read, and the list
    // itself is not handed on.
    expect('year_bests' in pkg).toBe(false);
    expect(pkg.year_bests_by_name).toEqual({
      'Package Test Lifter': { best_snatch: 95, best_cj: 110, best_total: 205 },
    });
    expect(mapApiYearBests(pkg.year_bests_by_name!['Package Test Lifter'])).toEqual({
      bestSnatch: 95,
      bestCJ: 110,
      bestTotal: 205,
    });
  });

  it('fetchApiMeetPackageConditional: non-ASCII athlete names key the year-bests map', async () => {
    stubTransport({ 'meets:packageForMeet': packageJson(NON_ASCII_BESTS_JSON) });

    const result = await fetchApiMeetPackageConditional(MEET, '2024-01-01', null);

    if (result.status !== 'fresh') throw new Error('unreachable');
    expect(result.package.year_bests_by_name).toEqual({
      'Andrés Álvarez': { best_snatch: 88, best_cj: 112, best_total: 200 },
      'Zoë Ørsted': { best_snatch: 70, best_cj: 90, best_total: 160 },
      '李娜': { best_snatch: 0, best_cj: 0, best_total: 0 },
    });
  });

  it('fetchApiMeetPackageConditional: a package sent without year_bests passes through unchanged', async () => {
    const withoutBests = PACKAGE_JSON_HEAD.replace(/,$/, '}');
    stubTransport({ 'meets:packageForMeet': withoutBests });

    const result = await fetchApiMeetPackageConditional(MEET, '2024-01-01', null);

    if (result.status !== 'fresh') throw new Error('unreachable');
    expect(result.package).toEqual(JSON.parse(withoutBests));
    expect('year_bests_by_name' in result.package).toBe(false);
  });

  it('fetchApiMeetPackageConditional: a malformed year_bests row fails the package, naming its index', async () => {
    stubTransport({
      'meets:packageForMeet': packageJson(
        '[{"name":"Package Test Lifter","best_snatch":95.0,"best_cj":110.0,"best_total":205.0},' +
          '{"name":"Another Lifter","best_snatch":0.0,"best_cj":0.0}]',
      ),
    });
    await expect(fetchApiMeetPackageConditional(MEET, '2024-01-01', null)).rejects.toThrow(
      '/meets/package.year_bests[1] missing fields: best_total',
    );

    stubTransport({
      'meets:packageForMeet': packageJson('[{"name":null,"best_snatch":1.0,"best_cj":1.0,"best_total":2.0}]'),
    });
    await expect(fetchApiMeetPackageConditional(MEET, '2024-01-01', null)).rejects.toThrow(
      '/meets/package.year_bests[0] has invalid name',
    );
  });

  it('fetchApiYearBestsByNames: the byte-ordered named list maps to every entry', async () => {
    const calls = stubTransport({ 'results:bests': YEAR_BESTS_JSON });

    const bests = await fetchApiYearBestsByNames(['Package Test Lifter', 'Another Lifter'], '2025-01-01');

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ path: '/lifting-results/bests', kind: 'query' });
    expect(calls[0].args).toEqual({
      names: ['Package Test Lifter', 'Another Lifter'],
      cutoffDate: '2025-01-01',
    });
    expect(bests).toEqual({
      'Another Lifter': { bestSnatch: 0, bestCJ: 0, bestTotal: 0 },
      'Package Test Lifter': { bestSnatch: 95, bestCJ: 110, bestTotal: 205 },
    });
  });

  it('fetchApiYearBestsByNames: non-ASCII names come back as map keys', async () => {
    const names = ['Andrés Álvarez', 'Zoë Ørsted', '李娜'];
    const calls = stubTransport({ 'results:bests': NON_ASCII_BESTS_JSON });

    const bests = await fetchApiYearBestsByNames(names, '2025-01-01');

    expect(calls[0].args.names).toEqual(names);
    expect(bests).toEqual({
      'Andrés Álvarez': { bestSnatch: 88, bestCJ: 112, bestTotal: 200 },
      'Zoë Ørsted': { bestSnatch: 70, bestCJ: 90, bestTotal: 160 },
      '李娜': { bestSnatch: 0, bestCJ: 0, bestTotal: 0 },
    });
  });

  it('fetchApiYearBestsByNames: a malformed row fails the batch, naming its index', async () => {
    stubTransport({
      'results:bests':
        '[{"name":"Another Lifter","best_snatch":0.0,"best_cj":0.0,"best_total":0.0},' +
        '{"best_snatch":95.0,"best_cj":110.0,"best_total":205.0}]',
    });
    await expect(fetchApiYearBestsByNames(['Another Lifter', 'Package Test Lifter'])).rejects.toThrow(
      '/lifting-results/bests[1] missing fields: name',
    );

    stubTransport({
      'results:bests': '[{"name":7,"best_snatch":0.0,"best_cj":0.0,"best_total":0.0}]',
    });
    await expect(fetchApiYearBestsByNames(['Another Lifter'])).rejects.toThrow(
      '/lifting-results/bests[0] has invalid name',
    );
  });

  it('fetchApiResultsByNames: i64 id, string age and 0.0 misses map without turning zeros into nulls', async () => {
    stubTransport({
      'results:byNames':
        `[${liftingResultJson(41001, 'b1', 'Bounded Meet A', '2024-01-10')},` +
        `${liftingResultJson(41002, 'b2', 'Bounded Meet B', '2024-03-10')}]`,
    });

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
    const calls = stubTransport({
      'results:search': '{"matched_name":null,"suggestions":["Alexander Nordstrom"],"results":[]}',
    });

    await expect(searchApi('Alexan', '2025-01-01', '2025-12-31')).resolves.toEqual({
      matchedName: null,
      suggestions: ['Alexander Nordstrom'],
      results: [],
    });
    expect(calls[0].args).toEqual({ query: 'Alexan', startDate: '2025-01-01', endDate: '2025-12-31' });
  });

  it('searchApi: an exact match carries matched_name and LiftingResults rows', async () => {
    stubTransport({
      'results:search':
        '{"matched_name":"Alexander Nordstrom","suggestions":[],"results":[' +
        `${liftingResultJson(7, 'e7', 'Search Meet', '2025-05-10')}]}`,
    });

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
    const calls = stubTransport({ 'users:savedSessions': SAVED_SESSIONS_JSON });

    const sessions = await fetchSavedSessions('clerk-token');

    expect(calls[0]).toEqual({
      path: '/users/me/saved-sessions',
      fn: 'users:savedSessions',
      kind: 'query',
      args: {},
      token: 'clerk-token',
    });
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

  it.each<[string, Record<string, string>, () => Promise<unknown>]>([
    ['the meet package', { 'meets:packageForMeet': PACKAGE_JSON }, () => fetchApiMeetPackageConditional(MEET, '2024-01-01', null)],
    ['the meets list', { 'meets:list': MEETS_JSON }, () => fetchApiMeets()],
    ['a schedule', { 'meets:schedule': SCHEDULE_JSON, 'meets:details': MEETS_JSON.slice(1, -1) }, () => fetchApiSchedule(MEET)],
    ['athletes with sessions', { 'meets:athletesSessions': ATHLETES_SESSIONS_JSON }, () => fetchApiAthletesWithSession(MEET)],
    [
      'results by names',
      {
        'results:byNames':
          `[${liftingResultJson(41001, 'b1', 'Bounded Meet A', '2024-01-10')},` +
          `${liftingResultJson(41002, 'b2', 'Bounded Meet B', '2024-03-10')}]`,
      },
      () => fetchApiResultsByNames(['Bounded History Lifter']),
    ],
  ])('back-compat: %s decodes the same from the structured form as from JSON text', async (_name, routes, invoke) => {
    const carriesText = (answer: unknown) =>
      typeof answer === 'object' && answer !== null && typeof (answer as { json?: unknown }).json === 'string';

    stubTransport(routes, { etag: '"v1"' });
    const fromText = await invoke();
    expect(stubAnswers.length).toBeGreaterThan(0);
    expect(stubAnswers.every(carriesText)).toBe(true);
    clearHttpValidatorCache();

    stubTransport(routes, { etag: '"v1"', form: 'structured' });
    const fromStructured = await invoke();
    expect(stubAnswers.some(carriesText)).toBe(false);

    expect(fromStructured).toEqual(fromText);
  });
});
