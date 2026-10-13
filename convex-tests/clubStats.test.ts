import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clubStats, computeStatsRows, liftKey, medalFor, rankingGroup, rankOf, type StatsRow } from '../convex/lib/meetData';
import { formatResults } from '../convex/scrapers/parse/sport80';
import { clubKey } from '../convex/lib/clubs';

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

  it('rank results equal on every field together and leave non-positive values unplaced', () => {
    const key = (lift: number): readonly [number, number, number, number] => [lift, lift, 1, 80];
    expect(rankOf(key(100), [key(100), key(100), key(90)])).toBe(1);
    expect(rankOf(key(90), [key(100), key(100), key(90)])).toBe(3);
    expect(rankOf(key(0), [key(0), key(0)])).toBeNull();
    expect(rankOf(key(-5), [key(10)])).toBeNull();
    expect(medalFor(3, 1)).toBe('bronze');
    expect(medalFor(4, 1)).toBeNull();
    expect(medalFor(null, 100)).toBeNull();
  });
});

/** A result in a division, with its attempts (negative = missed) and body weight. */
function lifted(name: string, age: string | undefined, snatches: number[], cjs: number[], bodyWeight?: number): Row {
  created += 1;
  const best = (attempts: number[]) => Math.max(0, ...attempts);
  const snatchBest = best(snatches);
  const cjBest = best(cjs);
  return {
    _creationTime: created,
    name,
    nameKey: name.toLowerCase(),
    meet: 'Open',
    date: '2026-06-20',
    age,
    bodyWeight,
    snatch1: snatches[0],
    snatch2: snatches[1],
    snatch3: snatches[2],
    snatchBest,
    cj1: cjs[0],
    cj2: cjs[1],
    cj3: cjs[2],
    cjBest,
    total: snatchBest > 0 && cjBest > 0 ? snatchBest + cjBest : 0,
    federation: 'USAW',
  };
}

const W71 = "Open Women's 71kg";

async function placingsOf(tables: Record<string, Row[]>): Promise<Record<string, StatsRow['placings']>> {
  const rows = await computeStatsRows(fakeCtx(tables), 'Open');
  return Object.fromEntries(rows.map((row) => [row.name, row.placings]));
}

