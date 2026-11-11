import { NOT_REACHED, RUN_BUDGET_MS, runBudget } from '../../convex/scrapers/lib/budget';

describe('a multi-source job\'s time budget (#574)', () => {
  it('is spent once its time has passed, and a share of it sooner', () => {
    let now = 1_000;
    const budget = runBudget(600, () => now);
    expect(budget.spent()).toBe(false);
    expect(budget.spent(0.5)).toBe(false);
    now += 300;
    expect(budget.spent(0.5)).toBe(true);
    expect(budget.spent()).toBe(false);
    now += 300;
    expect(budget.spent()).toBe(true);
  });

  it('ends well before Convex stops the action at 10 minutes', () => {
    expect(RUN_BUDGET_MS).toBeLessThanOrEqual(8 * 60 * 1000);
  });

  it('names an unreached source the same way every run, so it is one failing source, not a new one each night', () => {
    expect(NOT_REACHED).toBe(NOT_REACHED.replace(/\d/g, ''));
  });
});
