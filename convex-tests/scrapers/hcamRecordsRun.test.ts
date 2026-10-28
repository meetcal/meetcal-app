import { run } from '../../convex/scrapers/hcamRecords';
import { handlerOf } from '../fakeDb';

const STORAGE = 'https://storage.googleapis.com/production-ipower-v1-0-4/354/1018354/vixoE8Rk';
const mockPdfLines = jest.fn<Promise<string[][]>, [Uint8Array]>();
jest.mock('../../convex/scrapers/lib/incompleteChain', () => ({
  fetchPageText: jest.fn(
    async () => `<a href="${STORAGE}/m?fileName=AM20260101-men-30 and up.pdf">HCAM Men</a><a href="${STORAGE}/w?fileName=AM20260101-women-30 and up.pdf">HCAM Women</a>`,
  ),
}));
jest.mock('../../convex/scrapers/lib/http', () => ({
  ...jest.requireActual('../../convex/scrapers/lib/http'),
  // The PDF's bytes are its URL, so the mocked `pdfLines` can tell the genders apart.
  fetchBytes: jest.fn(async (url: string) => new TextEncoder().encode(url)),
}));
jest.mock('../../convex/scrapers/lib/pdf', () => ({ pdfLines: (bytes: Uint8Array) => mockPdfLines(bytes) }));

const PAGES = {
  men: [['HOWARD COHEN AMERICAN MASTERS RECORDS - MEN', 'AGE GROUP: 30 - 34', 'SNATCH', '110 Nathaniel GRESBACH 77.0 12/14/25 Louisville, KY']],
  women: [['HOWARD COHEN AMERICAN MASTERS RECORDS - WOMEN', 'AGE GROUP: 30 - 34', 'TOTAL', '53 Cadie BERGAN 81.0 12/14/25 Louisville, KY']],
};
function pdfs(women: string[][] = PAGES.women) {
  mockPdfLines.mockImplementation(async (bytes) => (new TextDecoder().decode(bytes).includes('-women') ? women : PAGES.men));
}

/** The mutations: a prune (it has a `recordType`) refuses without `allowShrink` when `refuse` is set. */
function mutations(refuse = false) {
  return jest.fn(async (_ref: unknown, args: Record<string, unknown>) => {
    if ('recordType' in args) {
      if (refuse && !args.allowShrink) throw new Error('refusing to delete every stored USAMW_HCAM record class of Masters 30 Women');
      return { deleted: [] };
    }
    return (args.rows as unknown[]).map(() => ({ wasInsert: true, wasChanged: true }));
  });
}
const calls = (runMutation: ReturnType<typeof mutations>) =>
  runMutation.mock.calls.map(([, args]) => ('recordType' in args ? `prune${args.dryRun ? ' (dry run)' : ''}` : 'upsert'));

type Result = { inserted: number; deleted: string[] };

describe('HCAM records run', () => {
  it('upserts both genders as USAMW_HCAM, checking the prune before writing', async () => {
    pdfs();
    const runMutation = mutations();
    const result = await handlerOf<Record<string, never>, Result>(run)({ runMutation }, {});
    expect(result.inserted).toBe(2);
    expect(calls(runMutation)).toEqual(['prune (dry run)', 'upsert', 'prune']);
    const [, prune] = runMutation.mock.calls[0];
    expect(prune).toMatchObject({
      recordType: 'USAMW_HCAM',
      keep: [
        { ageCategory: 'Masters 30', gender: 'Men', weightClass: '110kg' },
        { ageCategory: 'Masters 30', gender: 'Women', weightClass: '53kg' },
      ],
    });
    const [, upsert] = runMutation.mock.calls[1];
    expect(upsert.rows).toMatchObject([
      { recordType: 'USAMW_HCAM', gender: 'Men', snatchRecord: 77, cjRecord: undefined },
      { recordType: 'USAMW_HCAM', gender: 'Women', totalRecord: 81 },
    ]);
  });

  it('writes nothing when a PDF yields no records', async () => {
    pdfs([['HOWARD COHEN AMERICAN MASTERS RECORDS - WOMEN', 'AGE GROUP: 30 - 34', 'SNATCH', '53', '58']]);
    const runMutation = mutations();
    await expect(handlerOf<Record<string, never>, Result>(run)({ runMutation }, {})).rejects.toThrow("parsed 0 women's records");
    expect(runMutation).not.toHaveBeenCalled();
  });

  it('previews without writing on a dry run, and passes allowShrink to both guards', async () => {
    pdfs();
    const dry = mutations();
    const preview = await handlerOf<{ dryRun: boolean }, Result>(run)({ runMutation: dry }, { dryRun: true });
    expect(preview.inserted).toBe(0);
    expect(calls(dry)).toEqual(['prune (dry run)', 'prune (dry run)']);
    const override = mutations(true);
    await handlerOf<{ allowShrink: boolean }, Result>(run)({ runMutation: override }, { allowShrink: true });
    expect(calls(override)).toEqual(['prune (dry run)', 'upsert', 'prune']);
    expect(override.mock.calls.every(([, args]) => args.allowShrink === true)).toBe(true);
  });

  it("writes nothing when the men's PDF yields no records", async () => {
    pdfs();
    mockPdfLines.mockImplementation(async (bytes) => (new TextDecoder().decode(bytes).includes('-women') ? PAGES.women : [['HOWARD COHEN AMERICAN MASTERS RECORDS - MEN']]));
    const runMutation = mutations();
    await expect(handlerOf<Record<string, never>, Result>(run)({ runMutation }, {})).rejects.toThrow("parsed 0 men's records");
    expect(runMutation).not.toHaveBeenCalled();
  });

  it('writes nothing when the prune would refuse', async () => {
    pdfs();
    const runMutation = mutations(true);
    await expect(handlerOf<Record<string, never>, Result>(run)({ runMutation }, {})).rejects.toThrow('refusing to delete every stored');
    expect(calls(runMutation)).toEqual(['prune (dry run)']);
  });
});
