/**
 * Whether a stored result's numbers can be real. Sources make typos (`633`
 * for `63` in one attempt) and parsers can shift a column; such a row still
 * has a total, and ranked by it would come first above every real lifter
 * (#400). Rankings (and the USA Masters PDF loader) leave out a row this
 * finds a problem with.
 */

/** The numbers of a result, as stored (`lifting_results`); absent is not taken. */
export type ResultNumbers = {
  snatch1?: number | null;
  snatch2?: number | null;
  snatch3?: number | null;
  snatchBest?: number | null;
  cj1?: number | null;
  cj2?: number | null;
  cj3?: number | null;
  cjBest?: number | null;
  total?: number | null;
};

export type SourceErrorGuard = {
  ceiling: { snatch: number; cj: number; total: number };
  ceilingApplies: 'toEveryAttempt' | 'toTheBest';
  jumpRatio: number;
  jumpMinKg: number;
  total: 'isBothLiftsOrNone' | 'isTheSumWhenThereIsOne';
};

export const RESULT_CEILING = { snatch: 240, cj: 290, total: 520 } as const;
export const JUMP_RATIO = 1.5;
export const JUMP_MIN_KG = 20;

export const RANKINGS_GUARD: SourceErrorGuard = {
  ceiling: RESULT_CEILING,
  ceilingApplies: 'toEveryAttempt',
  jumpRatio: JUMP_RATIO,
  jumpMinKg: JUMP_MIN_KG,
  total: 'isBothLiftsOrNone',
};

export const LEADERBOARD_GUARD: SourceErrorGuard = {
  ceiling: { snatch: 230, cj: 275, total: 500 },
  ceilingApplies: 'toTheBest',
  jumpRatio: 1.5,
  jumpMinKg: 0,
  total: 'isTheSumWhenThereIsOne',
};

const TOTAL_TOLERANCE_KG = 0.5;

const num = (value: number | null | undefined): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

function liftProblems(label: string, attempts: readonly (number | null | undefined)[], best: number | undefined, ceiling: number, guard: SourceErrorGuard): string[] {
  const problems: string[] = [];
  const taken = attempts.map(num).filter((value): value is number => value !== undefined && value !== 0);
  const heaviest = guard.ceilingApplies === 'toEveryAttempt' ? Math.max(best ?? 0, ...taken.map(Math.abs)) : (best ?? 0);
  if (heaviest > ceiling) problems.push(`${label} ${heaviest} is over ${ceiling}`);
  taken.forEach((value, index) => {
    if (value <= 0) return;
    const others = taken.filter((_, other) => other !== index).map(Math.abs);
    if (others.length === 0) return;
    const next = Math.max(...others);
    if (value > next * guard.jumpRatio && value - next >= guard.jumpMinKg) problems.push(`${label} attempt ${value} against ${next} (a typo?)`);
  });
  return problems;
}

export function totalAddsUp(total: number, snatchBest: number, cjBest: number, rule: SourceErrorGuard['total']): boolean {
  if (rule === 'isTheSumWhenThereIsOne') return total <= 0 || Math.abs(total - (snatchBest + cjBest)) <= TOTAL_TOLERANCE_KG;
  const expected = snatchBest > 0 && cjBest > 0 ? snatchBest + cjBest : 0;
  return Math.abs(total - expected) <= TOTAL_TOLERANCE_KG;
}

export function resultProblems(row: ResultNumbers, guard: SourceErrorGuard = RANKINGS_GUARD): string[] {
  const snatchBest = num(row.snatchBest);
  const cjBest = num(row.cjBest);
  const total = num(row.total);
  const problems = [
    ...liftProblems('snatch', [row.snatch1, row.snatch2, row.snatch3], snatchBest, guard.ceiling.snatch, guard),
    ...liftProblems('clean & jerk', [row.cj1, row.cj2, row.cj3], cjBest, guard.ceiling.cj, guard),
  ];
  if (total !== undefined && total > guard.ceiling.total) problems.push(`total ${total} is over ${guard.ceiling.total}`);
  if (total !== undefined && snatchBest !== undefined && cjBest !== undefined && !totalAddsUp(total, snatchBest, cjBest, guard.total)) {
    problems.push(`total ${total} is not snatch ${snatchBest} + clean & jerk ${cjBest}`);
  }
  return problems;
}

export const isPlausibleResult = (row: ResultNumbers, guard: SourceErrorGuard = RANKINGS_GUARD): boolean => resultProblems(row, guard).length === 0;
