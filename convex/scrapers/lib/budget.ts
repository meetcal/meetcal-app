
export const RUN_BUDGET_MS = 7 * 60 * 1000;

export const NOT_REACHED = "not reached: the run's time budget was spent on earlier sources (run it alone with `only`, or wait for the next run)";

export type RunBudget = {
  spent: (share?: number) => boolean;
};

export function runBudget(budgetMs: number = RUN_BUDGET_MS, now: () => number = Date.now): RunBudget {
  const started = now();
  return { spent: (share = 1) => now() - started >= budgetMs * share };
}
