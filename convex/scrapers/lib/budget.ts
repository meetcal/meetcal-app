export const RUN_BUDGET_MS = 7 * 60 * 1000;
export const HARD_STOP_MS = 9 * 60 * 1000;

export const NOT_REACHED = "not reached: the run's time budget was spent on earlier sources (run it alone with `only`)";
export const OUT_OF_TIME = 'stopped: still running when the run had to end (run it alone with `only`)';

export type RunBudget = {
  spent: (share?: number) => boolean;
  orStop: <T>(work: Promise<T>) => Promise<T>;
};

export function runBudget(
  { budgetMs = RUN_BUDGET_MS, hardStopMs = HARD_STOP_MS, now = Date.now }: { budgetMs?: number; hardStopMs?: number; now?: () => number } = {},
): RunBudget {
  const started = now();
  return {
    spent: (share = 1) => now() - started >= budgetMs * share,
    orStop: async <T>(work: Promise<T>): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stop = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(OUT_OF_TIME)), Math.max(0, hardStopMs - (now() - started)));
      });
      try {
        return await Promise.race([work, stop]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
