import { setPremiumModeForTests } from '../convex/lib/access';
import { etagOf } from '../convex/lib/etag';
import { computeMeetResults } from '../convex/lib/meetData';
import { athletes, athletesSessions, liveAthletesJson, liveSessionsJson } from '../convex/meets';
import { bests, byMeet } from '../convex/results';
import { buildMeet } from '../convex/views';
import { ANONYMOUS_AUTH, fakeDb, handlerOf } from './fakeDb';

beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
afterEach(() => setPremiumModeForTests(null));

const MEET = 'Spring Open';

const athlete = (name: string, sessionNumber: number | undefined, sessionPlatform: string | undefined) => ({
  memberId: name.length.toString(),
  name,
  age: 30,
  club: 'Club',
  gender: 'Women',
  weightClass: '64',
  entryTotal: 150,
  sessionNumber,
  sessionPlatform,
  meet: MEET,
  adaptive: false,
});

const session = (sessionId: number, platform: string) => ({
  date: '2026-04-01',
  sessionId,
  startTime: '09:00',
  weighInTime: '07:00',
  platform,
  weightClass: '64',
  meet: MEET,
});

const result = (name: string, date: string, total: number) => ({
  eventId: '1',
  federation: 'USAW',
  meet: MEET,
  date,
  name,
  nameKey: name.toLowerCase(),
  age: "Open Women's 64kg",
  bodyWeight: 63,
  snatch1: total / 2 - 10,
  snatchBest: total / 2 - 10,
  cj1: total / 2 + 10,
  cjBest: total / 2 + 10,
  total,
  adaptive: false,
});

const SEED = {
  athletes: [athlete('Ada', 1, 'Red'), athlete('Bea', 1, 'Blue'), athlete('Cy', 2, 'Red'), athlete('Dee', undefined, undefined)],
  session_schedule: [session(1, 'Red'), session(1, 'Blue'), session(2, 'Red')],
  lifting_results: [result('Ada', '2026-04-01', 200), result('Bea', '2026-04-01', 190)],
};

type Answer = { etag: string; json?: string };

function tracked(seed: Record<string, Record<string, unknown>[]>) {
  const fake = fakeDb(seed);
  const tables: string[] = [];
  const db = { ...fake.db, query: (table: string) => (tables.push(table), fake.db.query(table)) };
  return { fake, db, tables };
}

const ask = async (fn: unknown, db: unknown, args: Record<string, unknown>) => await handlerOf<Record<string, unknown>, Answer>(fn)({ db, auth: ANONYMOUS_AUTH }, args);

async function withViews(seed: Record<string, Record<string, unknown>[]> = SEED) {
  const built = tracked(seed);
  await handlerOf(buildMeet)({ db: built.fake.db }, { meet: MEET });
  return built;
}

const pendingMeetHint = { kind: 'meet', key: MEET, seq: 0, updatedAt: 1 };

describe('meets:athletes answers a tag', () => {
  it('answers the same JSON as before, now with its tag, from the view and live alike', async () => {
    const live = fakeDb(SEED);
    const json = await liveAthletesJson({ db: live.db } as never, MEET);
    const { db } = await withViews();
    expect(await ask(athletes, db, { meet: MEET })).toEqual({ etag: etagOf(json), json });
    expect(await ask(athletes, live.db, { meet: MEET })).toEqual({ etag: etagOf(json), json });
  });

  it('answers the tag alone to a client that holds it, reading no rows of the view', async () => {
    const { db, tables } = await withViews();
    const { etag } = await ask(athletes, db, { meet: MEET });
    tables.length = 0;
    expect(await ask(athletes, db, { meet: MEET, ifNoneMatch: etag })).toEqual({ etag });
    expect(tables).not.toContain('view_chunks');
  });

  it('keeps the tag while the view is stale, and answers a stale tag in full', async () => {
    const { fake, db } = await withViews();
    const fresh = await ask(athletes, db, { meet: MEET });
    await fake.db.insert('view_hints', pendingMeetHint);
    expect(await ask(athletes, db, { meet: MEET, ifNoneMatch: fresh.etag })).toEqual({ etag: fresh.etag });
    expect(await ask(athletes, db, { meet: MEET, ifNoneMatch: '"old"' })).toEqual(fresh);
  });
});

describe('meets:athletesSessions answers a tag', () => {
  const cases: [string, number | undefined, string | undefined][] = [
    ['unfiltered', undefined, undefined],
    ['one session', 1, undefined],
    ['one session and platform', 1, 'red'],
    ['one platform', undefined, 'Blue'],
    ['a session with no athletes', 9, undefined],
  ];

  it.each(cases)('answers the same JSON as before, with its tag (%s)', async (_label, sessionNumber, platform) => {
    const live = fakeDb(SEED);
    const json = await liveSessionsJson({ db: live.db } as never, MEET, sessionNumber, platform);
    const { db } = await withViews();
    const args = { meet: MEET, sessionNumber, platform };
    expect(await ask(athletesSessions, db, args)).toEqual({ etag: etagOf(json), json });
    expect(await ask(athletesSessions, live.db, args)).toEqual({ etag: etagOf(json), json });
    expect(await ask(athletesSessions, db, { ...args, ifNoneMatch: etagOf(json) })).toEqual({ etag: etagOf(json) });
  });

  it('answers an unfiltered or one-session client that holds the tag from the view header alone', async () => {
    const { db, tables } = await withViews();
    for (const args of [{ meet: MEET }, { meet: MEET, sessionNumber: 2 }]) {
      const { etag } = await ask(athletesSessions, db, args);
      tables.length = 0;
      expect(await ask(athletesSessions, db, { ...args, ifNoneMatch: etag })).toEqual({ etag });
      expect(tables).not.toContain('view_chunks');
    }
  });
});

