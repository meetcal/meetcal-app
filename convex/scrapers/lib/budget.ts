/**
 * A time budget for a job that reads many sources in one action. Convex stops
 * an action at 10 minutes, and a job stopped there records nothing: its
 * `cron_status` row stays `running`, the sources it had not reached are not
 * named, and the only alert is the watchdog's "did not finish". A job that
 * stops starting new sources once its budget is spent ends by itself and
 * fails naming them (`NOT_REACHED`), so the alert says what is stale.
 *
 * The budget bounds when the last source starts, not when it ends: it leaves
 * room for one slow source (a page of 60-second requests, retried) to finish.
 */

/** How long a multi-source job goes on starting sources. */
export const RUN_BUDGET_MS = 7 * 60 * 1000;

/** Why a source the budget did not reach failed: the same text every run, with the way to sync it alone. */
export const NOT_REACHED = "not reached: the run's time budget was spent on earlier sources (run it alone with `only`, or wait for the next run)";

export type RunBudget = {
  /** Whether `share` (0 to 1, default all) of the budget is spent: start no new source. */
  spent: (share?: number) => boolean;
};

/** A budget of `budgetMs` from now, on `now`'s clock. */
export function runBudget(budgetMs: number = RUN_BUDGET_MS, now: () => number = Date.now): RunBudget {
  const started = now();
  return { spent: (share = 1) => now() - started >= budgetMs * share };
}
