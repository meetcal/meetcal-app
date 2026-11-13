import type { QueryCtx } from '../_generated/server';
import { readHistories } from './history';
import { normalizeName } from './names';

export type LifterKey = string;

export type SoleLifters = ReadonlyMap<string, string>;

export const NO_SOLE_LIFTERS: SoleLifters = new Map();

export const lifterKeyOf = (lifterId: string): LifterKey => `lifter:${lifterId}`;

export const unlinkedKeyOf = (nameKey: string): LifterKey => `name:${nameKey}`;

export const isUnlinkedKey = (key: LifterKey): boolean => key.startsWith('name:');

export function countedKey(lifterId: string | undefined, nameKey: string, sole: SoleLifters): LifterKey {
  if (lifterId) return lifterKeyOf(lifterId);
  const only = sole.get(nameKey);
  return only === undefined ? unlinkedKeyOf(nameKey) : lifterKeyOf(only);
}

export const countedRowKey = (row: { name: string; lifter_id?: string }, sole: SoleLifters): LifterKey =>
  countedKey(row.lifter_id, normalizeName(row.name), sole);

export function soleLifter(history: Iterable<{ lifter_id?: string }>): string | null {
  const ids = new Set<string>();
  for (const row of history) if (row.lifter_id) ids.add(row.lifter_id);
  const [only, ...others] = ids;
  return only !== undefined && others.length === 0 ? only : null;
}

export function soleLiftersAmong(rows: Iterable<{ name: string; lifter_id?: string }>): Map<string, string> {
  const byName = new Map<string, { lifter_id?: string }[]>();
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

export const apiRowOf = (row: { name: string; lifterId?: string }) =>
  row.lifterId === undefined ? { name: row.name } : { name: row.name, lifter_id: row.lifterId };

export async function soleLiftersOf(ctx: QueryCtx, nameKeys: Iterable<string>): Promise<Map<string, string>> {
  const wanted = [...new Set(nameKeys)];
  if (wanted.length === 0) return new Map();
  const histories = await readHistories(ctx, wanted);
  const sole = new Map<string, string>();
  for (const [nameKey, history] of histories) {
    const only = soleLifter(history);
    if (only !== null) sole.set(nameKey, only);
  }
  return sole;
}

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

export const unlinkedNameKeys = (rows: Iterable<{ name: string; lifter_id?: string }>): string[] => {
  const keys = new Set<string>();
  for (const row of rows) if (!row.lifter_id) keys.add(normalizeName(row.name));
  return [...keys];
};
