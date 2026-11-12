import { isRecord, itemAt } from './json';
import { normalizeGender } from './normalize';
import { compareCollated } from './sort';
import { apiError } from './validation';

export type ReferenceFilter = { ageCategory?: string; gender?: string };

export type FilterableRow = Record<string, unknown> & { age_category: string; gender: string };

export const isFilterableRow = (item: unknown): item is FilterableRow =>
  isRecord(item) && typeof item.age_category === 'string' && typeof item.gender === 'string';

export const foldedFilter = (value: string) => value.trim().toLowerCase();

export function sameFilterValue(stored: string, wanted: string): boolean {
  return foldedFilter(stored) === foldedFilter(wanted);
}

export function requireFilterValues(filters: Record<string, string | undefined>): void {
  for (const [field, value] of Object.entries(filters)) {
    if (value !== undefined && value.trim() === '') throw apiError(400, `${field} must not be blank`);
  }
}

export function narrowedByAgeAndGender<T extends { age_category: string; gender: string }>(rows: readonly T[], filter: ReferenceFilter): T[] {
  const gender = filter.gender === undefined ? undefined : normalizeGender(filter.gender);
  const ageCategory = filter.ageCategory;
  return rows.filter(
    (row) => (ageCategory === undefined || sameFilterValue(row.age_category, ageCategory)) && (gender === undefined || normalizeGender(row.gender) === gender),
  );
}

export function groupedByFoldedValue<T>(rows: readonly T[], valueOf: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = foldedFilter(valueOf(row));
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

export type RecordCategory = { record_type: string; gender: string; age_category: string };
export type QualifyingTotalCategory = { event_name: string; gender: string; age_category: string };

function distinctInOrder<T>(items: readonly T[], fieldsOf: (item: T) => readonly string[]): T[] {
  const seen = new Map<string, T>();
  for (const item of items) {
    const id = JSON.stringify(fieldsOf(item));
    if (!seen.has(id)) seen.set(id, item);
  }
  return [...seen.values()].sort((a, b) => {
    const right = fieldsOf(b);
    for (const [i, field] of fieldsOf(a).entries()) {
      const order = compareCollated(field, itemAt(right, i));
      if (order !== 0) return order;
    }
    return 0;
  });
}

export function recordCategories(rows: readonly RecordCategory[]): RecordCategory[] {
  return distinctInOrder(
    rows.map(({ record_type, gender, age_category }) => ({ record_type, gender, age_category })),
    (row) => [row.record_type, row.gender, row.age_category],
  );
}

export function qualifyingTotalCategories(rows: readonly QualifyingTotalCategory[]): QualifyingTotalCategory[] {
  return distinctInOrder(
    rows.map(({ event_name, gender, age_category }) => ({ event_name, gender, age_category })),
    (row) => [row.event_name, row.gender, row.age_category],
  );
}
