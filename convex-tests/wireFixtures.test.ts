import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getFunctionName } from 'convex/server';
import * as accessPass from '../convex/accessPass';
import * as apiTokens from '../convex/apiTokens';
import * as entitlements from '../convex/entitlements';
import { PREMIUM_ACTIONS, PREMIUM_FUNCTIONS } from '../convex/lib/access';
import { directoryText } from '../convex/lib/directory';
import { RESULT_NAMES_VIEW } from '../convex/lib/viewKeys';
import { textChunks, writeView } from '../convex/lib/views';
import * as meetSubmissions from '../convex/meetSubmissions';
import * as meets from '../convex/meets';
import * as reference from '../convex/reference';
import * as results from '../convex/results';
import { fakeMutationCtx, handlerOf } from './fakeDb';
import { readWireFixture, WIRE_FIXTURE_DIR, wireFixtureFile, type WireEncoding } from './wireFixture';

const NOW = Date.UTC(2026, 9, 1, 12);
const PASS = 'fixture-pass';
const USER = 'user_fixture';
const CLERK_IDENTITY = { subject: USER, issuer: 'https://clerk.example.com' };

const MODULES: Record<string, Record<string, unknown>> = { accessPass, apiTokens, entitlements, meetSubmissions, meets, reference, results };

type Kind = 'query' | 'mutation' | 'action';

const SHARED_FUNCTIONS: Record<string, Kind> = {
  'accessPass:pass': 'query',
  'apiTokens:revoke': 'mutation',
  'entitlements:refresh': 'action',
  'meetSubmissions:generateUploadUrl': 'mutation',
  'meetSubmissions:submit': 'mutation',
  'meets:athletes': 'query',
  'meets:athletesSessions': 'query',
  'meets:completed': 'query',
  'meets:details': 'query',
  'meets:list': 'query',
  'meets:schedule': 'query',
  'reference:adaptiveRecords': 'query',
  'reference:clubMeetStats': 'query',
  'reference:clubMeets': 'query',
  'reference:clubs': 'query',
  'reference:intlRankings': 'query',
  'reference:nationalRankings': 'query',
  'reference:nationalRankingsByYear': 'query',
  'reference:qualifyingTotals': 'query',
  'reference:records': 'query',
  'reference:registrationWsos': 'query',
  'reference:standards': 'query',
  'reference:wsoAgeGroups': 'query',
  'reference:wsoList': 'query',
  'reference:wsoRecords': 'query',
  'results:bests': 'query',
  'results:byMeet': 'query',
  'results:athlete': 'query',
  'results:byNames': 'query',
  'results:recent': 'query',
  'results:search': 'query',
  'results:wrapped': 'query',
  'results:wsoElite': 'action',
};

const UPCOMING = '2026 Wire Fixture Open';
const ONGOING = '2026 Wire Fixture Games';
const COMPLETED = '2026 Wire Fixture Classic';
const CLUB = 'Wire Fixture Barbell';
const WSO = 'Carolina';

function meet(name: string, status: 'upcoming' | 'ongoing' | 'completed', startDate: string, endDate: string, extra: Record<string, unknown> = {}) {
  return {
    name,
    venueName: 'Fixture Hall',
    venueStreet: '1 Fixture Way',
    venueCity: 'Raleigh',
    venueState: 'NC',
    venueZip: '27601',
    timeZone: 'America/New_York',
    startDate,
    endDate,
    status,
    updatedAt: 0,
    ...extra,
  };
}

function registration(memberId: string, name: string, meetName: string, extra: Record<string, unknown> = {}) {
  return {
    memberId,
    name,
    age: 27,
    club: CLUB,
    gender: 'Female',
    weightClass: '63',
    entryTotal: 180,
    meet: meetName,
    adaptive: false,
    ...extra,
  };
}

function result(name: string, date: string, meetName: string, extra: Record<string, unknown> = {}) {
  return {
    eventId: `${meetName}|${date}`,
    meet: meetName,
    date,
    name,
    nameKey: name.toLowerCase(),
    age: "Open Women's 63kg",
    bodyWeight: 63.4,
    snatch1: 78,
    snatch2: -82,
    snatch3: 82,
    snatchBest: 82,
    cj1: 98,
    cj2: 102,
    cj3: -105,
    cjBest: 102,
    total: 184,
    adaptive: false,
    federation: 'USAW',
    ...extra,
  };
}

const LIFTER = 'Avery Fixture';
const SECOND_LIFTER = 'Blake Fixture';
const UNSEATED = 'Casey Fixture';
const BOMBED = 'Drew Fixture';
const PROLIFIC = 'Tess Toomany';
const TWIN = 'Jordan Twin';
const LIFTER_ID = '30001';
const PROLIFIC_ROWS = 601;
const NARROW_NAMES = Array.from({ length: 100 }, (_, i) => `Narrow Name ${String(i).padStart(3, '0')}`);

