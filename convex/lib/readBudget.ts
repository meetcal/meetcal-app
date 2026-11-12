import { itemAt } from './json';
export const DOCUMENTS_ONE_QUERY_MAY_READ = 32000;
export const DOCUMENTS_BEFORE_THE_OVERFLOW_PROBE = DOCUMENTS_ONE_QUERY_MAY_READ - 1;

export type DocumentBudget = { left: number };

export async function takeWithinBudget<T>(budget: DocumentBudget, take: (limit: number) => Promise<T[]>): Promise<T[] | null> {
  const rows = await take(budget.left + 1);
  if (rows.length > budget.left) return null;
  budget.left -= rows.length;
  return rows;
}

export function tooLargeToRead(meets: readonly string[]): string {
  const subject = meets.length === 1 ? `${JSON.stringify(itemAt(meets, 0))} is` : 'these meets are';
  return `${subject} too large to read in one request; try again later or report it.`;
}
