/**
 * @jest-environment-options {"deviceTimeZone": "Pacific/Chatham"}
 */
import * as fc from 'fast-check';

import {
  clearHttpValidatorCache,
  fetchApiAthletes,
  fetchApiAthletesWithSession,
  fetchApiMeetPackageConditional,
  fetchApiMeets,
  fetchApiRecentResultsByNames,
  fetchApiResultsByNames,
  fetchApiSchedule,
  fetchApiYearBests,
  fetchApiYearBestsByNames,
  fetchSavedSessions,
  fetchApiClubMeetStats,
  fetchApiClubNames,
  fetchApiMeetByName,
  fetchApiRecords,
  fetchApiWsoAgeGroups,
  fetchUserPreferences,
  formatApiTime,
  mapApiAthlete,
  mapApiAthletes,
  mapApiLiftingResult,
  mapApiMeet,
  mapApiSchedule,
  mapApiYearBests,
  mapPackageSchedule,
  MeetCalApiTimeoutError,
  normalizePlatform,
  resetServerClockForTests,
  searchApi,
  type ApiAthleteWithSession,
  type ApiLiftingResult,
  type ApiMeet,
  type ApiScheduleRow,
  type ApiYearBests,
} from './meetcal-api';
import { callQuery, isClockCall, jsonTransportStub, type JsonResponder } from './json-transport-stub';
import { setApiTransportForTests } from './transport';
import { timezoneOffsets, type USTimeZoneIdentifier } from '@/data/types/meet';
import { isLiftResult } from '@/lib/athletes';
import {
  clockTimeArb,
  corruptedArb,
  hostileStringArb,
  isoCalendarDateArb,
  timeZoneArb,
} from '@/test-support/arbitraries';

/**
 * The API boundary under generated payloads. A valid payload must map without
 * losing its key fields; a payload with one node broken (`corruptedArb`) must
 * either be rejected with an `Error` the caller can handle, or map to a value
 * that satisfies the app type. What must never happen is a half-mapped value:
 * `NaN`, a missing required field or a wrong type reaching a screen or
 * AsyncStorage.
 */

const US_ZONES = Object.keys(timezoneOffsets) as USTimeZoneIdentifier[];

// --- valid wire payloads -----------------------------------------------------

const nonBlankArb = fc.string({ minLength: 1, maxLength: 24 }).filter((value) => value.trim().length > 0);