function seed() {
  return {
    access_passes: [{ current: PASS, previous: null, rotatedAt: NOW - 60_000 }],
    entitlements: [{ userId: USER, active: true, expiresAt: null, productId: 'meetcal_annual' }],
    entitlement_syncs: [{ userId: USER, syncedAt: NOW - 60_000, refreshRequestedAt: NOW - 1_000 }],
    api_tokens: [{ tokenId: 'tok_fixture', userId: USER, client: 'siri', createdAt: NOW - 60_000, expiresAt: NOW + 86_400_000 }],
    meets: [
      meet(UPCOMING, 'upcoming', '2026-11-14', '2026-11-15', {
        federation: 'USAW',
        venueMapPdfUrl: 'https://example.com/fixture-map.pdf',
        venueMapAppleUrl: 'https://maps.apple.com/?q=Fixture+Hall',
      }),
      meet(ONGOING, 'ongoing', '2026-09-30', '2026-10-02'),
      meet(COMPLETED, 'completed', '2026-03-07', '2026-03-08', { federation: 'USAW' }),
    ],
    session_schedule: [
      { meet: UPCOMING, date: '2026-11-14', sessionId: 1, startTime: '09:00:00', weighInTime: '07:00:00', platform: 'Red', weightClass: '63' },
      { meet: UPCOMING, date: '2026-11-14', sessionId: 2, startTime: '13:00:00', weighInTime: '11:00:00', platform: 'Blue', weightClass: '69' },
    ],
    athletes: [
      registration('100001', LIFTER, UPCOMING, { wso: WSO, sessionNumber: 1, sessionPlatform: 'Red' }),
      registration('100002', SECOND_LIFTER, UPCOMING, { weightClass: '69', entryTotal: 200, sessionNumber: 2, sessionPlatform: 'Blue', adaptive: true }),
      registration('100003', UNSEATED, UPCOMING, { gender: 'Male', weightClass: '88', entryTotal: 260, age: 31 }),
      registration('100001', LIFTER, COMPLETED, { wso: WSO }),
      registration('100002', SECOND_LIFTER, COMPLETED, { wso: WSO, weightClass: '69', entryTotal: 200 }),
      registration('100004', BOMBED, COMPLETED, { entryTotal: 170 }),
    ],
    lifters: [
      { athleteId: LIFTER_ID, name: LIFTER, nameKey: LIFTER.toLowerCase(), gender: 'Women', birthYear: 1999, club: CLUB, wso: WSO, seenAt: '2026-03-07' },
      { athleteId: '30002', name: TWIN, nameKey: TWIN.toLowerCase(), gender: 'Men', birthYear: 1960, wso: WSO, seenAt: '2025-06-01' },
      { athleteId: '30003', name: TWIN, nameKey: TWIN.toLowerCase(), gender: 'Men', birthYear: 2010, club: CLUB, seenAt: '2026-02-01' },
    ],
    lifter_memberships: [{ membership: '100001', athleteId: LIFTER_ID }],
    lifter_names: [
      { nameKey: LIFTER.toLowerCase(), athleteId: LIFTER_ID },
      { nameKey: TWIN.toLowerCase(), athleteId: '30002' },
      { nameKey: TWIN.toLowerCase(), athleteId: '30003' },
    ],
    lifting_results: [
      result(TWIN, '2025-06-01', 'Masters Twin Open', { age: "Men's Masters (65-69) 88kg", lifterId: '30002', lifterMatch: 'history' }),
      result(TWIN, '2026-02-01', 'Youth Twin Open', { age: "Men's 16-17 Age Group 79kg", total: 150, snatch1: 60, snatch2: -64, snatch3: 66, snatchBest: 66, cj1: 80, cj2: 84, cj3: -88, cjBest: 84, lifterId: '30003', lifterMatch: 'history' }),
      result(TWIN, '2024-01-01', 'Unclaimed Twin Open'),
      result(LIFTER, '2026-03-07', COMPLETED, { legacyId: 9001, lifterId: LIFTER_ID, lifterMatch: 'history' }),
      result(SECOND_LIFTER, '2026-03-08', COMPLETED, {
        age: "Open Women's 69kg",
        bodyWeight: undefined,
        snatch3: undefined,
        cj3: undefined,
        snatch1: 85,
        snatch2: 88,
        snatchBest: 88,
        cj1: 108,
        cj2: 112,
        cjBest: 112,
        total: 200,
        adaptive: true,
      }),
      result(BOMBED, '2026-03-07', COMPLETED, {
        bodyWeight: 62.1,
        snatch1: 70,
        snatch2: -75,
        snatch3: -75,
        snatchBest: 70,
        cj1: -90,
        cj2: -90,
        cj3: -90,
        cjBest: 0,
        total: 0,
      }),
      result(LIFTER, '2025-11-01', '2025 Wire Fixture Fall Open', { legacyId: 8001, snatchBest: 80, total: 182, snatch3: -84, lifterId: LIFTER_ID, lifterMatch: 'history' }),
      ...Array.from({ length: PROLIFIC_ROWS }, (_, i) =>
        result(PROLIFIC, `2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`, `Toomany Meet ${i}`),
      ),
    ],
    records: [
      {
        recordType: 'USAW',
        ageCategory: 'Senior',
        gender: 'Women',
        weightClass: '64kg',
        snatchRecord: 112,
        cjRecord: 140,
        totalRecord: 250,
        snatchBy: { name: 'Record Holder One', date: '2024-06-01', location: 'Fixture City' },
        cjBy: { name: 'Record Holder Two' },
      },
      { recordType: 'USAW', ageCategory: 'Senior', gender: 'Women', weightClass: '71kg', totalRecord: 260 },
    ],
    standards: [
      { ageCategory: 'Senior', gender: 'Women', weightClass: '64kg', standardA: 210, standardB: 190 },
      { ageCategory: 'Junior', gender: 'Men', weightClass: '88kg', standardA: 300, standardB: 280 },
    ],
    qualifying_totals: [
      { eventName: 'National Championships', gender: 'Women', ageCategory: 'Senior', weightClass: '64kg', qualifyingTotal: 170 },
      { eventName: 'National Championships', gender: 'Men', ageCategory: 'Senior', weightClass: '88kg', qualifyingTotal: 260 },
    ],
    intl_rankings: [
      { legacyId: 1, meet: 'Fixture Worlds', ranking: 1, name: 'Intl Fixture', weightClass: '64kg', total: 240, percentA: 104.5, gender: 'Women', ageCategory: 'Senior' },
      { meet: 'Fixture Pan Ams', name: 'Intl Second', gender: 'Women', ageCategory: 'Senior' },
    ],
    wso_records: [
      {
        wso: WSO,
        ageCategory: 'Senior',
        gender: 'Women',
        weightClass: '64kg',
        snatchRecord: 95,
        cjRecord: 118,
        totalRecord: 210,
        totalBy: { name: 'Wso Holder', date: '2025-05-05', location: 'Raleigh' },
      },
      { wso: WSO, ageCategory: 'Youth 16-17', gender: 'Men', weightClass: '73kg', snatchRecord: 100 },
    ],
  };
}

