import { readWireFixture, wireAnswer, type WireAnswer } from '../../../convex-tests/wireFixture';
import { clubMeetStatsFromApi } from '@/lib/database/fetch-club-stats';
import { fetchApiClubMeetStats, fetchApiClubMeets, fetchApiClubNames } from './clubs-api';
import { fetchAccessPass, refreshServerEntitlement } from './entitlement-api';
import { generateMeetSubmissionUploadUrl, submitMeet } from './meet-submissions-api';
import { fetchApiAthletes, fetchApiAthletesWithSession, fetchApiMeetByName, fetchApiMeets, fetchApiSchedule } from './meets-api';
import { fetchApiAdaptiveRecords, fetchApiIntlRankings, fetchApiNationalRankings, fetchApiQualifyingTotals, fetchApiRecords, fetchApiStandards, fetchApiWsoAgeGroups, fetchApiWsoList, fetchApiWsoRecords } from './reference-api';
import { fetchApiRecentResultsByNames, fetchApiResultsByNames, fetchApiYearBestsByNames, fetchAthlete, searchApi } from './results-api';
import { clearHttpValidatorCache } from './revalidated-reads';
import { resetServerClockForTests } from './server-clock';
import { revokeApiToken } from './siri-tokens-api';
import { fetchWrapped } from './wrapped-api';
import { isClockCall } from './json-transport-stub';
import { setApiTransportForTests, type ApiCall } from './transport';

const NOW = Date.UTC(2026, 9, 1, 12);
const TOKEN = 'clerk-session-token';

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function row(value: unknown): Row {
  if (!isRow(value)) throw new Error(`expected an object, got ${JSON.stringify(value)}`);
  return value;
}

function rows(value: unknown): Row[] {
  if (!Array.isArray(value)) throw new Error(`expected an array, got ${JSON.stringify(value)}`);
  return value.map(row);
}

function text(args: Row, key: string): string {
  const value = args[key];
  if (typeof value !== 'string') throw new Error(`argument ${key} is not text`);
  return value;
}

function optionalText(args: Row, key: string): string | undefined {
  return args[key] === undefined ? undefined : text(args, key);
}

function optionalNumber(args: Row, key: string): number | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number') throw new Error(`argument ${key} is not a number`);
  return value;
}

function names(args: Row): string[] {
  const value = args.names;
  if (!Array.isArray(value) || !value.every((name) => typeof name === 'string')) throw new Error('argument names is not a list of names');
  return value;
}

function pick(source: Row, keys: readonly string[]): Row {
  return Object.fromEntries(keys.map((key) => [key, source[key]]));
}

function omit(source: Row, keys: readonly string[]): Row {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !keys.includes(key)));
}

const RESULT_FIELDS_THE_APP_DROPS = ['id', 'federation', 'adaptive'];

function expectSameRowsOnTheirKeys(mapped: readonly object[], body: unknown) {
  const sent = rows(body);
  expect(mapped).toHaveLength(sent.length);
  mapped.forEach((kept, index) => expect(kept).toEqual(pick(sent[index] ?? {}, Object.keys(kept))));
}

function sentArgs(call: ApiCall): Row {
  return Object.fromEntries(Object.entries(call.args).filter(([key, value]) => value !== undefined && key !== 'pass' && key !== 'ifNoneMatch'));
}

function serve(fn: string, answer: WireAnswer, encode: (body: unknown) => unknown): ApiCall[] {
  const calls: ApiCall[] = [];
  setApiTransportForTests(async (call) => {
    if (isClockCall(call)) return Date.now();
    if (call.fn !== fn) throw new Error(`unexpected call to ${call.fn}`);
    calls.push(call);
    return encode(answer.body);
  });
  return calls;
}

type Check = (args: Row, body: unknown) => Promise<void>;

