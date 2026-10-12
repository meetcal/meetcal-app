import { clubStats, computeStatsRows, medalFor, rankOf, type StatsRow } from '../convex/lib/meetData';

type Row = Record<string, unknown>;

/** Just enough of Convex's `ctx.db` for the stats readers: index equality / `lt`, then `collect`. */
function fakeCtx(tables: Record<string, Row[]>) {
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
          return { collect: async () => (tables[table] ?? []).filter((row) => filters.every((f) => f(row))) };
        },
      }),
    },
  } as never;
}

let created = 0;
function result(name: string, snatch: number, cj: number): Row {
  created += 1;
  return {
    _creationTime: created,
    name,
    nameKey: name.toLowerCase(),
    meet: 'Open',
    date: '2026-06-20',
    age: 'Open Women',
    snatchBest: snatch,
    cjBest: cj,
    total: snatch > 0 && cj > 0 ? snatch + cj : 0,
    federation: 'USAW',
  };
}

function athlete(name: string, club: string, weightClass = '71'): Row {
  return { name, meet: 'Open', club, gender: 'F', weightClass };
}

describe('club meet stats placings', () => {
  it('give a bombed-out lift or total no placing and no medal', async () => {
    const ctx = fakeCtx({
      athletes: [athlete('Ann', 'North', '58'), athlete('Bea', 'North'), athlete('Cat', 'South')],
      lifting_results: [
        // Alone in her group, bombed out of the clean & jerk.
        result('Ann', 80, 0),
        // Two in a group: Bea bombs out of the snatch, Cat makes everything.
        result('Bea', 0, 110),
        result('Cat', 90, 100),
      ],
    });
    const rows = await computeStatsRows(ctx, 'Open');
    const placings = Object.fromEntries(rows.map((row) => [row.name, row.placings]));
    expect(placings).toEqual({
      Ann: [1, null, null],
      Bea: [null, 1, null],
      Cat: [1, 2, 1],
    });

    const north = clubStats(rows, 'North', 2);
    expect([north.gold_medals, north.silver_medals, north.bronze_medals]).toEqual([2, 0, 0]);
    expect(north.athlete_results.map((r) => [r.name, r.snatch_medal, r.cj_medal, r.total_medal, r.medal])).toEqual([
      ['Ann', 'gold', null, null, null],
      ['Bea', null, 'gold', null, null],
    ]);
  });

  it('award no medal for a zero lift a stale stats view still placed', () => {
    // A view built before bomb-outs went unplaced: placing 1 on a total of 0.
    const stale: StatsRow = {
      key: 'ann',
      name: 'Ann',
      club: 'North',
      weight_class: '58',
      body_weight: 57,
      attempts: [-80, -80, -80, 100, 105, 110],
      snatch_best: 0,
      cj_best: 110,
      total: 0,
      placings: [1, 1, 1],
      previous_best: null,
    };
    const stats = clubStats([stale], 'North', 1);
    expect([stats.gold_medals, stats.silver_medals, stats.bronze_medals]).toEqual([1, 0, 0]);
    expect(stats.athlete_results[0]).toMatchObject({ snatch_medal: null, cj_medal: 'gold', total_medal: null, medal: null });
  });

  it('rank ties together and leave non-positive values unplaced', () => {
    expect(rankOf(100, [100, 100, 90])).toBe(1);
    expect(rankOf(90, [100, 100, 90])).toBe(3);
    expect(rankOf(0, [0, 0])).toBeNull();
    expect(rankOf(-5, [10])).toBeNull();
    expect(medalFor(3, 1)).toBe('bronze');
    expect(medalFor(4, 1)).toBeNull();
    expect(medalFor(null, 100)).toBeNull();
  });
});