describe('results:byMeet answers a tag', () => {
  it('answers the same JSON as before, now with its tag, from the results view and live alike', async () => {
    const live = fakeDb(SEED);
    const json = JSON.stringify(await computeMeetResults({ db: live.db } as never, MEET));
    const { db } = await withViews();
    expect(await ask(byMeet, db, { meet: MEET })).toEqual({ etag: etagOf(json), json });
    expect(await ask(byMeet, live.db, { meet: MEET })).toEqual({ etag: etagOf(json), json });
  });

  it('answers the tag alone from the view header, and in full after a results write', async () => {
    const { fake, db, tables } = await withViews();
    const first = await ask(byMeet, db, { meet: MEET });
    tables.length = 0;
    expect(await ask(byMeet, db, { meet: MEET, ifNoneMatch: first.etag })).toEqual({ etag: first.etag });
    expect(tables).not.toContain('view_chunks');
    expect(tables).not.toContain('lifting_results');
    await fake.db.insert('lifting_results', result('Cy', '2026-04-01', 180));
    await fake.db.insert('view_hints', pendingMeetHint);
    const changed = await ask(byMeet, db, { meet: MEET, ifNoneMatch: first.etag });
    expect(changed.etag).not.toBe(first.etag);
    expect(JSON.parse(changed.json!)).toHaveLength(3);
  });

  it('checks the pass before the tag, so a client without a pass learns nothing from it', async () => {
    setPremiumModeForTests('enforce');
    const { fake, db } = await withViews({ ...SEED, access_passes: [{ current: 'today', previous: null, rotatedAt: Date.now() }] });
    const { etag } = await ask(byMeet, db, { meet: MEET, pass: 'today' });
    await expect(ask(byMeet, db, { meet: MEET, ifNoneMatch: etag })).rejects.toMatchObject({ data: { status: 401 } });
    await expect(ask(byMeet, db, { meet: MEET, ifNoneMatch: etag, pass: 'yesterday' })).rejects.toMatchObject({ data: { status: 403 } });
    expect(await ask(byMeet, db, { meet: MEET, ifNoneMatch: etag, pass: 'today' })).toEqual({ etag });
    expect(fake.rows('access_passes')).toHaveLength(1);
  });
});

describe('results:bests with latestWhenEmpty', () => {
  const HISTORY = {
    lifting_results: [
      result('Ada', '2026-05-01', 200),
      result('Bea', '2023-03-01', 170),
      result('Bea', '2023-03-01', 175),
      result('Bea', '2021-06-01', 190),
      { ...result('Cy', '2026-02-01', 0), snatch1: -80, snatchBest: 0, cj1: -100, cjBest: 0 },
    ],
  };
  const askBests = async (args: Record<string, unknown>) => await handlerOf<Record<string, unknown>, unknown>(bests)({ db: fakeDb(HISTORY).db, auth: ANONYMOUS_AUTH }, args);
  const names = ['Ada', 'Bea', 'Cy', 'Nobody'];

  it('answers exactly as before without the argument', async () => {
    expect(await askBests({ names, cutoffDate: '2025-06-01' })).toEqual([
      { name: 'Ada', best_snatch: 90, best_cj: 110, best_total: 200 },
      { name: 'Bea', best_snatch: 0, best_cj: 0, best_total: 0 },
      { name: 'Cy', best_snatch: 0, best_cj: 0, best_total: 0 },
      { name: 'Nobody', best_snatch: 0, best_cj: 0, best_total: 0 },
    ]);
    expect(await askBests({ names, cutoffDate: '2025-06-01', latestWhenEmpty: false })).toEqual(await askBests({ names, cutoffDate: '2025-06-01' }));
  });

  it("answers each windowless name's latest meet, marked latest, and zeros for a name with no results", async () => {
    expect(await askBests({ names, cutoffDate: '2025-06-01', latestWhenEmpty: true })).toEqual([
      { name: 'Ada', best_snatch: 90, best_cj: 110, best_total: 200 },
      { name: 'Bea', best_snatch: 77.5, best_cj: 97.5, best_total: 175, latest: true },
      { name: 'Cy', best_snatch: 0, best_cj: 0, best_total: 0, latest: true },
      { name: 'Nobody', best_snatch: 0, best_cj: 0, best_total: 0, latest: true },
    ]);
  });
});
