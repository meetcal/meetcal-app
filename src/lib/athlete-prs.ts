import { SupabaseLiftResult } from "@/types/athlete-results";

export type PRIndexes = {
  snatch: number;
  cj: number;
  total: number;
};

/**
 * For each lift (snatch_best / cj_best / total), find the index of the meet
 * where the athlete's PR was set.
 *
 * Rules (kept identical to the original athlete-results screen logic):
 * - The highest positive value wins.
 * - On ties (same value at multiple meets) the EARLIEST date wins — matching a
 *   best again later isn't a new PR.
 * - Rows with unparseable dates are treated as infinitely late, so they lose
 *   ties to any row with a parseable date.
 * - Values that are non-numeric or <= 0 never win.
 * - Returns -1 for a lift with no positive values.
 */
export function findPRIndexes(results: SupabaseLiftResult[]): PRIndexes {
  const findPRIndex = (
    getValue: (result: SupabaseLiftResult) => number | null,
  ): number => {
    let best = 0;
    let prIndex = -1;
    let prTime = Infinity;
    results.forEach((result, index) => {
      const value = getValue(result);
      if (typeof value !== "number" || value <= 0 || value < best) return;
      const parsed = new Date(result.date).getTime();
      const time = Number.isNaN(parsed) ? Infinity : parsed;
      if (value > best || time < prTime) {
        best = value;
        prIndex = index;
        prTime = time;
      }
    });
    return prIndex;
  };
  return {
    snatch: findPRIndex((r) => r.snatch_best),
    cj: findPRIndex((r) => r.cj_best),
    total: findPRIndex((r) => r.total),
  };
}
