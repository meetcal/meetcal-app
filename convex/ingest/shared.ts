import { v } from 'convex/values';
import { type MutationCtx } from '../_generated/server';
import type { Id, TableNames } from '../_generated/dataModel';
import { classKey, normalizeAgeCategory, normalizeGender, storedGenderSpellings } from '../lib/normalize';
import { exceedsShrink } from '../lib/shrinkGuard';

/**
 * Per-row outcome of an upsert, as the Python writers reported it.
 * `storedAs`: the name a meet is stored under when it is not the one sent
 * (`upsertMeets`). `retitledFrom`: what the source called that stored meet
 * before it retitled it to the name sent.
 */
export type UpsertOutcome = { wasInsert: boolean; wasChanged: boolean; storedAs?: string; retitledFrom?: string };

/**
 * An index lookup run for every spelling a stored row of `gender` may still
 * hold (`storedGenderSpellings`), canonical first: until the gender
 * migrations have run, a row stored as `Male` is the `Men` row. The writers
 * below rewrite such a row's gender when they match it.
 */
export async function bySpellingOf<T>(gender: string, read: (spelling: string) => Promise<T[]>): Promise<T[]> {
  const rows: T[] = [];
  for (const spelling of storedGenderSpellings(gender)) rows.push(...(await read(spelling)));
  return rows;
}

export const groupKey = (r: { ageCategory: string; gender: string }) => JSON.stringify([normalizeAgeCategory(r.ageCategory), normalizeGender(r.gender)]);

export const classArg = v.object({ ageCategory: v.string(), gender: v.string(), weightClass: v.string() });

/**
 * The stored rows a source no longer lists, of `stored` (the rows in the
 * sync's scope). Without `allowShrink` it refuses to delete more than
 * `exceedsShrink` allows, or every class of an (age, gender) group: a
 * source that partly broke (an age group relabelled, a table the parser
 * stopped finding) looks the same as classes that went away, while a class
 * change keeps every group with classes.
 */
export function droppedClasses<T extends { ageCategory: string; gender: string; weightClass: string }>(
  what: string,
  stored: readonly T[],
  keep: readonly { ageCategory: string; gender: string; weightClass: string }[],
  allowShrink: boolean | undefined,
): T[] {
  if (!keep.length) throw new Error(`refusing to prune ${what} against an empty payload`);
  const kept = new Set(keep.map(classKey));
  const dropped = stored.filter((row) => !kept.has(classKey(row)));
  if (allowShrink) return dropped;
  const rerun = `If it really dropped them (a class change), check the source by hand and rerun its sync with '{"allowShrink":true}' (its '{"dryRun":true}' lists them)`;
  const keptGroups = new Set(keep.map(groupKey));
  const emptied = [...new Set(dropped.filter((row) => !keptGroups.has(groupKey(row))).map((row) => `${normalizeAgeCategory(row.ageCategory)} ${normalizeGender(row.gender)}`))];
  if (emptied.length) {
    throw new Error(`refusing to delete every stored ${what} class of ${emptied.join(', ')}: the source lists none (an age group it relabelled or the parser missed?). ${rerun}`);
  }
  if (exceedsShrink(dropped.length, stored.length)) {
    throw new Error(`refusing to delete ${dropped.length} of ${stored.length} stored ${what} classes the source no longer lists (the source may be partly broken). ${rerun}`);
  }
  return dropped;
}

export async function onePerKey<T extends { _id: Id<TableNames> }>(
  ctx: MutationCtx,
  rows: readonly T[],
  keyOf: (row: T) => string,
): Promise<{ byKey: Map<string, T>; deleted: number }> {
  const byKey = new Map<string, T>();
  let deleted = 0;
  for (const row of rows) {
    const key = keyOf(row);
    if (!byKey.has(key)) {
      byKey.set(key, row);
      continue;
    }
    await ctx.db.delete(row._id);
    deleted += 1;
  }
  return { byKey, deleted };
}