describe('club meet stats tie-breaks', () => {
  it('place a tied total by the lighter clean & jerk that made it, as it was lifted first', async () => {
    const placings = await placingsOf({
      athletes: [athlete('Ann', 'North'), athlete('Bea', 'South')],
      lifting_results: [
        // 100 + 127 = 227: the 127 came before Bea's 130 in the session.
        lifted('Ann', W71, [95, 100, -103], [120, 124, 127], 70),
        lifted('Bea', W71, [90, 97, -100], [130, -135, -135], 69),
      ],
    });
    expect(placings).toEqual({ Ann: [1, 2, 1], Bea: [2, 1, 2] });
  });

  it('place the same weight by the lower attempt number, and share it on the same attempt', async () => {
    const placings = await placingsOf({
      athletes: [athlete('Ann', 'North'), athlete('Bea', 'South'), athlete('Cat', 'South')],
      lifting_results: [
        // All lift 98 and 129. Ann makes 129 on her first attempt, Bea and Cat on their second.
        lifted('Ann', W71, [-98, 98, -102], [129, -133, -134], 70.5),
        lifted('Bea', W71, [94, 98, -101], [124, 129, -133], 70.9),
        lifted('Cat', W71, [94, 98, -101], [124, 129, -133], 70.1),
      ],
    });
    // Snatch: all on attempt 2, so all share first. C&J and total: Ann's attempt 1
    // came first; Bea and Cat share second, whatever their body weights.
    expect(placings).toEqual({ Ann: [1, 1, 1], Bea: [1, 2, 2], Cat: [1, 2, 2] });
  });

  it('give every lifter sharing gold a gold medal, and the next lifter bronze', async () => {
    const rows = await computeStatsRows(
      fakeCtx({
        athletes: [athlete('Ann', 'North'), athlete('Bea', 'South'), athlete('Cat', 'South')],
        lifting_results: [
          // Ann and Bea make the same weights on the same attempts; Bea is lighter.
          lifted('Ann', W71, [80, -85, -85], [100, -105, -105], 70.8),
          lifted('Bea', W71, [80, -85, -85], [100, -105, -105], 68.2),
          lifted('Cat', W71, [75, -80, -80], [95, -100, -100], 69),
        ],
      }),
      'Open',
    );
    expect(Object.fromEntries(rows.map((row) => [row.name, row.placings]))).toEqual({
      Ann: [1, 1, 1],
      Bea: [1, 1, 1],
      Cat: [3, 3, 3],
    });
    expect(clubStats(rows, 'North', 1)).toMatchObject({ gold_medals: 3, silver_medals: 0, bronze_medals: 0 });
    expect(clubStats(rows, 'South', 2)).toMatchObject({ gold_medals: 3, silver_medals: 0, bronze_medals: 3 });
  });

  it('let results equal on every field share a placing', async () => {
    const placings = await placingsOf({
      athletes: [athlete('Ann', 'North'), athlete('Bea', 'South')],
      lifting_results: [
        lifted('Ann', W71, [80, -85, -85], [100, -105, -105], 70),
        lifted('Bea', W71, [80, -85, -85], [100, -105, -105], 70),
      ],
    });
    expect(placings).toEqual({ Ann: [1, 1, 1], Bea: [1, 1, 1] });
  });

  it('count a missing attempt, or before 2017 a missing body weight, last', () => {
    const date = '2026-06-20';
    const known = liftKey({ date, snatchBest: 80, snatch1: 80, bodyWeight: 70 }, 'snatch');
    const unknown = liftKey({ date, snatchBest: 80, bodyWeight: 0 }, 'snatch');
    expect(known).toEqual([80, 80, 1]);
    expect(unknown).toEqual([80, 80, 4]);
    expect(rankOf(unknown, [known, unknown])).toBe(2);
    expect(liftKey({ date, cjBest: 120, cj1: -120, cj2: 120, total: 200 }, 'total')).toEqual([200, 120, 2]);

    const before = '2016-06-20';
    const weighed = liftKey({ date: before, snatchBest: 80, snatch1: 80, bodyWeight: 70 }, 'snatch');
    const unweighed = liftKey({ date: before, snatchBest: 80, snatch1: 80, bodyWeight: 0 }, 'snatch');
    expect(weighed).toEqual([80, 70, 80, 1]);
    expect(unweighed).toEqual([80, Infinity, 80, 1]);
    expect(rankOf(unweighed, [weighed, unweighed])).toBe(2);
  });

  it('not use body weight to break a tie from 2017 on', () => {
    // The same 80 on the same attempt: Bea is lighter, but who lifted first is not published.
    const ann = { date: '2017-01-01', snatchBest: 80, snatch1: 80, bodyWeight: 70.8 };
    const bea = { ...ann, bodyWeight: 68.2 };
    const keys = [liftKey(ann, 'snatch'), liftKey(bea, 'snatch')];
    expect(keys.map((key) => rankOf(key, keys))).toEqual([1, 1]);
  });

  it('break a tie by the lighter body weight first before 2017', () => {
    // 200 each: Ann's 115 came before Bea's 118, but Bea is lighter.
    const ann = { snatchBest: 85, cjBest: 115, cj1: 115, total: 200, bodyWeight: 68 };
    const bea = { snatchBest: 82, cjBest: 118, cj1: 118, total: 200, bodyWeight: 66.5 };
    const placings = (date: string) => {
      const keys = [liftKey({ ...ann, date }, 'total'), liftKey({ ...bea, date }, 'total')];
      return keys.map((key) => rankOf(key, keys));
    };
    expect(placings('2015-06-20')).toEqual([2, 1]);
    expect(placings('2016-12-31')).toEqual([2, 1]);
    expect(placings('2017-01-01')).toEqual([1, 2]);
  });
});

