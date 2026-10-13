import { run } from '../../convex/scrapers/records';
import { describeFailure } from '../../convex/lib/cronAlerts';
import { handlerOf } from '../fakeDb';

const mockPdfLines = jest.fn<Promise<string[][]>, []>();
jest.mock('../../convex/scrapers/lib/http', () => ({
  ...jest.requireActual('../../convex/scrapers/lib/http'),
  fetchText: jest.fn(async () => '<div><h3>American Records</h3><a href="https://cdn.test/records.pdf">View</a></div>'),
  fetchBytes: jest.fn(async () => new Uint8Array()),
}));
jest.mock('../../convex/scrapers/lib/pdf', () => ({ pdfLines: () => mockPdfLines() }));

type Result = { deleted: string[]; unknownAgeGroups: string[]; pruneRefused?: string };

/** The mutations: a prune (it has a `recordType`) refuses without `allowShrink` when `refuse` is set. */
function mutations(refuse = false) {
  return jest.fn(async (_ref: unknown, args: Record<string, unknown>) => {
    if ('recordType' in args) {
      if (refuse && !args.allowShrink) throw new Error('refusing to delete 90 of 300 stored USAW record classes');
      return { deleted: ['U17 Men 56kg'] };
    }
    return (args.rows as unknown[]).map(() => ({ wasInsert: false, wasChanged: false }));
  });
}
const calls = (runMutation: ReturnType<typeof mutations>) =>
  runMutation.mock.calls.map(([, args]) => ('recordType' in args ? `prune${args.dryRun ? ' (dry run)' : ''}` : 'upsert'));

describe('records run (#406, #255)', () => {
  it('prunes the classes the PDF no longer lists when every age group was read', async () => {
    mockPdfLines.mockResolvedValue([['16-17yo M 85 TOTAL 290 WHITLOCK, Robert 2026-08-29', 'OPEN F 49 TOTAL 206 DOE, Jane 2026-06-20']]);
    const runMutation = mutations();
    const result = await handlerOf<Record<string, never>, Result>(run)({ runMutation }, {});
    expect(result.deleted).toEqual(['U17 Men 56kg']);
    // The prune's guard is checked before anything is written.
    expect(calls(runMutation)).toEqual(['prune (dry run)', 'upsert', 'prune']);
    const prune = runMutation.mock.calls.find(([, args]) => 'recordType' in args)?.[1];
    expect(prune).toMatchObject({ recordType: 'USAW', allowShrink: false });
    expect(prune?.keep).toEqual([
      { ageCategory: 'u17', gender: 'men', weightClass: '85kg' },
      { ageCategory: 'senior', gender: 'women', weightClass: '49kg' },
    ]);
  });

  it('stores what it read, prunes nothing and fails naming an age group it does not know', async () => {
    mockPdfLines.mockResolvedValue([['18-20yo M 85 TOTAL 290 WHITLOCK, Robert 2026-08-29', 'OPEN F 49 TOTAL 206 DOE, Jane 2026-06-20']]);
    const runMutation = mutations();
    const failure = await handlerOf<Record<string, never>, Result>(run)({ runMutation }, {}).catch((error: unknown) => error);
    expect(describeFailure(failure).failedSources).toEqual(['age group 18-20yo']);
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0][1]).toHaveProperty('rows');
  });

  it('writes nothing when the prune would refuse, so the new classes are not stored beside the old', async () => {
    mockPdfLines.mockResolvedValue([['16-17yo M 85 TOTAL 290 WHITLOCK, Robert 2026-08-29']]);
    const runMutation = mutations(true);
    await expect(handlerOf<Record<string, never>, Result>(run)({ runMutation }, {})).rejects.toThrow('refusing to delete 90');
    expect(calls(runMutation)).toEqual(['prune (dry run)']);
  });

  it('lists what the prune would delete, and why it would refuse, on a dry run', async () => {
    mockPdfLines.mockResolvedValue([['16-17yo M 85 TOTAL 290 WHITLOCK, Robert 2026-08-29']]);
    const runMutation = mutations(true);
    const result = await handlerOf<{ dryRun: boolean }, Result>(run)({ runMutation }, { dryRun: true });
    expect(result).toMatchObject({ deleted: ['U17 Men 56kg'], pruneRefused: expect.stringContaining('refusing to delete 90') });
    expect(calls(runMutation)).toEqual(['prune (dry run)', 'prune (dry run)']);
  });

  it('names the age groups when it read none it knows', async () => {
    mockPdfLines.mockResolvedValue([['18-20yo M 85 TOTAL 290 WHITLOCK, Robert 2026-08-29']]);
    const failure = await handlerOf<Record<string, never>, Result>(run)({ runMutation: mutations() }, {}).catch((error: unknown) => error);
    expect(describeFailure(failure).failedSources).toEqual(['age group 18-20yo']);
  });
});
