import { bestTotalPerAthlete, nationalRankingPage } from '../convex/lib/referenceData';
import { buildNat, computeNat } from '../convex/views';

function runHandler(fn: unknown, ctx: { runQuery: jest.Mock; runMutation?: jest.Mock }) {
  if (typeof fn !== 'function' || !('_handler' in fn) || typeof fn._handler !== 'function') throw new Error('Missing handler');
  return fn._handler(ctx, { federation: 'USAW', ageCategory: 'Open' });
}

type Row = { name: string; total?: number };
function pageCtx(rows: Row[]) {
  const paginate = jest.fn(async ({ cursor, numItems }: { cursor: string | null; numItems: number }) => {
    expect(numItems).toBe(1000);
    const offset = Number(cursor ?? 0);
    const end = Math.min(offset + numItems, rows.length);
    return { page: rows.slice(offset, end), continueCursor: String(end), isDone: end === rows.length };
  });
  const ctx = {
    db: { query: () => ({ withIndex: (_index: string, build: (q: unknown) => unknown) => {
      const q = { eq: () => q }; build(q); return { paginate };
    } }) },
  };
  return { ctx: ctx as never, paginate };
}

describe('paged national ranking computation', () => {
  it('keeps the best total across page boundaries and sorts ties by name', async () => {
    const rows: Row[] = [
      { name: 'Ada', total: 300 },
      ...Array.from({ length: 1100 }, (_, i) => ({ name: `Lifter ${i % 20}`, total: (i % 300) + 1 })),
      { name: 'Ada', total: 400 }, { name: 'Bo', total: 400 },
      { name: 'No total' }, { name: 'Bombout', total: 0 },
    ];
    const { ctx } = pageCtx(rows);
    const runQuery = jest.fn(async (_fn, { cursor }: { cursor: string | null }) => ({
      ...(await nationalRankingPage(ctx, 'USAW', 'Open', cursor)), sources: [{ table: 'lifting_results', version: cursor === null ? 4 : 5 }],
    }));
    const result = await runHandler(computeNat, { runQuery });
    const expected = bestTotalPerAthlete(rows.flatMap((r) => r.total === undefined || r.total === 0 ? [] : [{ name: r.name, total: r.total }]));
    expect(result).toEqual({ chunks: [JSON.stringify(expected)], sources: [{ table: 'lifting_results', version: 4 }] });
    expect(expected.filter((r) => r.total === 400).map((r) => r.name)).toEqual(['Ada', 'Bo']);
    expect(runQuery).toHaveBeenCalledTimes(2);
  });

  it('ranks one athlete once across pages whatever the spelling, under their best row (#217)', async () => {
    const rows: Row[] = [
      { name: 'Maria Lopez', total: 180 },
      ...Array.from({ length: 999 }, (_, i) => ({ name: `Lifter ${i}`, total: 100 })),
      { name: 'maria  lopez', total: 185 },
      { name: 'MARIA LOPEZ', total: 170 },
    ];
    const { ctx } = pageCtx(rows);
    const runQuery = jest.fn(async (_fn, { cursor }: { cursor: string | null }) => ({
      ...(await nationalRankingPage(ctx, 'USAW', 'Open', cursor)), sources: [{ table: 'lifting_results', version: 4 }],
    }));
    const result = await runHandler(computeNat, { runQuery });
    const ranked = JSON.parse(result.chunks.join('')) as Row[];
    expect(ranked.filter((r) => r.name.toLowerCase().includes('lopez'))).toEqual([{ name: 'maria  lopez', total: 185 }]);
    expect(ranked).toHaveLength(1000);
  });

  it('leaves out rows whose numbers cannot be real (#400)', async () => {
    const rows = [
      // Missouri Valley Championships 2018: a `223` typed for `22`.
      { name: 'Danielle King', snatch1: 19, snatch2: 21, snatch3: -23, snatchBest: 21, cj1: 223, cj2: 27, cj3: -30, cjBest: 223, total: 244 },
      { name: 'Danielle King', snatch1: 18, snatch2: 20, snatch3: 21, snatchBest: 21, cj1: 20, cj2: 22, cj3: -24, cjBest: 22, total: 43 },
      // Stored twice, once with `201` for `20`.
      { name: 'McKynzie Chuna', snatch1: 16, snatch2: 18, snatch3: -19, snatchBest: 18, cj1: 201, cj2: 21, cj3: 23, cjBest: 201, total: 219 },
      { name: 'Mia Rhodes', snatch1: 60, snatch2: 63, snatch3: -65, snatchBest: 63, cj1: 75, cj2: 78, cj3: -80, cjBest: 78, total: 141 },
      // Total not the sum of the bests (a shifted column).
      { name: 'Shifted', snatchBest: 69, cjBest: 48, total: 51 },
      // Over any world record.
      { name: 'Christian Green', total: 1184 },
    ];
    const { ctx } = pageCtx(rows as Row[]);
    expect((await nationalRankingPage(ctx, 'USAW', 'Open', null)).rows).toEqual([
      { name: 'Mia Rhodes', total: 141 },
      { name: 'Danielle King', total: 43 },
    ]);
  });

  it('handles a zero-total page without stopping before later valid results', async () => {
    const rows = [...Array.from({ length: 1000 }, () => ({ name: 'Bombout', total: 0 })), { name: 'Ada', total: 200 }];
    const { ctx } = pageCtx(rows);
    const first = await nationalRankingPage(ctx, 'USAW', 'Open', null);
    expect(first.rows).toEqual([]);
    expect(first.isDone).toBe(false);
    expect((await nationalRankingPage(ctx, 'USAW', 'Open', first.cursor)).rows).toEqual([{ name: 'Ada', total: 200 }]);
  });

  it('publishes only a completed scan and keeps its original source stamp', async () => {
    const runQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ name: 'Ada', total: 200 }], cursor: 'next', isDone: false, sources: [{ table: 'lifting_results', version: 4 }] })
      .mockResolvedValueOnce({ rows: [{ name: 'Ada', total: 300 }], cursor: 'end', isDone: true, sources: [{ table: 'lifting_results', version: 5 }] });
    const runMutation = jest.fn().mockResolvedValue(1);
    expect(await runHandler(buildNat, { runQuery, runMutation })).toBe(1);
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0][1]).toEqual({ federation: 'USAW', ageCategory: 'Open', chunks: ['[{"name":"Ada","total":300}]'], count: 1, sources: [{ table: 'lifting_results', version: 4 }] });
  });

  it('does not publish partial rankings when a later page fails', async () => {
    const runQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ name: 'Ada', total: 200 }], cursor: 'next', isDone: false, sources: [{ table: 'lifting_results', version: 4 }] })
      .mockRejectedValueOnce(new Error('page failed'));
    const runMutation = jest.fn();
    await expect(runHandler(buildNat, { runQuery, runMutation })).rejects.toThrow('page failed');
    expect(runMutation).not.toHaveBeenCalled();
  });

  it('publishes an empty class after the last result is deleted', async () => {
    const runQuery = jest.fn().mockResolvedValue({ rows: [], cursor: 'end', isDone: true, sources: [{ table: 'lifting_results', version: 6 }] });
    const runMutation = jest.fn().mockResolvedValue(0);
    expect(await runHandler(buildNat, { runQuery, runMutation })).toBe(0);
    expect(runMutation.mock.calls[0][1].chunks).toEqual(['[]']);
  });

  it('transfers more than 8192 ranked athletes as JSON chunks instead of a Convex array', async () => {
    const rows = Array.from({ length: 8200 }, (_, i) => ({ name: `Lifter ${i}`, total: 100 + (i % 400) }));
    const { ctx } = pageCtx(rows);
    const runQuery = jest.fn(async (_fn, { cursor }: { cursor: string | null }) => ({
      ...(await nationalRankingPage(ctx, 'USAW', 'Open', cursor)), sources: [{ table: 'lifting_results', version: 4 }],
    }));
    const runMutation = jest.fn().mockResolvedValue(rows.length);
    await runHandler(buildNat, { runQuery, runMutation });
    const args = runMutation.mock.calls[0][1];
    expect(args.count).toBe(8200);
    expect(args.chunks.length).toBeLessThan(8192);
    expect(JSON.parse(args.chunks[0])).toEqual(bestTotalPerAthlete(rows));
  });
});
