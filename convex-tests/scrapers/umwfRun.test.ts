import { run } from '../../convex/scrapers/umwf';
import { describeFailure } from '../../convex/lib/cronAlerts';
import { handlerOf } from '../fakeDb';

jest.mock('../../convex/scrapers/lib/http', () => ({
  ...jest.requireActual('../../convex/scrapers/lib/http'),
  fetchText: jest.fn(async (url: string) => {
    if (url === 'tab-55') throw new Error('fetch failed with 500');
    return [
      ',94 kg Category,Weight,Name,Year Born,Nation,Date,Where,Age',
      ',Total,250,"DOE, John",1971,USA,13-June-2025,Singapore,54',
      ',98 kg Category (retired after Singapore World Cup),Weight,Name,Year Born,Nation,Date,Where,Age',
      ',Total,202,"SCHULTZ, Anthony",1971,AUS,13-June-2025,Singapore,54',
    ].join('\n');
  }),
}));
jest.mock('../../convex/scrapers/parse/umwf', () => ({
  ...jest.requireActual('../../convex/scrapers/parse/umwf'),
  MEN_SHEETS: [
    ['Masters 50', '50'],
    ['Masters 55', '55'],
  ],
  WOMEN_SHEETS: [],
  sheetCsvUrl: (_base: string, gid: string) => `tab-${gid}`,
}));

function mutations(refuse = false) {
  return jest.fn(async (_ref: unknown, args: Record<string, unknown>) => {
    if ('recordType' in args) {
      if (refuse && !args.allowShrink) throw new Error('refusing to delete every stored UMWF record class of Masters 50 Men');
      return { deleted: args.dryRun ? [] : ['Masters 50 Men 98kg'] };
    }
    return (args.rows as unknown[]).map(() => ({ wasInsert: false, wasChanged: false }));
  });
}

describe('UMWF run (#414, #255)', () => {
  it('prunes only the tabs it read, leaves out the retired class, and still fails naming the tab it could not read', async () => {
    const runMutation = mutations();
    const failure = await handlerOf<Record<string, never>>(run)({ runMutation }, {}).catch((error: unknown) => error);
    expect(describeFailure(failure).failedSources).toEqual(['men Masters 55']);
    const prune = runMutation.mock.calls.map(([, args]) => args).find((args) => 'recordType' in args && !args.dryRun);
    expect(prune).toMatchObject({
      recordType: 'UMWF',
      groups: [{ ageCategory: 'Masters 50', gender: 'men' }],
      keep: [{ ageCategory: 'Masters 50', gender: 'men', weightClass: '94kg' }],
    });
  });

  it('keeps the failed tabs in the alert when the prune refuses, and writes nothing', async () => {
    const runMutation = mutations(true);
    const failure = await handlerOf<Record<string, never>>(run)({ runMutation }, {}).catch((error: unknown) => error);
    expect(describeFailure(failure).failedSources).toEqual(['men Masters 55', 'sync']);
    expect(runMutation.mock.calls.every(([, args]) => 'recordType' in args && args.dryRun)).toBe(true);
  });
});