describe('club meet stats ranking groups', () => {
  it('rank a finisher missing from the roster without giving them a row', async () => {
    const rows = await computeStatsRows(
      fakeCtx({
        athletes: [athlete('Ann', 'North'), athlete('Bea', 'North')],
        lifting_results: [
          lifted('Ann', W71, [80, 85, 88], [100, 105, 110], 70),
          lifted('Bea', W71, [70, 75, -78], [90, 95, -98], 70),
          // A late entry, beating both on every lift.
          lifted('Dee Late', W71, [90, 93, 95], [115, 118, 120], 70),
          // Bombed out of the snatch: she places on the clean & jerk only, not the total.
          lifted('Eve Gone', W71, [-60, -60, -60], [130, -135, -135], 70),
        ],
      }),
      'Open',
    );
    expect(Object.fromEntries(rows.map((row) => [row.name, row.placings]))).toEqual({ Ann: [2, 3, 2], Bea: [3, 4, 3] });
    const north = clubStats(rows, 'North', 2);
    expect([north.gold_medals, north.silver_medals, north.bronze_medals]).toEqual([0, 2, 3]);
  });

  it("group by the result's division, not the roster's weight class", async () => {
    const placings = await placingsOf({
      // Bea entered at 64 and lifted in 71; Cat lifted in another division.
      athletes: [athlete('Ann', 'North', '71'), athlete('Bea', 'South', '64'), athlete('Cat', 'South', '71')],
      lifting_results: [
        lifted('Ann', W71, [80, -85, -85], [100, -105, -105], 70),
        lifted('Bea', W71, [85, -90, -90], [105, -110, -110], 66),
        lifted('Cat', "Junior Women's 71kg", [60, -65, -65], [80, -85, -85], 70),
      ],
    });
    expect(placings).toEqual({ Ann: [2, 2, 2], Bea: [1, 1, 1], Cat: [1, 1, 1] });
  });

  it('rank a name once per division, by its best result there', async () => {
    const placings = await placingsOf({
      athletes: [athlete('Ann', 'North'), athlete('Bea', 'South')],
      lifting_results: [
        lifted('Ann', W71, [80, -85, -85], [100, -105, -105], 70),
        lifted('Bea', W71, [85, -90, -90], [105, -110, -110], 70),
        // A second row for Bea with a better snatch and no total: her 190 total row is the one ranked.
        lifted('Bea', W71, [90, -95, -95], [-110, -110, -110], 70),
      ],
    });
    expect(placings).toEqual({ Ann: [2, 2, 2], Bea: [1, 1, 1] });
  });

  it('place an athlete lifting in two divisions in each, and report the better total', async () => {
    const placings = await placingsOf({
      athletes: [athlete('Ann', 'North'), athlete('Bea', 'South'), athlete('Cat', 'South')],
      lifting_results: [
        // Ann's reported row is her better total, in the Open, behind Bea;
        // her Junior row is not reported but still places ahead of Cat.
        lifted('Ann', W71, [82, -85, -85], [102, -105, -105], 70),
        lifted('Ann', "Junior Women's 71kg", [80, -85, -85], [100, -105, -105], 70),
        lifted('Bea', W71, [85, -90, -90], [105, -110, -110], 70),
        lifted('Cat', "Junior Women's 71kg", [79, -85, -85], [99, -105, -105], 70),
      ],
    });
    expect(placings).toEqual({ Ann: [2, 2, 2], Bea: [1, 1, 1], Cat: [2, 2, 2] });
  });

  it('fall back to the roster gender and weight class for a division with no class', () => {
    expect(rankingGroup("Open Men's 110+kg", undefined)).toBe("Open Men's 110+kg");
    expect(rankingGroup("Women's Masters (35-39) 86 kg", undefined)).toBe("Women's Masters (35-39) 86 kg");
    expect(rankingGroup('Open Women', { gender: 'F', weightClass: '58' })).toBe('Women\u000058\u0000Open Women');
    expect(rankingGroup(undefined, { gender: 'F', weightClass: '58' })).toBe('Women\u000058\u0000');
    // Neither a class in the division nor a roster entry: not ranked.
    expect(rankingGroup('Open Women', undefined)).toBeNull();
    expect(rankingGroup(undefined, undefined)).toBeNull();
  });
});

