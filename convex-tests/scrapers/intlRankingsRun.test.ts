import { run } from '../../convex/scrapers/intlRankings';
import { describeFailure } from '../../convex/lib/cronAlerts';
import { handlerOf } from '../fakeDb';

jest.mock('../../convex/scrapers/lib/http', () => ({
  fetchText: jest.fn(async () => 'standings page'),
  fetchBytes: jest.fn(async (url: string) => new TextEncoder().encode(url)),
}));
jest.mock('../../convex/scrapers/lib/pdf', () => ({
  pdfLines: jest.fn(async (bytes: Uint8Array) => [[new TextDecoder().decode(bytes)]]),
}));
jest.mock('../../convex/scrapers/parse/intlRankings', () => ({
  RANKINGS_PAGE_URL: 'https://example.test/standings',
  discoverRankingPdfs: () => [
    { title: 'Worlds - Women', url: 'https://cdn.test/women.pdf' },
    { title: 'Worlds - Men', url: 'https://cdn.test/men.pdf' },
    { title: 'Pan Ams - Men', url: 'https://cdn.test/panams.pdf' },
  ],
  parseMeetInfo: (_lines: string[], title: string) => ({
    meet_name: title.split(' - ')[0],
    gender: title.split(' - ')[1],
    age_category: 'Senior',
  }),
  parseRankingsTable: (lines: string[]) => [{ ranking: 1, name: lines[0], weight_class: '71', total: 200, percent_a: 99 }],
}));

type Args = { dryRun?: boolean; allowShrink?: boolean };

describe('intl-rankings run (#218)', () => {
  it('stores the other groups when one fails to store, skips the prune, and fails naming that PDF', async () => {
    const runMutation = jest.fn(async (_ref: unknown, args: { meet?: string; gender?: string }) => {
      if (args.meet === 'Worlds' && args.gender === 'Men') throw new Error('Duplicate intl ranking in payload: 1 / A');
      return { inserted: 1, updated: 0, unchanged: 0, deleted: 0 };
    });
    const failure = await handlerOf<Args>(run)({ runMutation }, {}).catch((error: unknown) => error);

    // The group after the failing one was still stored, and nothing was pruned.
    const stored = runMutation.mock.calls.map(([, args]) => `${args.meet} ${args.gender}`);
    expect(stored).toEqual(['Worlds Women', 'Worlds Men', 'Pan Ams Men']);
    expect(runMutation.mock.calls.some(([, args]) => 'groups' in args)).toBe(false);
    // A sources failure, so the next PDF to fail emails while this one still is.
    const described = describeFailure(failure);
    expect(described.failedSources).toEqual(['Worlds - Men']);
    expect(described.error).toContain('Duplicate intl ranking in payload');
  });

  it('prunes when every group was stored', async () => {
    const runMutation = jest.fn(async (_ref: unknown, args: Record<string, unknown>) =>
      'groups' in args ? { deletedGroups: [] } : { inserted: 0, updated: 0, unchanged: 1, deleted: 0 },
    );
    const result = await handlerOf<Args, { groups: unknown[] }>(run)({ runMutation }, {});
    expect(result.groups).toHaveLength(3);
    expect(runMutation.mock.calls.filter(([, args]) => 'groups' in args)).toHaveLength(1);
  });
});
