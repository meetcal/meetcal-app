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
      ...Array.from({ length: 1100 }, (_, i) => ({ name: `Lifter ${i % 20}`, total: i + 1 })),
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
    const rows = Array.from({ length: 8200 }, (_, i) => ({ name: `Lifter ${i}`, total: i + 1 }));
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