describe('club meet stats from Sport80 rows', () => {
  /** The 95kg divisions of the 2026 DMV WSO Championships (Sport80 event 7507), as its results table returned them. */
  const DMV_95: { data: Record<string, unknown>[] } = JSON.parse(
    readFileSync(join(__dirname, 'scrapers/fixtures/sport80-results-7507-95kg.json'), 'utf8'),
  );

  it('rank by division and attempts, as the table carries no placing', async () => {
    // No placing, lot number or lifting-order column to take placings from.
    expect(Object.keys(DMV_95.data[0]).sort()).toEqual(
      [
        'age_category', 'best_c&j', 'best_snatch', 'body_weight_(kg)', 'c&j_lift_1', 'c&j_lift_2', 'c&j_lift_3',
        'date', 'lifter', 'meet', 'snatch_lift_1', 'snatch_lift_2', 'snatch_lift_3', 'total',
      ].sort(),
    );
    const results = formatResults('7507', 'Open', Date.UTC(2026, 8, 20), DMV_95.data).map((row) => {
      created += 1;
      return { ...row, _creationTime: created, age: row.age ?? undefined, bodyWeight: row.bodyWeight ?? undefined };
    });
    const rows = await computeStatsRows(
      fakeCtx({
        // Caleb Goodman, who won the Open 95kg, and Ronald Combs, who won the
        // Masters (35-39) 95kg, are missing from the roster.
        athletes: [
          athlete('Grant Miller', 'North', '95'),
          athlete('Alfred Westley', 'North', '95'),
          athlete('Ashvin Pidaparti', 'South', '95'),
          athlete('Keith Wright', 'South', '95'),
        ],
        lifting_results: results,
      }),
      'Open',
    );
    expect(Object.fromEntries(rows.map((row) => [row.name, row.placings]))).toEqual({
      'Grant Miller': [2, 2, 2],
      // Both total 227 from 98 and 129, both snatching 98 on attempt 2, so
      // they share the snatch placing. Westley made 129 on his first clean &
      // jerk, Pidaparti on his second.
      'Alfred Westley': [3, 3, 3],
      'Ashvin Pidaparti': [3, 4, 4],
      // Ranked in the Masters (35-39) 95kg, not the Open.
      'Keith Wright': [2, 2, 2],
    });
    expect(clubStats(rows, 'North', 2)).toMatchObject({ gold_medals: 0, silver_medals: 3, bronze_medals: 3 });
    expect(clubStats(rows, 'South', 2)).toMatchObject({ gold_medals: 0, silver_medals: 3, bronze_medals: 1 });
  });
});

describe('club meet stats for two lifters of one name (#247)', () => {
  const lifter = (club: string, weightClass: string, age: string, snatch: number, cj: number): [Row, Row] => [
    { name: 'John Smith', meet: 'Open', club, gender: 'M', weightClass },
    { ...result('John Smith', snatch, cj), age },
  ];

  it("credits each lifter's result to their own club, matched on the class their division names", async () => {
    const [x, xResult] = lifter('Club X', '61', "Open Men's 61kg", 110, 140);
    const [y, yResult] = lifter('Club Y', '89', "Open Men's 89kg", 130, 170);
    const ctx = fakeCtx({ athletes: [x, y], lifting_results: [xResult, yResult] });
    const rows = await computeStatsRows(ctx, 'Open');
    expect(rows.map((r) => [r.club, r.weight_class, r.total]).sort()).toEqual([
      ['Club X', '61', 250],
      ['Club Y', '89', 300],
    ]);
    expect(clubStats(rows, 'Club X', 1).athlete_results.map((r) => [r.weight_class, r.total, r.total_medal])).toEqual([['61', 250, 'gold']]);
    expect(clubStats(rows, 'Club Y', 1).athlete_results.map((r) => [r.weight_class, r.total, r.total_medal])).toEqual([['89', 300, 'gold']]);
  });

  it('takes the class match when its club is spelled two ways (one club)', async () => {
    const [x] = lifter('Club X', '61', "Open Men's 61kg", 0, 0);
    const [y, yResult] = lifter('ONG Weightlifting', '89', "Open Men's 89kg", 130, 170);
    const yAgain = { ...y, club: 'Ong  Weightlifting' };
    // Club X's row sorts first; the 89 kg rows are one club under two spellings.
    const rows = await computeStatsRows(fakeCtx({ athletes: [x, y, yAgain], lifting_results: [yResult] }), 'Open');
    expect(rows.map((r) => [r.weight_class, r.total])).toEqual([['89', 300]]);
    expect(clubKey(rows[0].club)).toBe(clubKey('Ong Weightlifting'));
  });

  it('reads a superheavy class either way round, and falls back to the first entry when no class matches', async () => {
    const [x, xResult] = lifter('Club X', '+109', "Open Men's 109+kg", 150, 190);
    const [y] = lifter('Club Y', '89', "Open Men's 89kg", 0, 0);
    expect((await computeStatsRows(fakeCtx({ athletes: [y, x], lifting_results: [xResult] }), 'Open')).map((r) => r.club)).toEqual(['Club X']);
    const [, other] = lifter('Club Z', '96', "Open Men's 96kg", 140, 170);
    expect((await computeStatsRows(fakeCtx({ athletes: [x, y], lifting_results: [other] }), 'Open')).map((r) => r.club)).toEqual(['Club X']);
  });
});

