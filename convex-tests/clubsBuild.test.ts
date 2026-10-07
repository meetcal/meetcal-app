import { clubNamesPage, computeClubs, distinctCollated } from '../convex/lib/referenceData';
import { buildClubs } from '../convex/views';

// Convex attaches the handler at runtime but omits it from its public types.
function runBuild(ctx: { runQuery: jest.Mock; runMutation: jest.Mock }): Promise<unknown> {
  const registered: unknown = buildClubs;
  if (typeof registered !== 'function' || !('_handler' in registered) || typeof registered._handler !== 'function') {
    throw new Error('Missing Convex action handler');
  }
  return registered._handler(ctx, {});
}

function rosterCtx(clubs: string[]) {
  const rows = clubs.map((club) => ({ club })).sort((a, b) => a.club < b.club ? -1 : a.club > b.club ? 1 : 0);
  const reads = { count: 0 };
  const ctx = {
    db: {
      query: () => ({
        withIndex: (_index: string, build: (q: unknown) => unknown) => {
          let after: string | null = null;
          const q = { gt: (_field: string, value: string) => { after = value; return q; } };
          build(q);
          return {
            first: async () => {
              reads.count += 1;
              return rows.find((row) => after === null || row.club > after) ?? null;
            },
          };
        },
      }),
    },
  };
  return { ctx: ctx as never, reads };
}

describe('bounded club rebuild', () => {
  it('matches the live distinct, collated list across pages without reading every roster entry', async () => {
    const names = ['', 'Zoë', 'Å Club', ...Array.from({ length: 235 }, (_, i) => `Club ${String(i).padStart(3, '0')}`)];
    const roster = [...names, ...Array<string>(10_000).fill('Club 001')];
    const { ctx, reads } = rosterCtx(roster);
    const clubs: string[] = [];
    let after: string | null = null;
    do {
      reads.count = 0;
      const page = await clubNamesPage(ctx, after);
      expect(reads.count).toBeLessThanOrEqual(100);
      clubs.push(...page.clubs);
      after = page.after;
    } while (after !== null);
    expect(distinctCollated(clubs)).toEqual(await computeClubs(rosterCtx(roster).ctx));
    expect(new Set(clubs).size).toBe(names.length - 1);
    expect(clubs).not.toContain('');
  });

  it('finishes an empty roster and a page ending exactly at the bound', async () => {
    expect(await clubNamesPage(rosterCtx(['', '']).ctx, null)).toEqual({ clubs: [], after: null });
    const names = Array.from({ length: 100 }, (_, i) => `Club ${String(i).padStart(3, '0')}`);
    const { ctx } = rosterCtx(names);
    const first = await clubNamesPage(ctx, null);
    expect(first.clubs).toEqual(names);
    expect(await clubNamesPage(ctx, first.after)).toEqual({ clubs: [], after: null });
  });

  it('publishes all pages with the original version when a write arrives during the scan', async () => {
    const runQuery = jest.fn()
      .mockResolvedValueOnce({ clubs: ['Alpha'], after: 'Alpha', sources: [{ table: 'athletes', version: 4 }] })
      .mockResolvedValueOnce({ clubs: ['Zulu'], after: null, sources: [{ table: 'athletes', version: 5 }] });
    const runMutation = jest.fn().mockResolvedValue(null);
    await runBuild({ runQuery, runMutation });
    expect(runQuery.mock.calls.map((call) => call[1])).toEqual([{ after: null }, { after: 'Alpha' }]);
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0][1]).toEqual({ clubs: ['Alpha', 'Zulu'], sources: [{ table: 'athletes', version: 4 }] });
  });

  it('does not replace the existing view when a later page fails', async () => {
    const runQuery = jest.fn()
      .mockResolvedValueOnce({ clubs: ['Alpha'], after: 'Alpha', sources: [{ table: 'athletes', version: 4 }] })
      .mockRejectedValueOnce(new Error('page failed'));
    const runMutation = jest.fn();
    await expect(runBuild({ runQuery, runMutation })).rejects.toThrow('page failed');
    expect(runMutation).not.toHaveBeenCalled();
  });

  it('replaces the view with an empty list when the last club was deleted', async () => {
    const sources = [{ table: 'athletes', version: 6 }];
    const runQuery = jest.fn().mockResolvedValue({ clubs: [], after: null, sources });
    const runMutation = jest.fn().mockResolvedValue(null);
    await runBuild({ runQuery, runMutation });
    expect(runMutation.mock.calls[0][1]).toEqual({ clubs: [], sources });
  });
});
