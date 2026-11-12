import { computeStatsRowsOfWso, registeredWithWso, statsViewItems, wsoStats, type StatsRow } from '../convex/lib/meetData';
import { meetKey } from '../convex/lib/viewKeys';
import { jsonChunks, writeView } from '../convex/lib/views';
import { wsoMeetStats } from '../convex/reference';
import { ANONYMOUS_AUTH, fakeDb, handlerOf } from './fakeDb';

beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}));

type Row = Record<string, unknown>;

function indexedCtx(tables: Record<string, Row[]>) {
  return {
    db: {
      query: (table: string) => ({
        withIndex: (_index: string, build: (q: unknown) => unknown) => {
          const filters: ((row: Row) => boolean)[] = [];
          const q = {
            eq: (field: string, value: unknown) => {
              filters.push((row) => row[field] === value);
              return q;
            },
            lt: (field: string, value: string) => {
              filters.push((row) => String(row[field]) < value);
              return q;
            },
          };
          build(q);
          const matching = () => (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
          return { collect: async () => matching(), take: async (count: number) => matching().slice(0, count) };
        },
      }),
    },
  } as never;
}

let created = 0;
function result(name: string, snatch: number, cj: number, date = '2026-06-20', meet = 'Open'): Row {
  created += 1;
  return {
    _creationTime: created,
    name,
    nameKey: name.toLowerCase(),
    meet,
    date,
    age: "Open Women's 71kg",
    snatch1: snatch,
    snatch2: 0,
    snatch3: 0,
    cj1: cj,
    cj2: -(cj + 5),
    cj3: 0,
    snatchBest: snatch,
    cjBest: cj,
    total: snatch > 0 && cj > 0 ? snatch + cj : 0,
    federation: 'USAW',
  };
}

function athlete(name: string, club: string, wso: string | undefined, weightClass = '71'): Row {
  return { name, meet: 'Open', club, wso, gender: 'F', weightClass };
}

const ROSTER = [
  athlete('Ann', 'North', 'Carolina'),
  athlete('Bea', 'South', ' carolina '),
  athlete('Cat', 'East', 'Florida'),
  athlete('Dee', 'West', undefined),
  athlete('Eve', 'North', 'Carolina', '77'),
];

const RESULTS = [
  result('Ann', 80, 100),
  result('Bea', 90, 110),
  result('Cat', 95, 120),
  result('Dee', 70, 90),
  result('Ann', 70, 90, '2025-01-01', 'Earlier'),
];

describe("a WSO's meet stats", () => {
  it('match a WSO whatever its case and spacing, and never an entry without one', () => {
    expect(registeredWithWso({ wso: ' carolina ' }, 'Carolina')).toBe(true);
    expect(registeredWithWso({ wso: 'Florida' }, 'Carolina')).toBe(false);
    expect(registeredWithWso({}, 'Carolina')).toBe(false);
  });

  it("count the WSO's registered athletes, and its medals, PRs and make rates as a club's are counted", async () => {
    const ctx = indexedCtx({ athletes: ROSTER, lifting_results: RESULTS });
    const rows = await computeStatsRowsOfWso(ctx, 'Open', 'Carolina');
    expect(rows.map((row) => row.name).sort()).toEqual(['Ann', 'Bea']);

    const stats = wsoStats(rows, ROSTER as never, 'Carolina');
    expect(stats.total_athletes).toBe(3);
    expect(stats.athlete_results.map((r) => [r.name, r.total, r.snatch_medal, r.cj_medal, r.total_medal, r.is_pr])).toEqual([
      ['Ann', 180, 'bronze', 'bronze', 'bronze', true],
      ['Bea', 200, 'silver', 'silver', 'silver', false],
    ]);
    expect([stats.gold_medals, stats.silver_medals, stats.bronze_medals]).toEqual([0, 3, 3]);
    expect(stats.total_prs).toBe(1);
    expect(stats.total_weight_lifted).toBe(380);
    expect(stats.snatch_make_rate).toBe(100);
    expect(stats.cj_make_rate).toBe(50);
    expect(stats.combined_make_rate).toBe(67);
  });

  it("leave out another WSO's lifter who shares a name with one of its own", () => {
    const row = (club: string, weightClass: string): StatsRow => ({
      key: 'ann',
      name: 'Ann',
      club,
      weight_class: weightClass,
      body_weight: 70,
      attempts: [80, 0, 0, 100, 0, 0],
      snatch_best: 80,
      cj_best: 100,
      total: 180,
      placings: [1, 1, 1],
      previous_best: null,
    });
    const roster = [athlete('Ann', 'North', 'Carolina'), athlete('Ann', 'Gulf', 'Florida', '64')];
    const stats = wsoStats([row('North', '71'), row('Gulf', '64')], roster as never, 'Florida');
    expect(stats.total_athletes).toBe(1);
    expect(stats.athlete_results).toHaveLength(1);
    expect(stats.gold_medals).toBe(3);
  });

  it('credit a result joined to one of two identical entries to the first entry, as the live path does', () => {
    const row: StatsRow = {
      key: 'ann',
      name: 'Ann',
      club: 'Unattached',
      weight_class: '71',
      body_weight: 70,
      attempts: [80, 0, 0, 100, 0, 0],
      snatch_best: 80,
      cj_best: 100,
      total: 180,
      placings: [1, 1, 1],
      previous_best: null,
    };
    const roster = [athlete('Ann', 'Unattached', 'Carolina'), athlete('Ann', 'Unattached', 'Florida')];
    expect(wsoStats([row], roster as never, 'Carolina').athlete_results).toHaveLength(1);
    const florida = wsoStats([row], roster as never, 'Florida');
    expect(florida.athlete_results).toHaveLength(0);
    expect(florida.total_athletes).toBe(1);
  });

  it("answer from the meet's stats view when it is fresh", async () => {
    const entry = (name: string, wso: string) => ({ name, club: 'North', wso, meet: 'Open', gender: 'Men', weightClass: '89', entryTotal: 200, memberId: name, age: 40, adaptive: false });
    const viewRow = (name: string): StatsRow => ({
      key: name.toLowerCase(),
      name,
      club: 'North',
      weight_class: '89',
      body_weight: 88,
      attempts: [100, 0, 0, 120, 0, 0],
      snatch_best: 100,
      cj_best: 120,
      total: 220,
      placings: [1, 1, 1],
      previous_best: 200,
    });
    const fake = fakeDb({ athletes: [entry('Al', 'Carolina'), entry('Bo', 'Florida')] });
    await writeView(
      { db: fake.db } as never,
      meetKey('Open', 'stats'),
      jsonChunks(statsViewItems([viewRow('Al'), viewRow('Bo')], [])),
      [{ table: 'lifting_results', version: 1 }],
      { meta: '2026-06-20' },
    );
    const stats = (await handlerOf<{ wso: string; meet: string }, { total_athletes: number; total_prs: number; athlete_results: { name: string }[] }>(wsoMeetStats)(
      { db: fake.db, auth: ANONYMOUS_AUTH },
      { wso: 'Carolina', meet: 'Open' },
    ));
    expect(stats.total_athletes).toBe(1);
    expect(stats.athlete_results.map((r) => r.name)).toEqual(['Al']);
    expect(stats.total_prs).toBe(1);
  });

  it('answer zero athletes for a WSO with nobody at the meet, and refuse an empty WSO or meet', async () => {
    const entry = (name: string, wso: string) => ({ name, club: 'North', wso, meet: 'Open', gender: 'Men', weightClass: '89', entryTotal: 200, memberId: name, age: 40, adaptive: false });
    const fake = fakeDb({ athletes: [entry('Al', 'Carolina'), entry('Bo', 'Carolina')] });
    const query = (args: { wso: string; meet: string }) => handlerOf<typeof args, { total_athletes: number; athlete_results: unknown[] }>(wsoMeetStats)({ db: fake.db, auth: ANONYMOUS_AUTH }, args);
    expect(await query({ wso: 'carolina', meet: 'Open' })).toMatchObject({ total_athletes: 2, athlete_results: [] });
    expect(await query({ wso: 'Florida', meet: 'Open' })).toMatchObject({ total_athletes: 0, athlete_results: [] });
    await expect(query({ wso: ' ', meet: 'Open' })).rejects.toMatchObject({ data: { status: 400 } });
    await expect(query({ wso: 'Carolina', meet: '' })).rejects.toMatchObject({ data: { status: 400 } });
  });
});