async function seededContext() {
  const store = fakeMutationCtx(seed(), [{ _id: '_storage:fixture', _creationTime: NOW - 1_000, size: 52_000, contentType: 'application/pdf' }]);
  await writeView(
    { db: store.db } as never,
    RESULT_NAMES_VIEW,
    textChunks(directoryText([LIFTER, SECOND_LIFTER, PROLIFIC, ...NARROW_NAMES].sort())),
    [],
    { text: true },
  );
  return store;
}

const PREMIUM: ReadonlySet<string> = new Set<string>([...PREMIUM_FUNCTIONS, ...PREMIUM_ACTIONS]);

function registered(fn: string): unknown {
  const [module, name] = fn.split(':');
  const found = module === undefined || name === undefined ? undefined : MODULES[module]?.[name];
  if (found === undefined) throw new Error(`no Convex function ${fn}`);
  return found;
}

async function answer(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const store = await seededContext();
  const auth = { getUserIdentity: async () => CLERK_IDENTITY };
  const ctx = { ...store.ctx, auth };
  const run = (ref: unknown, runArgs: unknown) => handlerOf(registered(getFunctionName(ref as never)))(ctx, runArgs);
  const kind = SHARED_FUNCTIONS[fn];
  const called = PREMIUM.has(fn) ? { ...args, pass: PASS } : args;
  if (kind === 'action') return await handlerOf(registered(fn))({ auth, runQuery: run, runMutation: run }, called);
  return await handlerOf(registered(fn))(ctx, called);
}

function isTextAnswer(value: unknown): value is { json: string; etag?: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return 'json' in value && typeof value.json === 'string' && keys.every((key) => key === 'json' || key === 'etag');
}

function decoded(value: unknown): { encoding: WireEncoding; body: unknown } {
  if (isTextAnswer(value)) {
    const body: unknown = JSON.parse(value.json);
    return { encoding: 'jsonText', body };
  }
  return { encoding: 'value', body: value === undefined ? null : value };
}

const updating = process.env.MEETCAL_UPDATE_FIXTURES === '1';
const files = readdirSync(WIRE_FIXTURE_DIR).filter((file) => file.endsWith('.json')).sort();

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('wire fixtures', () => {
  it('cover every function two or more clients read, one file each', () => {
    expect(files).toEqual(Object.keys(SHARED_FUNCTIONS).map(wireFixtureFile).sort());
  });

  it.each(Object.keys(SHARED_FUNCTIONS))('%s answers what its fixture holds', async (fn) => {
    const fixture = readWireFixture(fn);
    const answers = [];
    const encodings = new Set<WireEncoding>();
    for (const { args, body } of fixture.answers) {
      const live = decoded(await answer(fn, args));
      encodings.add(live.encoding);
      if (!updating) {
        expect(live.encoding).toBe(fixture.encoding);
        expect(live.body).toEqual(body);
      }
      answers.push({ args, body: live.body });
    }
    expect(encodings.size).toBe(1);
    if (updating) {
      const updated = { function: fn, encoding: [...encodings][0], answers };
      writeFileSync(join(WIRE_FIXTURE_DIR, wireFixtureFile(fn)), `${JSON.stringify(updated, null, 2)}\n`);
    }
  });
});
