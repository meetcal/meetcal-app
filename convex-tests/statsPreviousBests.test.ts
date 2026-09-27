import { computeStatsRows, previousBests, statsPreviousBestKeys, type PreviousBest } from '../convex/lib/meetData';

type Row = Record<string, unknown>;

/**
 * Just enough of Convex's `ctx.db` for the stats readers: equality and `lt`
 * range on an index, then `collect`. Counts documents read per query.
 */
function fakeCtx(tables: Record<string, Row[]>) {
  const reads = { resultsBefore: 0 };
  const ctx = {
    db: {
      query: (table: string) => ({
        withIndex: (_index: string, build: (q: unknown) => unknown) => {
          const filters: ((row: Row) => boolean)[] = [];
          let ranged = false;
          const q = {
            eq: (field: string, value: unknown) => {
              filters.push((row) => row[field] === value);
              return q;
            },
            lt: (field: string, value: string) => {
              ranged = true;
              filters.push((row) => String(row[field]) < value);
              return q;
            },
          };
          build(q);
          return {
            collect: async () => {
              const rows = (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
              if (ranged) reads.resultsBefore += 1;
              return rows;
            },
          };
        },
      }),
    },
  };
  return { ctx: ctx as never, reads };
}

let created = 0;
function result(name: string, meet: string, date: string, total: number | undefined, federation = 'USAW'): Row {
  created += 1;
  return {
    _creationTime: created,
    name,
    nameKey: name.toLowerCase(),
    meet,
    date,
    total,
    federation,
    snatchBest: total === undefined ? undefined : Math.floor(total / 2),
    cjBest: total === undefined ? undefined : Math.ceil(total / 2),
  };
}

function athlete(name: string, club: string): Row {
  return { name, meet: 'Nationals', club, gender: 'F', weightClass: '71' };
}

const tables = {
  athletes: [athlete('Ann', 'North'), athlete('Bea', 'South'), athlete('Cat', 'North')],
  lifting_results: [
    result('Ann', 'Nationals', '2026-06-20', 200),
    result('Ann', 'Open', '2026-01-10', 190),
    result('Ann', 'Worlds', '2025-11-01', 210, 'BWL'),
    result('Bea', 'Nationals', '2026-06-20', 180),
    result('Bea', 'Open', '2026-01-10', undefined),
    result('Cat', 'Nationals', '2026-06-20', 150),
    result('Cat', 'Old', '2024-05-01', 0),
  ],
};

describe('stats previous bests', () => {
  it('read in batches beforehand give the same rows as reading them in the build', async () => {
    const inline = await computeStatsRows(fakeCtx(tables).ctx, 'Nationals');

    const { ctx, reads } = fakeCtx(tables);
    const wanted = await statsPreviousBestKeys(ctx, 'Nationals');
    const known = await previousBests(ctx, wanted);
    reads.resultsBefore = 0;
    const assembled = await computeStatsRows(ctx, 'Nationals', undefined, known);

    expect(assembled).toEqual(inline);
    // Everything was handed in, so the build read no earlier results itself.
    expect(reads.resultsBefore).toBe(0);
    expect(Object.fromEntries(assembled.map((row) => [row.name, row.previous_best]))).toEqual({
      // BWL excluded; a missing total is skipped, a zero total counts.
      Ann: 190,
      Bea: null,
      Cat: 0,
    });
  });

  it('reads only the athletes missing from what was handed in', async () => {
    const { ctx, reads } = fakeCtx(tables);
    const known: PreviousBest[] = [{ key: 'ann', before: '2026-06-20', best: 190 }];
    const rows = await computeStatsRows(ctx, 'Nationals', undefined, known);
    expect(reads.resultsBefore).toBe(2);
    expect(rows.find((row) => row.name === 'Bea')?.previous_best).toBeNull();
  });

  it('does not reuse a best handed in for another date', async () => {
    const { ctx, reads } = fakeCtx(tables);
    const stale: PreviousBest[] = [{ key: 'ann', before: '2026-01-10', best: 999 }];
    const rows = await computeStatsRows(ctx, 'Nationals', 'North', stale);
    expect(reads.resultsBefore).toBe(2);
    expect(rows.find((row) => row.name === 'Ann')?.previous_best).toBe(190);
  });
});
