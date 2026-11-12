export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function kindOf(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'missing';
  if (Array.isArray(value)) return 'a list';
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`;
}

export function rowCount(total: unknown): number | null {
  const count = typeof total === 'string' && /^\d+$/.test(total.trim()) ? Number(total) : total;
  return typeof count === 'number' && Number.isInteger(count) && count >= 0 ? count : null;
}