const CHECKS: Record<string, Check> = {
  'meets:list': async (_args, body) => {
    const meets = await fetchApiMeets();
    expect(meets).toHaveLength(rows(body).length);
    rows(body).forEach((sent, index) =>
      expect(meets[index]).toMatchObject({
        id: sent.id,
        name: sent.name,
        status: sent.status,
        venueMapPdfUrl: sent.venue_map_pdf_url,
        venueMapAppleUrl: sent.venue_map_apple_url,
        dates: { start: sent.start_date, end: sent.end_date },
        time: { timeZone: sent.time_zone },
      }),
    );
  },
  'meets:details': async (args, body) => {
    const sent = row(body);
    expect(await fetchApiMeetByName(text(args, 'meet'))).toMatchObject({
      id: sent.id,
      name: sent.name,
      venue: { name: sent.venue_name, address: { street: sent.venue_street, city: sent.venue_city, state: sent.venue_state, zip: sent.venue_zip } },
      venueMapPdfUrl: sent.venue_map_pdf_url,
      venueMapAppleUrl: sent.venue_map_apple_url,
      dates: { start: sent.start_date, end: sent.end_date },
    });
  },
  'meets:schedule': async (args, body) => {
    const schedule = await fetchApiSchedule(text(args, 'meet'));
    const platforms = schedule.flatMap((day) =>
      day.sessions.flatMap((session) => session.platforms.map((platform) => [day.fullDate, session.number, platform.platform, platform.weightClass])),
    );
    expect(platforms).toEqual(rows(body).map((sent) => [sent.date, sent.session_id, sent.platform, sent.weight_class]));
  },
  'meets:athletes': async (args, body) => {
    const athletes = await fetchApiAthletes(text(args, 'meet'));
    expect(athletes.map((athlete) => [athlete.memberId, athlete.name, athlete.club, athlete.wso ?? null, athlete.entryTotal, athlete.session?.number ?? null])).toEqual(
      rows(body).map((sent) => [sent.member_id, sent.name, sent.club, sent.wso, sent.entry_total, sent.session_number]),
    );
  },
  'meets:athletesSessions': async (args, body) => {
    const athletes = await fetchApiAthletesWithSession(text(args, 'meet'), optionalNumber(args, 'sessionNumber'), optionalText(args, 'platform'));
    expect(athletes.map((athlete) => [athlete.name, athlete.wso ?? null, athlete.session?.number ?? null, athlete.session?.date ?? null])).toEqual(
      rows(body).map((sent) => [sent.name, sent.wso, sent.session_number, sent.date]),
    );
  },
  'results:byNames': async (args, body) => {
    const results = await fetchApiResultsByNames(names(args), { latestOnly: args.latestOnly === true });
    expect(results).toEqual(rows(body).map((sent) => omit(sent, RESULT_FIELDS_THE_APP_DROPS)));
  },
  'results:athlete': async (args, body) => {
    const sent = row(body);
    const lookup = await fetchAthlete({
      name: text(args, 'name'),
      lifter: optionalText(args, 'lifter'),
      membership: optionalText(args, 'membership'),
      other: args.other === true,
    });
    if (sent.kind === 'choose') {
      expect(lookup).toEqual({
        kind: 'choose',
        name: sent.name,
        lifters: rows(sent.lifters).map((lifter) => ({ id: lifter.id, name: lifter.name, label: lifter.label, results: lifter.results, latestDate: lifter.latest_date })),
        otherResults: sent.other_results,
      });
      return;
    }
    const current = row(row(sent.prs).current);
    const index = (value: unknown) => (typeof value === 'number' ? value : -1);
    expect(lookup).toEqual({
      kind: 'results',
      lifter: sent.lifter,
      rows: rows(JSON.parse(text(sent, 'json'))).map((result) => omit(result, RESULT_FIELDS_THE_APP_DROPS)),
      prs: { snatch: index(current.snatch), cj: index(current.cj), total: index(current.total) },
    });
  },
  'results:recent': async (args, body) => {
    const results = await fetchApiRecentResultsByNames(names(args), text(args, 'cutoffDate'));
    expect(results).toEqual(rows(body).map((sent) => omit(sent, RESULT_FIELDS_THE_APP_DROPS)));
  },
  'results:bests': async (args, body) => {
    const bests = await fetchApiYearBestsByNames(names(args), text(args, 'cutoffDate'));
    expect(bests).toEqual(
      Object.fromEntries(rows(body).map((sent) => [sent.name, { bestSnatch: sent.best_snatch, bestCJ: sent.best_cj, bestTotal: sent.best_total }])),
    );
  },
  'results:search': async (args, body) => {
    const sent = row(body);
    expect(await searchApi(text(args, 'query'), optionalText(args, 'startDate'), optionalText(args, 'endDate'))).toEqual({
      matchedName: sent.matched_name,
      suggestions: sent.suggestions,
      results: rows(sent.results).map((result) => omit(result, RESULT_FIELDS_THE_APP_DROPS)),
      truncated: sent.truncated,
    });
  },
  'results:wrapped': async (args, body) => {
    const year = optionalNumber(args, 'year');
    if (year === undefined) throw new Error('argument year is missing');
    expect(await fetchWrapped(text(args, 'query'), year, args.picked === true)).toEqual(body);
  },
  'reference:records': async (_args, body) => expectSameRowsOnTheirKeys(await fetchApiRecords(), body),
  'reference:standards': async (_args, body) => expectSameRowsOnTheirKeys(await fetchApiStandards(), body),
  'reference:qualifyingTotals': async (_args, body) => expectSameRowsOnTheirKeys(await fetchApiQualifyingTotals(), body),
  'reference:intlRankings': async (_args, body) => expectSameRowsOnTheirKeys(await fetchApiIntlRankings(), body),
  'reference:nationalRankings': async (args, body) =>
    expectSameRowsOnTheirKeys(await fetchApiNationalRankings(text(args, 'federation'), text(args, 'ageCategory')), body),
  'reference:wsoRecords': async (args, body) =>
    expectSameRowsOnTheirKeys(await fetchApiWsoRecords(text(args, 'wso'), optionalText(args, 'ageCategory'), optionalText(args, 'gender')), body),
  'reference:adaptiveRecords': async (args, body) =>
    expectSameRowsOnTheirKeys(await fetchApiAdaptiveRecords(text(args, 'gender'), text(args, 'excludeFederation')), body),
  'reference:wsoList': async (_args, body) => expect(await fetchApiWsoList()).toEqual(body),
  'reference:wsoAgeGroups': async (args, body) => expect(await fetchApiWsoAgeGroups(text(args, 'wso'))).toEqual(body),
  'reference:clubs': async (_args, body) => expect(await fetchApiClubNames()).toEqual(body),
  'reference:clubMeets': async (args, body) =>
    expect(await fetchApiClubMeets(text(args, 'club'))).toEqual(rows(row(body).meets).map((sent) => pick(sent, ['meet', 'date']))),
  'reference:clubMeetStats': async (args, body) => {
    const sent = row(body);
    expect(clubMeetStatsFromApi(await fetchApiClubMeetStats(text(args, 'club'), text(args, 'meet')))).toEqual({
      totalAthletes: sent.total_athletes,
      goldMedals: sent.gold_medals,
      silverMedals: sent.silver_medals,
      bronzeMedals: sent.bronze_medals,
      totalPRs: sent.total_prs,
      perfect6for6: sent.perfect_6_for_6,
      totalWeightLifted: sent.total_weight_lifted,
      snatchMakeRate: sent.snatch_make_rate,
      cjMakeRate: sent.cj_make_rate,
      combinedMakeRate: sent.combined_make_rate,
    });
  },
  'accessPass:pass': async (_args, body) => expect(await fetchAccessPass(TOKEN)).toEqual(body),
  'entitlements:refresh': async (_args, body) => expect(await refreshServerEntitlement(TOKEN)).toEqual(body),
  'apiTokens:revoke': async (args, body) => {
    expect(body).toBeNull();
    await expect(revokeApiToken(TOKEN, optionalText(args, 'tokenId'))).resolves.toBeUndefined();
  },
  'meetSubmissions:generateUploadUrl': async (_args, body) => expect(await generateMeetSubmissionUploadUrl(TOKEN)).toBe(row(body).uploadUrl),
  'meetSubmissions:submit': async (args) => {
    const files = rows(args.files).map((file) => ({ storageId: text(file, 'storageId'), name: text(file, 'name') }));
    await expect(
      submitMeet(TOKEN, {
        meetName: text(args, 'meetName'),
        startDate: text(args, 'startDate'),
        endDate: optionalText(args, 'endDate') ?? null,
        contactEmail: optionalText(args, 'contactEmail') ?? null,
        files,
      }),
    ).resolves.toBeUndefined();
  },
};

const CASES = Object.entries(CHECKS).flatMap(([fn, check]) => {
  const fixture = readWireFixture(fn);
  return fixture.answers.map((answer, index) => ({ fn, index, answer, check, encode: (body: unknown) => wireAnswer(fixture, body) }));
});

describe("the app reads the server's answers (fixtures/wire)", () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    resetServerClockForTests();
    clearHttpValidatorCache();
  });

  afterEach(() => {
    setApiTransportForTests(null);
    resetServerClockForTests();
    jest.restoreAllMocks();
  });

  it.each(CASES)('$fn answer $index', async ({ fn, answer, check, encode }) => {
    const calls = serve(fn, answer, encode);
    await check(answer.args, answer.body);
    expect(calls.map(sentArgs)).toEqual([answer.args]);
  });
});
