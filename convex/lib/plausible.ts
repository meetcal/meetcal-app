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

/**
 * A little over the senior world records (snatch 225, clean & jerk 267,
 * total 492 kg in 2026): no lift or total above these is real.
 */
export const RESULT_CEILING = { snatch: 240, cj: 290, total: 520 } as const;

/**
 * A made attempt this many times the athlete's heaviest other attempt in
 * the same lift, and at least JUMP_MIN_KG heavier, is a typo (`633` after
 * `63`), not a jump a lifter makes between attempts.
 */
export const JUMP_RATIO = 1.5;
export const JUMP_MIN_KG = 20;

/** A total may differ from snatch + clean & jerk by rounding, no more. */
const TOTAL_TOLERANCE_KG = 0.5;

const num = (value: number | null | undefined): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

function liftProblems(label: string, attempts: readonly (number | null | undefined)[], best: number | undefined, ceiling: number): string[] {
  const problems: string[] = [];
  const taken = attempts.map(num).filter((value): value is number => value !== undefined && value !== 0);
  const heaviest = Math.max(best ?? 0, ...taken.map(Math.abs));
  if (heaviest > ceiling) problems.push(`${label} ${heaviest} is over ${ceiling}`);
  taken.forEach((value, index) => {
    if (value <= 0) return;
    const others = taken.filter((_, other) => other !== index).map(Math.abs);
    if (others.length === 0) return;
    const next = Math.max(...others);
    if (value > next * JUMP_RATIO && value - next >= JUMP_MIN_KG) problems.push(`${label} attempt ${value} against ${next} (a typo?)`);
  });
  return problems;
}

/** What makes a result's numbers impossible; empty for a believable row. */
export function resultProblems(row: ResultNumbers): string[] {
  const snatchBest = num(row.snatchBest);
  const cjBest = num(row.cjBest);
  const total = num(row.total);
  const problems = [
    ...liftProblems('snatch', [row.snatch1, row.snatch2, row.snatch3], snatchBest, RESULT_CEILING.snatch),
    ...liftProblems('clean & jerk', [row.cj1, row.cj2, row.cj3], cjBest, RESULT_CEILING.cj),
  ];
  if (total !== undefined && total > RESULT_CEILING.total) problems.push(`total ${total} is over ${RESULT_CEILING.total}`);
  if (total !== undefined && snatchBest !== undefined && cjBest !== undefined) {
    // A bomb-out in either lift is no total.
    const expected = snatchBest > 0 && cjBest > 0 ? snatchBest + cjBest : 0;
    if (Math.abs(total - expected) > TOTAL_TOLERANCE_KG) problems.push(`total ${total} is not snatch ${snatchBest} + clean & jerk ${cjBest}`);
  }
  return problems;
}

export const isPlausibleResult = (row: ResultNumbers): boolean => resultProblems(row).length === 0;
