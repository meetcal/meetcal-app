import { blankRecord, setLift } from '../../convex/scrapers/parse/wso/common';
import { describeFailure } from '../../convex/lib/cronAlerts';
import { NOT_REACHED, OUT_OF_TIME, runBudget } from '../../convex/scrapers/lib/budget';
import { syncWsoSources, type WsoSource } from '../../convex/scrapers/wsoRecords';

const record = (wso: string) => {
  const senior = blankRecord(wso, 'Senior', 'Men', '94kg');
  setLift(senior, 'snatch', 100, undefined);
  setLift(senior, 'cj', 120, undefined);
  setLift(senior, 'total', 220, undefined);
  return senior;
};
const stored = () => {
  const wsos: string[] = [];
  return { wsos, store: async (wso: string) => (wsos.push(wso), { inserted: 1 }) };
};
const failure = (run: Promise<unknown>) => run.then(() => ({ error: '', failedSources: [] as string[], failures: [] as ReturnType<typeof describeFailure>['failures'] }), (error: unknown) => ({ failedSources: [], ...describeFailure(error) }));

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("the WSO records run's time budget (#574)", () => {
  it('stores the WSOs it reached and fails naming the ones it did not', async () => {
    let now = 0;
    const sources: WsoSource[] = ['Georgia', 'Florida', 'Ohio'].map((wso) => ({
      wso,
      scrape: async () => {
        now += 400;
        return [record(wso)];
      },
    }));
    const { wsos, store } = stored();
    const { error, failedSources, failures } = await failure(syncWsoSources(sources, { budget: runBudget({ budgetMs: 700, hardStopMs: 900, now: () => now }), dryRun: false, store }));
    expect(wsos).toEqual(['Georgia', 'Florida']);
    expect(failedSources).toEqual(['Ohio']);
    expect(error).toContain(`Ohio: ${NOT_REACHED}`);
    expect(failures).toEqual([{ source: 'Ohio', error: NOT_REACHED, notReached: true }]);
  });

  it('stops waiting for a WSO still reading at the hard stop and stores nothing for it', async () => {
    jest.useFakeTimers();
    const sources: WsoSource[] = [
      { wso: 'Georgia', scrape: () => new Promise(() => {}) },
      { wso: 'Florida', scrape: async () => [record('Florida')] },
    ];
    const { wsos, store } = stored();
    const run = failure(syncWsoSources(sources, { budget: runBudget({ budgetMs: 700, hardStopMs: 900 }), dryRun: false, store }));
    await jest.advanceTimersByTimeAsync(900);
    const { error } = await run;
    expect(error).toContain(`Georgia: ${OUT_OF_TIME}`);
    expect(error).toContain(`Florida: ${NOT_REACHED}`);
    expect(wsos).toEqual([]);
  });

  it('reports unreached WSOs without failing a dry run, and stores nothing', async () => {
    let now = 0;
    const sources: WsoSource[] = ['Georgia', 'Florida'].map((wso) => ({ wso, scrape: async () => ((now += 800), [record(wso)]) }));
    const { wsos, store } = stored();
    const results = await syncWsoSources(sources, { budget: runBudget({ budgetMs: 700, hardStopMs: 900, now: () => now }), dryRun: true, store });
    expect(results.map((result) => result.error)).toEqual([undefined, NOT_REACHED]);
    expect(wsos).toEqual([]);
  });
});
