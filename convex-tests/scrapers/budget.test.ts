import { HARD_STOP_MS, OUT_OF_TIME, RUN_BUDGET_MS, runBudget } from '../../convex/scrapers/lib/budget';

describe("a multi-source job's time budget (#574)", () => {
  afterEach(() => jest.useRealTimers());

  it('is spent once its time has passed, and a share of it sooner', () => {
    let now = 1_000;
    const budget = runBudget({ budgetMs: 600, now: () => now });
    expect(budget.spent()).toBe(false);
    expect(budget.spent(0.5)).toBe(false);
    now += 300;
    expect(budget.spent(0.5)).toBe(true);
    expect(budget.spent()).toBe(false);
    now += 300;
    expect(budget.spent()).toBe(true);
  });

  it('stops starting sources, then stops waiting for one, before Convex stops the action at 10 minutes', () => {
    expect(RUN_BUDGET_MS).toBeLessThan(HARD_STOP_MS);
    expect(HARD_STOP_MS).toBeLessThan(10 * 60 * 1000);
  });

  it('gives a source its answer when it finishes before the hard stop', async () => {
    await expect(runBudget().orStop(Promise.resolve('read'))).resolves.toBe('read');
    await expect(runBudget().orStop(Promise.reject(new Error('GET failed with 503')))).rejects.toThrow('GET failed with 503');
  });

  it('stops waiting for a source still running at the hard stop', async () => {
    jest.useFakeTimers();
    const neverAnswers = new Promise<string>(() => {});
    const waited = runBudget({ hardStopMs: 1_000 }).orStop(neverAnswers);
    const outcome = waited.then(() => 'answered', (error: Error) => error.message);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(await outcome).toBe(OUT_OF_TIME);
  });

  it('stops at once for a source started after the hard stop', async () => {
    let now = 0;
    const budget = runBudget({ hardStopMs: 1_000, now: () => now });
    now = 5_000;
    await expect(budget.orStop(new Promise<string>(() => {}))).rejects.toThrow(OUT_OF_TIME);
  });
});