/** `HH:MM`, `H:MM AM` and the API's `HH:MM:SS`. */
const apiClockArb = fc.oneof(
  clockTimeArb,
  fc
    .record({ hour: fc.integer({ min: 0, max: 23 }), minute: fc.integer({ min: 0, max: 59 }) })
    .map(({ hour, minute }) => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`),
);

const apiMeetArb: fc.Arbitrary<ApiMeet> = fc.record(
  {
    id: nonBlankArb,
    federation: fc.constantFrom('USAW', 'IWF'),
    name: nonBlankArb,
    start_date: isoCalendarDateArb,
    end_date: isoCalendarDateArb,
    time_zone: fc.oneof({ weight: 3, arbitrary: fc.constantFrom(...US_ZONES) }, { weight: 1, arbitrary: timeZoneArb }),
    status: fc.constantFrom('upcoming', 'ongoing', 'completed'),
    venue_name: fc.string(),
    venue_street: fc.string(),
    venue_city: fc.string(),
    venue_state: fc.string(),
    venue_zip: fc.string(),
    venue_map_pdf_url: fc.option(fc.webUrl()),
    venue_map_apple_url: fc.option(fc.webUrl()),
  },
  { requiredKeys: ['name', 'start_date', 'end_date', 'time_zone', 'status', 'venue_name', 'venue_street', 'venue_city', 'venue_state', 'venue_zip'] },
);

const apiScheduleRowArb: fc.Arbitrary<ApiScheduleRow> = fc.record({
  date: isoCalendarDateArb,
  platform: fc.oneof(fc.constantFrom('Red', 'blue', ' Gold ', 'WHITE'), nonBlankArb),
  session_id: fc.integer({ min: 1, max: 120 }),
  start_time: apiClockArb,
  weigh_in_time: apiClockArb,
  weight_class: fc.constantFrom('60kg', '+110', '89', '71kg'),
});

const apiAthleteArb: fc.Arbitrary<ApiAthleteWithSession> = fc.record({
  member_id: fc.string(),
  name: nonBlankArb,
  age: fc.integer({ min: 8, max: 90 }),
  club: fc.string(),
  wso: fc.option(fc.string()),
  gender: fc.constantFrom('Male', 'Female'),
  weight_class: fc.constantFrom('60', '+110', '89'),
  entry_total: fc.integer({ min: 0, max: 450 }),
  adaptive: fc.boolean(),
  session_number: fc.option(fc.integer({ min: 1, max: 120 })),
  session_platform: fc.option(fc.constantFrom('Red', 'Blue', 'Gold')),
  date: fc.option(isoCalendarDateArb),
  start_time: fc.option(apiClockArb),
  weigh_in_time: fc.option(apiClockArb),
});

const kilosArb = fc.integer({ min: -300, max: 300 });

const apiLiftingResultArb: fc.Arbitrary<ApiLiftingResult> = fc.record({
  id: fc.nat(),
  event_id: nonBlankArb,
  federation: fc.constant('USAW'),
  meet: nonBlankArb,
  date: isoCalendarDateArb,
  name: nonBlankArb,
  age: fc.constantFrom("Open Men's 89kg", 'Junior', '35-39'),
  body_weight: fc.double({ min: 20, max: 250, noNaN: true }),
  snatch1: kilosArb,
  snatch2: kilosArb,
  snatch3: kilosArb,
  snatch_best: kilosArb,
  cj1: kilosArb,
  cj2: kilosArb,
  cj3: kilosArb,
  cj_best: kilosArb,
  total: fc.nat({ max: 500 }),
  adaptive: fc.boolean(),
});

const yearBestsArb = fc.record({
  best_snatch: fc.nat({ max: 250 }),
  best_cj: fc.nat({ max: 300 }),
  best_total: fc.nat({ max: 500 }),
});

const namedBestsArb = fc.uniqueArray(
  fc.record({ name: nonBlankArb, best_snatch: fc.nat(250), best_cj: fc.nat(300), best_total: fc.nat(500) }),
  { maxLength: 4, selector: (row) => row.name },
);

const savedSessionArb = fc.record({
  session_id: nonBlankArb,
  meet: nonBlankArb,
  session_number: fc.integer({ min: 1, max: 120 }),
  platform: fc.constantFrom('Red', 'Blue'),
  weight_class: fc.option(fc.string()),
  start_time: fc.option(apiClockArb),
  date: fc.option(isoCalendarDateArb),
  notes: fc.option(fc.string()),
  athlete_names: fc.array(fc.string(), { maxLength: 3 }),
  updated_at: fc.nat(),
});

/** A package as `meets:packageForMeet` sends it: the schedule nested by day and session. */
const apiPackageArb = fc.record({
  meet: apiMeetArb,
  schedule: fc.array(
    fc.record({
      date: isoCalendarDateArb,
      sessions: fc.array(
        fc.record({
          session_id: fc.integer({ min: 1, max: 120 }),
          start_time: apiClockArb,
          weigh_in_time: apiClockArb,
          platforms: fc.array(fc.record({ platform: fc.constantFrom('Red', 'Blue'), weight_class: fc.constantFrom('60', '89') }), {
            minLength: 1,
            maxLength: 2,
          }),
        }),
        { maxLength: 2 },
      ),
    }),
    { maxLength: 2 },
  ),
  athletes: fc.array(apiAthleteArb, { maxLength: 2 }),
  meet_results: fc.array(apiLiftingResultArb, { maxLength: 2 }),
  year_bests: namedBestsArb,
});

// --- app-type shape checks ---------------------------------------------------

const isString = (value: unknown): value is string => typeof value === 'string';
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isNullableFinite = (value: unknown) => value === null || isFiniteNumber(value);
const DISPLAY_TIME = /^(?:[1-9]|1[0-2]):[0-5]\d (?:AM|PM)$/;
const isDisplayTime = (value: unknown) => value === '' || (isString(value) && DISPLAY_TIME.test(value));

function expectMappedMeet(meet: unknown): void {
  const m = meet as ReturnType<typeof mapApiMeet>;
  expect(isString(m.name)).toBe(true);
  // A package's meet may arrive without a name (its fetch only checks it is an
  // object); the id falls back to the name, so it is blank only then.
  expect(isString(m.id) && (m.id.length > 0 || m.name === '')).toBe(true);
  for (const field of [m.venue.name, m.venue.address.street, m.venue.address.city, m.venue.address.state, m.venue.address.zip]) {
    expect(isString(field)).toBe(true);
  }
  expect(m.venueMapPdfUrl === null || isString(m.venueMapPdfUrl)).toBe(true);
  expect(m.venueMapAppleUrl === null || isString(m.venueMapAppleUrl)).toBe(true);
  expect(isString(m.time.timeZone)).toBe(true);
  expect(US_ZONES).toContain(m.time.timeZoneIdentifier);
  expect(isString(m.time.abbreviation)).toBe(true);
  expect(isFiniteNumber(m.time.utcOffset)).toBe(true);
  expect(isString(m.dates.start) && isString(m.dates.end)).toBe(true);
  expect(['upcoming', 'ongoing', 'completed']).toContain(m.status);
  expect(typeof m.timeZoneUnknown).toBe('boolean');
}

function expectSchedule(schedule: unknown): void {
  expect(Array.isArray(schedule)).toBe(true);
  for (const day of schedule as ReturnType<typeof mapApiSchedule>) {
    expect(isString(day.date) && day.date !== 'Invalid Date').toBe(true);
    expect(isString(day.fullDate)).toBe(true);
    for (const session of day.sessions) {
      expect(isString(session.id)).toBe(true);
      expect(isFiniteNumber(session.number)).toBe(true);
      expect(isDisplayTime(session.startTime) && isDisplayTime(session.weighInTime)).toBe(true);
      for (const platform of session.platforms) {
        expect(isString(platform.platform) && platform.platform.trim().length > 0).toBe(true);
        expect(isString(platform.weightClass)).toBe(true);
        expect(isDisplayTime(platform.platformStartTime)).toBe(true);
      }
    }
  }
}

function expectLiftingResult(row: unknown): void {
  const r = row as ReturnType<typeof mapApiLiftingResult>;
  expect(isFiniteNumber(r.id)).toBe(true);
  expect(isString(r.event_id) && r.event_id.length > 0).toBe(true);
  expect(isString(r.meet) && isString(r.date) && isString(r.name)).toBe(true);
  expect(isString(r.age) || isFiniteNumber(r.age)).toBe(true);
  expect(isFiniteNumber(r.body_weight)).toBe(true);
  for (const lift of [r.snatch1, r.snatch2, r.snatch3, r.snatch_best, r.cj1, r.cj2, r.cj3, r.cj_best, r.total]) {
    expect(isNullableFinite(lift)).toBe(true);
  }
}

function expectBests(bests: unknown): void {
  const b = bests as { bestSnatch: unknown; bestCJ: unknown; bestTotal: unknown };
  expect(isFiniteNumber(b.bestSnatch) && isFiniteNumber(b.bestCJ) && isFiniteNumber(b.bestTotal)).toBe(true);
}

/**
 * Runs `invoke`; a rejection must be an `Error`, a resolution must pass
 * `check`. The stub answers at once, so a timeout would mean the fetch hung.
 */
async function rejectsOrSatisfies<T>(invoke: () => Promise<T>, check: (value: T) => void): Promise<void> {
  let value: T;
  try {
    value = await invoke();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(MeetCalApiTimeoutError);
    return;
  }
  check(value);
}

type AnswerForm = 'text' | 'structured';

/**
 * `text` is what `convex/` sends (`{ etag, json }`, row lists as `{ json }`);
 * `structured` is the older `{ etag, body }` / bare value, which the client
 * still accepts and which can carry what JSON text cannot (`undefined`,
 * `NaN`, `Infinity`; Convex values include the last two).
 */
function serve(respond: JsonResponder, form: AnswerForm = 'text'): void {
  if (form === 'text') {
    setApiTransportForTests(jsonTransportStub(respond));
    return;
  }
  setApiTransportForTests(async (call) => {
    if (isClockCall(call)) return Date.now();
    const body = await respond(call.path, callQuery(call));
    return call.conditional ? { etag: '"v1"', body } : body;
  });
}

const answerFormArb = fc.constantFrom<AnswerForm>('text', 'structured');

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

beforeEach(() => {
  resetServerClockForTests();
  clearHttpValidatorCache();
  // Unknown zones and dropped roster rows are reported by design.
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  setApiTransportForTests(null);
  resetServerClockForTests();
  clearHttpValidatorCache();
  jest.restoreAllMocks();
});

describe('meetcal API mappers (properties)', () => {
  it('maps a valid meet without losing its fields, on its own zone or the documented fallback', () => {
    fc.assert(
      fc.property(apiMeetArb, (row) => {
        const meet = mapApiMeet(row);
        expectMappedMeet(meet);
        expect(meet.name).toBe(row.name);
        expect(meet.id).toBe(row.id || row.name);
        expect(meet.dates).toEqual({ start: row.start_date, end: row.end_date });
        expect(meet.venue.name).toBe(row.venue_name);
        expect(meet.status).toBe(row.status);
        const known = (US_ZONES as string[]).includes(row.time_zone);
        expect(meet.timeZoneUnknown).toBe(!known);
        expect(meet.time.timeZoneIdentifier).toBe(known ? row.time_zone : 'America/New_York');
        // The offset is one of the zone's two published offsets, never the
        // device's and never a third value.
        const { standard, dst } = timezoneOffsets[meet.time.timeZoneIdentifier];
        expect([standard, dst]).toContain(meet.time.utcOffset);
      }),
    );
  });

  it('keeps every valid schedule row: one session per day and number, one platform per row', () => {
    fc.assert(
      fc.property(fc.array(apiScheduleRowArb, { maxLength: 12 }), apiMeetArb, (rows, meetRow) => {
        const schedule = mapApiSchedule(rows, mapApiMeet(meetRow));
        expectSchedule(schedule);
        expect(schedule.map((day) => day.fullDate).sort()).toEqual([...new Set(rows.map((row) => row.date))].sort());
        const platformCount = schedule.flatMap((day) => day.sessions.flatMap((session) => session.platforms)).length;
        expect(platformCount).toBe(rows.length);
        for (const day of schedule) {
          const numbers = day.sessions.map((session) => session.number);
          expect(numbers).toEqual([...new Set(numbers)].sort((a, b) => a - b));
        }
      }),
    );
  });

  it('keeps every valid athlete row as a LiftResult with its name and session', () => {
    fc.assert(
      fc.property(fc.array(apiAthleteArb, { maxLength: 6 }), (rows) => {
        const athletes = mapApiAthletes(rows, 'property');
        expect(athletes).toHaveLength(rows.length);
        athletes.forEach((athlete, index) => {
          expect(isLiftResult(athlete)).toBe(true);
          expect(athlete.name).toBe(rows[index].name);
          const hasSession = rows[index].session_number != null && !!rows[index].session_platform;
          expect(athlete.session?.number).toBe(hasSession ? rows[index].session_number : undefined);
        });
      }),
    );
  });

  it('maps a valid lifting result field for field', () => {
    fc.assert(
      fc.property(apiLiftingResultArb, fc.nat(), (row, index) => {
        const result = mapApiLiftingResult(row, index);
        expectLiftingResult(result);
        const { federation: _federation, adaptive: _adaptive, ...kept } = row;
        expect(result).toEqual(kept);
      }),
    );
  });

  it('formats any clock text as a 12-hour time or blank, and is idempotent', () => {
    fc.assert(
      fc.property(fc.oneof(apiClockArb, hostileStringArb), (time) => {
        const formatted = formatApiTime(time);
        expect(isDisplayTime(formatted)).toBe(true);
        expect(formatApiTime(formatted)).toBe(formatted);
      }),
    );
  });

  it('formats every valid clock time, never blank', () => {
    fc.assert(fc.property(apiClockArb, (time) => expect(formatApiTime(time)).not.toBe('')));
  });

  it('canonicalizes platforms idempotently, case-insensitively, and never to blank', () => {
    fc.assert(
      fc.property(fc.oneof(hostileStringArb, fc.constantFrom('red', 'RED', ' Red ', 'gold  team')), (platform) => {
        const canonical = normalizePlatform(platform);
        expect(canonical.trim()).toBe(canonical);
        expect(canonical.length).toBeGreaterThan(0);
        expect(normalizePlatform(canonical)).toBe(canonical);
        expect(normalizePlatform(platform.toUpperCase())).toBe(normalizePlatform(platform.toLowerCase()));
      }),
    );
  });
});

describe('meetcal API mappers are pure (properties)', () => {
  it('maps the same row to the same value twice and never writes to it', () => {
    // Rows are frozen: a mapper that wrote to its input would throw here.
    fc.assert(
      fc.property(
        fc.oneof(apiMeetArb, corruptedArb({ name: 'Meet', start_date: '2026-06-20', end_date: '2026-06-21', time_zone: 'America/Chicago', status: 'upcoming' })),
        fc.array(apiScheduleRowArb, { maxLength: 6 }),
        apiAthleteArb.chain((row) => fc.oneof(fc.constant<unknown>(row), corruptedArb(row))),
        apiLiftingResultArb.chain((row) => fc.oneof(fc.constant<unknown>(row), corruptedArb(row))),
        yearBestsArb.chain((row) => fc.oneof(fc.constant<unknown>(row), corruptedArb(row))),
        (meetRow, scheduleRows, athleteRow, resultRow, bestsRow) => {
          const inputs = deepFreeze(structuredClone({ meetRow, scheduleRows, athleteRow, resultRow, bestsRow }));
          const snapshot = structuredClone(inputs);
          const run = () => ({
            meet: settle(() => mapApiMeet(inputs.meetRow as ApiMeet)),
            schedule: settle(() => mapApiSchedule(inputs.scheduleRows)),
            athlete: settle(() => mapApiAthlete(inputs.athleteRow as ApiAthleteWithSession)),
            result: settle(() => mapApiLiftingResult(inputs.resultRow as ApiLiftingResult, 3)),
            bests: settle(() => mapApiYearBests(inputs.bestsRow as ApiYearBests)),
          });
          expect(run()).toEqual(run());
          expect(inputs).toEqual(snapshot);
        },
      ),
    );
  });
});

/** A mapper's answer or the class of what it threw, for comparing two runs. */
function settle(map: () => unknown): unknown {
  try {
    return { value: map() };
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return { threw: (error as Error).message };
  }
}

describe('meetcal API boundary under corrupted payloads (properties)', () => {
  // Each property builds one valid payload, then breaks one node of it.
  const corrupt = <T>(arb: fc.Arbitrary<T>) => arb.chain((valid) => corruptedArb(valid));

  it('rejects a corrupted meets list or maps every meet completely', async () => {
    await fc.assert(
      fc.asyncProperty(corrupt(fc.array(apiMeetArb, { minLength: 1, maxLength: 3 })), answerFormArb, async (payload, form) => {
        clearHttpValidatorCache();
        serve(() => payload, form);
        await rejectsOrSatisfies(fetchApiMeets, (meets) => meets.forEach(expectMappedMeet));
      }),
    );
  });

  it('rejects corrupted meet details or maps the meet completely', async () => {
    await fc.assert(
      fc.asyncProperty(corrupt(apiMeetArb), answerFormArb, async (payload, form) => {
        clearHttpValidatorCache();
        serve(() => payload, form);
        await rejectsOrSatisfies(
          () => fetchApiMeetByName('Meet'),
          (meet) => {
            if (meet !== null) expectMappedMeet(meet);
          },
        );
      }),
    );
  });

  it('rejects a corrupted schedule or maps it completely', async () => {
    await fc.assert(
      fc.asyncProperty(
        corrupt(fc.array(apiScheduleRowArb, { minLength: 1, maxLength: 4 })),
        apiMeetArb,
        answerFormArb,
        async (payload, meetRow, form) => {
          clearHttpValidatorCache();
          serve(() => payload, form);
          await rejectsOrSatisfies(() => fetchApiSchedule(meetRow.name, mapApiMeet(meetRow)), expectSchedule);
        },
      ),
    );
  });

  it('rejects a corrupted roster or returns only valid athletes', async () => {
    await fc.assert(
      fc.asyncProperty(
        corrupt(fc.array(apiAthleteArb, { minLength: 1, maxLength: 3 })),
        fc.boolean(),
        answerFormArb,
        async (payload, withSession, form) => {
          serve(() => payload, form);
          const invoke = withSession ? () => fetchApiAthletesWithSession('Meet') : () => fetchApiAthletes('Meet');
          await rejectsOrSatisfies(invoke, (athletes) => athletes.forEach((athlete) => expect(isLiftResult(athlete)).toBe(true)));
        },
      ),
    );
  });

  it('rejects corrupted lifting results or maps every row to finite numbers and strings', async () => {
    await fc.assert(
      fc.asyncProperty(
        corrupt(fc.array(apiLiftingResultArb, { minLength: 1, maxLength: 3 })),
        fc.constantFrom(fetchApiResultsByNames, fetchApiRecentResultsByNames),
        answerFormArb,
        async (payload, fetchResults, form) => {
          serve(() => payload, form);
          await rejectsOrSatisfies(() => fetchResults(['Athlete A']), (rows) => rows.forEach(expectLiftingResult));
        },
      ),
    );
  });

  it('rejects corrupted search answers or returns strings and mapped rows', async () => {
    const searchArb = fc.record({
      matched_name: fc.option(nonBlankArb),
      suggestions: fc.array(nonBlankArb, { maxLength: 3 }),
      results: fc.array(apiLiftingResultArb, { maxLength: 2 }),
    });
    await fc.assert(
      fc.asyncProperty(corrupt(searchArb), answerFormArb, async (payload, form) => {
        serve(() => payload, form);
        await rejectsOrSatisfies(
          () => searchApi('Athlete'),
          (answer) => {
            expect(answer.matchedName === null || isString(answer.matchedName)).toBe(true);
            expect(answer.suggestions.every(isString)).toBe(true);
            answer.results.forEach(expectLiftingResult);
          },
        );
      }),
    );
  });

  it('rejects corrupted year bests or answers finite numbers', async () => {
    await fc.assert(
      fc.asyncProperty(corrupt(yearBestsArb), answerFormArb, async (payload, form) => {
        serve(() => payload, form);
        await rejectsOrSatisfies(() => fetchApiYearBests('Athlete A'), (rows) => rows.forEach(expectBests));
      }),
    );
    await fc.assert(
      fc.asyncProperty(corrupt(namedBestsArb.filter((rows) => rows.length > 0)), answerFormArb, async (payload, form) => {
        serve(() => payload, form);
        await rejectsOrSatisfies(
          () => fetchApiYearBestsByNames(['Athlete A']),
          (byName) => Object.values(byName).forEach(expectBests),
        );
      }),
    );
  });

  it('rejects a corrupted meet package, or everything the offline download maps from it is valid', async () => {
    await fc.assert(
      fc.asyncProperty(corrupt(apiPackageArb), answerFormArb, async (payload, form) => {
        serve(() => payload, form);
        // What `meet-manager`'s `ingestMeetPackage` builds before writing to
        // storage; a throw from any step fails the download, which is handled.
        await rejectsOrSatisfies(
          async () => {
            const fetched = await fetchApiMeetPackageConditional('Meet');
            if (fetched.status !== 'fresh') throw new Error('expected a fresh package');
            const pkg = fetched.package;
            return {
              meet: mapApiMeet(pkg.meet),
              schedule: mapPackageSchedule(pkg),
              athletes: mapApiAthletes(pkg.athletes, 'property'),
              results: pkg.meet_results.map(mapApiLiftingResult),
              bests: Object.values(pkg.year_bests_by_name ?? {}),
            };
          },
          ({ meet, schedule, athletes, results, bests }) => {
            expectMappedMeet(meet);
            expectSchedule(schedule);
            athletes.forEach((athlete) => expect(isLiftResult(athlete)).toBe(true));
            results.forEach(expectLiftingResult);
            for (const row of bests) {
              expect([row.best_snatch, row.best_cj, row.best_total].every(isFiniteNumber)).toBe(true);
            }
          },
        );
      }),
    );
  });

  it('rejects corrupted reference rows, or reads every cell as its type or null', async () => {
    const recordRowArb = fc.record({
      age_category: fc.string(),
      gender: fc.constantFrom('Men', 'Women'),
      weight_class: fc.string(),
      record_type: fc.string(),
      snatch_record: fc.nat(250),
      cj_record: fc.nat(300),
      total_record: fc.nat(500),
    });
    await fc.assert(
      fc.asyncProperty(corrupt(fc.array(recordRowArb, { minLength: 1, maxLength: 3 })), answerFormArb, async (payload, form) => {
        clearHttpValidatorCache();
        serve(() => payload, form);
        await rejectsOrSatisfies(fetchApiRecords, (rows) =>
          rows.forEach((row) => {
            for (const text of [row.age_category, row.gender, row.weight_class, row.record_type]) {
              expect(text === null || isString(text)).toBe(true);
            }
            for (const lift of [row.snatch_record, row.cj_record, row.total_record]) expect(isNullableFinite(lift)).toBe(true);
          }),
        );
      }),
    );
  });

  it('rejects a corrupted string list or returns only strings', async () => {
    await fc.assert(
      fc.asyncProperty(
        corrupt(fc.array(nonBlankArb, { minLength: 1, maxLength: 4 })),
        fc.constantFrom(() => fetchApiClubNames(), () => fetchApiWsoAgeGroups('Carolina')),
        answerFormArb,
        async (payload, fetchList, form) => {
          clearHttpValidatorCache();
          serve(() => payload, form);
          await rejectsOrSatisfies(fetchList, (list) => expect(list.every(isString)).toBe(true));
        },
      ),
    );
  });

  it('rejects corrupted club stats unless they are an object', async () => {
    await fc.assert(
      fc.asyncProperty(
        corrupt(fc.record({ club: nonBlankArb, athletes: fc.array(apiAthleteArb, { maxLength: 2 }) })),
        answerFormArb,
        async (payload, form) => {
          serve(() => payload, form);
          await rejectsOrSatisfies(
            () => fetchApiClubMeetStats('Club', 'Meet'),
            (stats) => expect(stats !== null && typeof stats === 'object' && !Array.isArray(stats)).toBe(true),
          );
        },
      ),
    );
  });

  it('rejects corrupted saved sessions or returns rows the outbox can trust', async () => {
    await fc.assert(
      fc.asyncProperty(
        corrupt(fc.record({ sessions: fc.array(savedSessionArb, { minLength: 1, maxLength: 3 }) })),
        answerFormArb,
        async (payload, form) => {
          serve(() => payload, form);
          await rejectsOrSatisfies(
            () => fetchSavedSessions('token'),
            (rows) =>
              rows.forEach((row) => {
                expect(isString(row.session_id) && row.session_id.length > 0).toBe(true);
                expect(isString(row.meet) && row.meet.length > 0).toBe(true);
                expect(isFiniteNumber(row.session_number) && isFiniteNumber(row.updated_at)).toBe(true);
                expect(isString(row.platform)).toBe(true);
                expect(row.athlete_names.every(isString)).toBe(true);
                for (const field of [row.weight_class, row.start_time, row.date, row.notes]) {
                  expect(field === null || isString(field)).toBe(true);
                }
              }),
          );
        },
      ),
    );
  });

  it('rejects corrupted preferences or answers a boolean', async () => {
    await fc.assert(
      fc.asyncProperty(corruptedArb({ auto_unsave_started_sessions: true }), answerFormArb, async (payload, form) => {
        serve(() => payload, form);
        await rejectsOrSatisfies(
          () => fetchUserPreferences('token'),
          (prefs) => expect(typeof prefs.auto_unsave_started_sessions).toBe('boolean'),
        );
      }),
    );
  });
});

describe('meetcal API boundary counterexamples', () => {
  // Shrunk counterexamples the properties above found; each one used to reach
  // the app half-mapped.
  const MEET = {
    name: 'Meet',
    start_date: '2026-06-20',
    end_date: '2026-06-21',
    time_zone: 'America/New_York',
    status: 'upcoming',
    venue_name: 'Hall',
    venue_street: '1 Main',
    venue_city: 'City',
    venue_state: 'ST',
    venue_zip: '00000',
  };

  it('rejects a meets list whose meet name is null instead of listing a nameless meet', async () => {
    serve(() => [{ ...MEET, name: null }]);
    await expect(fetchApiMeets()).rejects.toThrow('/meets[0] has invalid fields: name');
  });

  it('reads a package meet whose name is not text as blank, and its missing venue as blank', () => {
    const { venue_name: _venueName, ...withoutVenue } = MEET;
    const meet = mapApiMeet({ ...withoutVenue, name: {} } as unknown as ApiMeet);
    expect(meet.name).toBe('');
    expect(meet.id).toBe('');
    expect(meet.venue.name).toBe('');
  });

  it('rejects a schedule row that is not an object instead of making a day titled undefined', () => {
    const row = { date: '1990-01-01', platform: 'Red', session_id: 1, start_time: '00:00', weigh_in_time: '00:00:00', weight_class: '60kg' };
    expect(() => mapApiSchedule([[row]] as unknown as ApiScheduleRow[])).toThrow('schedule[0] expected an object response');
    expect(() => mapApiSchedule([{ ...row, session_id: '1' }] as unknown as ApiScheduleRow[])).toThrow(
      'schedule[0] has an invalid date or session_id',
    );
  });

  it('gives a lifting result whose id is not a number its index, and reads a text lift as null', () => {
    const result = mapApiLiftingResult({ id: {}, meet: 'M', date: '1990-01-01', name: 'A', snatch1: '100' } as unknown as ApiLiftingResult, 7);
    expect(result.id).toBe(7);
    expect(result.snatch1).toBeNull();
  });

  it('reads year bests that are not numbers as 0', () => {
    expect(mapApiYearBests({ best_snatch: [2], best_cj: 28, best_total: '499' } as unknown as ApiYearBests)).toEqual({
      bestSnatch: 0,
      bestCJ: 28,
      bestTotal: 499,
    });
  });
});

describe('JSON text answers (properties)', () => {
  /** Text the server never sends whole: empty, cut short, or not JSON at all. */
  const brokenTextArb = (validText: string) =>
    fc.oneof(
      fc.constant(''),
      fc.nat({ max: Math.max(0, validText.length - 1) }).map((end) => validText.slice(0, end)),
      fc.string().filter((text) => {
        try {
          JSON.parse(text);
          return false;
        } catch {
          return true;
        }
      }),
    );

  const withText = <T>(arb: fc.Arbitrary<T>) =>
    arb.chain((rows) => brokenTextArb(JSON.stringify(rows)));

  it.each([
    ['fetchApiAthletes', () => fetchApiAthletes('Meet'), withText(fc.array(apiAthleteArb, { minLength: 1, maxLength: 2 }))],
    ['fetchApiResultsByNames', () => fetchApiResultsByNames(['A']), withText(fc.array(apiLiftingResultArb, { minLength: 1, maxLength: 2 }))],
    ['fetchApiMeets', () => fetchApiMeets(), withText(fc.array(apiMeetArb, { minLength: 1, maxLength: 2 }))],
    [
      'fetchApiMeetPackageConditional',
      () => fetchApiMeetPackageConditional('Meet'),
      withText(apiPackageArb),
    ],
  ] as const)('%s rejects JSON text that is empty, truncated or not JSON', async (_name, invoke, textArb) => {
    await fc.assert(
      fc.asyncProperty(textArb as fc.Arbitrary<string>, async (text) => {
        clearHttpValidatorCache();
        setApiTransportForTests(async (call) => (call.fn === 'system:serverTime' ? Date.now() : { etag: null, json: text }));
        await expect((invoke as () => Promise<unknown>)()).rejects.toThrow(/empty body|invalid JSON|expected an? (array|object)/);
      }),
    );
  });
});
