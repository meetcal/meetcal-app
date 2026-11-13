import { normalizeName } from './names';

export type LifterKey = string;

export type CountedRow = { lifter_id?: string; sole_lifter_id?: string };

const lifterKeyOf = (lifterId: string): LifterKey => `lifter:${lifterId}`;

const unlinkedKeyOf = (nameKey: string): LifterKey => `name:${nameKey}`;

export const countedLifterOf = (row: CountedRow): string | null => row.lifter_id ?? row.sole_lifter_id ?? null;

export const countedKey = (lifterId: string | null, nameKey: string): LifterKey => (lifterId === null ? unlinkedKeyOf(nameKey) : lifterKeyOf(lifterId));

export const countedRowKey = (row: CountedRow & { name: string }): LifterKey => countedKey(countedLifterOf(row), normalizeName(row.name));

export function soleLifter(history: Iterable<CountedRow>): string | null {
  const ids = new Set<string>();
  for (const row of history) {
    const lifter = countedLifterOf(row);
    if (lifter !== null) ids.add(lifter);
  }
  const [only, ...others] = ids;
  return only !== undefined && others.length === 0 ? only : null;
}

export function soleLiftersAmong(rows: Iterable<CountedRow & { name: string }>): Map<string, string> {
  const byName = new Map<string, CountedRow[]>();
  for (const row of rows) {
    const key = normalizeName(row.name);
    byName.set(key, [...(byName.get(key) ?? []), row]);
  }
  const sole = new Map<string, string>();
  for (const [nameKey, named] of byName) {
    const only = soleLifter(named);
    if (only !== null) sole.set(nameKey, only);
  }
  return sole;
}

export const apiRowOf = (row: { name: string; lifterId?: string; soleLifterId?: string }) => ({
  name: row.name,
  ...(row.lifterId === undefined ? {} : { lifter_id: row.lifterId }),
  ...(row.soleLifterId === undefined ? {} : { sole_lifter_id: row.soleLifterId }),
});

export const rosterPersonKey = (entry: { name: string; memberId?: string }): string =>
  entry.memberId ? `member:${entry.memberId}` : `name:${normalizeName(entry.name)}`;

export function entriesOfLifter<Entry>(
  entries: readonly Entry[],
  rowLifter: string | null,
  soleLifter: string | null,
  lifterOfEntry: (entry: Entry) => string | null,
  unlinkedByName: boolean,
): Entry[] {
  const unmatched = entries.filter((entry) => lifterOfEntry(entry) === null);
  if (rowLifter === null) return unmatched.length > 0 || !unlinkedByName ? unmatched : [...entries];
  const own = entries.filter((entry) => lifterOfEntry(entry) === rowLifter);
  if (own.length > 0) return own;
  return rowLifter === soleLifter ? unmatched : [];
}
