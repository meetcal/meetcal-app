export const DOCUMENTS_ONE_QUERY_MAY_READ = 32000;
export const DOCUMENTS_BEFORE_THE_OVERFLOW_PROBE = DOCUMENTS_ONE_QUERY_MAY_READ - 1;

export type DocumentBudget = { left: number };

export async function takeWithinBudget<T>(budget: DocumentBudget, take: (limit: number) => Promise<T[]>): Promise<T[] | null> {
  const rows = await take(budget.left + 1);
  if (rows.length > budget.left) return null;
  budget.left -= rows.length;
  return rows;
}
