import { itemAt } from './json';
import { plausible } from './leaderboard';
import type { ApiLiftingResult } from './results';
import { compareBytes } from './sort';

export type ByLift<T> = { snatch: T; cj: T; total: T };

export type PrMarks = {
  set: ByLift<number[]>;
  current: ByLift<number | null>;
};

const LIFT_FIELDS = [
  ['snatch', 'snatch_best'],
  ['cj', 'cj_best'],
  ['total', 'total'],
] as const;

function oldestFirst(rows: readonly ApiLiftingResult[]): number[] {
  return rows
    .map((_, index) => index)
    .sort((a, b) => {
      const rowA = itemAt(rows, a);
      const rowB = itemAt(rows, b);
      return compareBytes(rowA.date, rowB.date) || compareBytes(rowA.meet, rowB.meet) || b - a;
    });
}

export function prMarks(rows: readonly ApiLiftingResult[]): PrMarks {
  const set: ByLift<number[]> = { snatch: [], cj: [], total: [] };
  const current: ByLift<number | null> = { snatch: null, cj: null, total: null };
  const heaviest: ByLift<number> = { snatch: 0, cj: 0, total: 0 };
  let marksSet = false;
  for (const index of oldestFirst(rows)) {
    const row = itemAt(rows, index);
    if (!plausible(row)) continue;
    for (const [lift, field] of LIFT_FIELDS) {
      if (row[field] <= heaviest[lift]) continue;
      if (marksSet) set[lift].push(index);
      heaviest[lift] = row[field];
      current[lift] = index;
    }
    marksSet = true;
  }
  return { set, current };
}
