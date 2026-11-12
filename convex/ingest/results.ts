import { itemAt } from '../lib/json';
import { EVENT_RESULTS_MAX, readAll } from '../lib/boundedRead';
import { v } from 'convex/values';
import { internalMutation, type MutationCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { writeHistories } from '../lib/history';
import { normalizeFederation } from '../lib/normalize';
import { DAY_MS } from '../lib/dates';
import { normalizeName } from '../lib/names';
import { clearedColumns, exceedsShrink, RESULT_COLUMNS } from '../lib/shrinkGuard';
import { liftingResultsFields } from '../schema';
import { type WriteHint, recordWrite } from './hints';

type ResultFields = Pick<Doc<'lifting_results'>, 'federation' | 'age' | 'meet' | 'name' | 'adaptive' | 'date'>;

/** Everything a result row feeds: its ranking class, meet, athlete, name. */
export function resultHints(row: ResultFields): WriteHint[] {
  const hints: WriteHint[] = [
    { kind: 'meet', key: row.meet },
    { kind: 'athlete', key: normalizeName(row.name), since: row.date },
    { kind: 'name', key: row.name },
  ];
  if (row.federation !== undefined && row.age !== undefined) {
    hints.push({ kind: 'nat', key: JSON.stringify([row.federation, row.age]) });
  }
  if (row.adaptive) hints.push({ kind: 'adaptive', key: '1' });
  return hints;
}

/** The athletes a batch of result hints touched; their histories are rewritten in the same transaction. */
export function athleteKeys(hints: WriteHint[]): string[] {
  return hints.filter((h) => h.kind === 'athlete').map((h) => h.key);
}

const liftingResult = v.object(liftingResultsFields);

/**
 * A result row's identity within its event: the meet, the athlete's folded
 * name (`normalizeName`, so "John  Smith" and "john smith" are one athlete,
 * as their history is) and the age category (a lifter entered in Masters and
 * Open at one meet has a result in each). The one definition every result
 * writer matches on: the upsert, the delete and the Sport80 prune. Computed
 * from the name, never from a stored `nameKey`, so a row keyed by an older
 * rule still matches.
 */
export type ResultIdentity = { meet: string; name: string; age?: string | null };

export const resultKey = (row: ResultIdentity) => JSON.stringify([row.meet, normalizeName(row.name), row.age ?? null]);

/** The values of a result: the body weight, every attempt, the bests and the total. */
type ResultValues = Pick<Doc<'lifting_results'>, (typeof RESULT_COLUMNS)[number]>;

/** Whether two results hold the same values (absent and `undefined` are the same). */
export const sameResultValues = (a: ResultValues, b: ResultValues) => RESULT_COLUMNS.every((field) => a[field] === b[field]);

/**
 * How far apart two results' dates may be and still be one edition of a
 * meet: rows of one edition are days apart at most (a multi-day meet, a
 * re-sync that restamped the date), editions a year.
 */
export const SAME_EDITION_DAYS = 180;

/** Whether two `YYYY-MM-DD` result dates are of one edition of a meet; an unreadable date matches only itself. */
export function sameEditionDates(a: string, b: string): boolean {
  if (a === b) return true;
  const days = Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS;
  return days <= SAME_EDITION_DAYS;
}

/**
 * Of the stored rows under an incoming row's identity (`resultKey`), the
 * ones that are that result: those dated within SAME_EDITION_DAYS of it.
 * The pre-Convex import stored some meets' editions under one event id
 * (event 4598 holds the 2020 and the 2021 Dallas Weightlifting
 * Championships, #369), so the identity alone can name another edition's
 * real result, which is neither updated nor deleted. Not even one holding
 * the same values: two editions can, so a copy stored under a wrong date
 * (#402) stays a duplicate rather than risk deleting a real result.
 */
export function sameEditionRows(stored: readonly Doc<'lifting_results'>[], incoming: { date: string }): Doc<'lifting_results'>[] {
  return stored.filter((row) => sameEditionDates(row.date, incoming.date));
}

/** One event's stored results by `resultKey`, oldest first within a key; read once per mutation. */
export async function eventResultsByKey(ctx: MutationCtx, eventId: string): Promise<Map<string, Doc<'lifting_results'>[]>> {
  const byKey = new Map<string, Doc<'lifting_results'>[]>();
  const rows = await readAll(
    ctx.db
      .query('lifting_results')
      .withIndex('by_event_and_name', (q) => q.eq('eventId', eventId)),
    EVENT_RESULTS_MAX,
    'results of one event',
  );
  for (const row of rows.sort((a, b) => a._creationTime - b._creationTime)) {
    const key = resultKey(row);
    const list = byKey.get(key);
    if (list) list.push(row);
    else byKey.set(key, [row]);
  }
  return byKey;
}

/**
 * Of several stored rows under one identity (written before names were
 * matched folded), the one an incoming row updates: the same exact name if
 * there is one, else the oldest.
 */
function pickStored(rows: readonly Doc<'lifting_results'>[], name: string): Doc<'lifting_results'> {
  return rows.find((row) => row.name === name) ?? itemAt(rows, 0);
}

/**
 * Inserts or updates results, matched on (eventId, `resultKey`) among the
 * stored rows of the same edition (`sameEditionRows`). `nameKey`
 * is derived here, never taken from the caller, and the federation is
 * normalized (`normalize_federation`). A row whose values are unchanged is
 * not written, so re-syncing an unchanged meet bumps no version and
 * invalidates no view. Stored copies of a row beyond the one it updates
 * (the same athlete stored under two spellings) are deleted. Without
 * `allowShrink`, a batch that empties a column (a lift, the total, the body
 * weight) on many of the stored rows it updates is refused, nothing written:
 * that is a column the source renamed, not a set of corrections.
 */
export const upsertLiftingResults = internalMutation({
  args: { rows: v.array(liftingResult), allowShrink: v.optional(v.boolean()) },
  handler: async (ctx, { rows, allowShrink }) => {
    const events = new Map<string, Map<string, Doc<'lifting_results'>[]>>();
    const storedUnder = async (row: (typeof rows)[number]) => {
      let byKey = events.get(row.eventId);
      if (!byKey) {
        byKey = await eventResultsByKey(ctx, row.eventId);
        events.set(row.eventId, byKey);
      }
      const key = resultKey(row);
      // This result's stored rows: another edition's under its identity are left alone.
      return { byKey, key, matches: sameEditionRows(byKey.get(key) ?? [], row) };
    };
    if (!allowShrink) {
      const updates = [];
      for (const row of rows) {
        const { matches } = await storedUnder(row);
        if (matches.length) updates.push({ stored: pickStored(matches, row.name), next: row });
      }
      const emptied = clearedColumns(updates);
      if (emptied.length) {
        throw new Error(
          `refusing to clear ${emptied.join(', ')} on most of ${updates.length} stored results (a source column renamed?). ` +
            `If the source really cleared them, rerun its sync with '{"allowShrink":true}'`,
        );
      }
    }
    const hints: WriteHint[] = [];
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    let duplicates = 0;
    for (const row of rows) {
      const { legacyId: _legacy, nameKey: _key, ...fields } = row;
      const doc = {
        ...fields,
        federation: fields.federation === undefined ? undefined : normalizeFederation(fields.federation),
        nameKey: normalizeName(row.name),
      };
      // The map follows this batch's writes, so a row repeated in the
      // batch updates the first one's document.
      const { byKey, key, matches } = await storedUnder(row);
      const otherEditions = (byKey.get(key) ?? []).filter((stored) => !matches.includes(stored));
      if (matches.length === 0) {
        const _id = await ctx.db.insert('lifting_results', doc);
        byKey.set(key, [...otherEditions, { ...doc, _id, _creationTime: Date.now() }]);
        inserted += 1;
        hints.push(...resultHints(doc));
        continue;
      }
      const existing = pickStored(matches, row.name);
      for (const copy of matches) {
        if (copy === existing) continue;
        hints.push(...resultHints(copy));
        await ctx.db.delete(copy._id);
        duplicates += 1;
      }
      // The pre-Convex serial is the row's identity, not a value the scrapers
      // send: kept, and left out of the comparison.
      const { _id, _creationTime, legacyId, ...current } = existing;
      byKey.set(key, [...otherEditions, { ...doc, legacyId, _id, _creationTime }]);
      if (sameValues(current, doc)) {
        unchanged += 1;
        continue;
      }
      hints.push(...resultHints(existing));
      await ctx.db.replace(_id, { ...doc, legacyId });
      updated += 1;
      hints.push(...resultHints(doc));
    }
    if (hints.length > 0) {
      await writeHistories(ctx, athleteKeys(hints));
      await recordWrite(ctx, 'lifting_results', hints);
    }
    return { inserted, updated, unchanged, duplicates };
  },
});

/** Field-by-field equality of two documents' values (absent and `undefined` are the same). */
function sameValues(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] === undefined && b[key] === undefined) continue;
    if (a[key] !== b[key]) return false;
  }
  return true;
}

/**
 * Deletes result rows, rewriting their athletes' histories and leaving the
 * hints that update views and search, like every result write.
 */
export async function deleteResultRows(ctx: MutationCtx, rows: readonly Doc<'lifting_results'>[]): Promise<number> {
  const hints: WriteHint[] = [];
  for (const row of rows) {
    hints.push(...resultHints(row));
    await ctx.db.delete(row._id);
  }
  if (rows.length > 0) {
    await writeHistories(ctx, athleteKeys(hints));
    await recordWrite(ctx, 'lifting_results', hints);
  }
  return rows.length;
}

/**
 * Deletes results by the identity `upsertLiftingResults` writes them under
 * (eventId, `resultKey`): every stored spelling of the name, in every year
 * the event id holds (a person names the rows to delete). A key without
 * `age` deletes the athlete's rows in every age category of that meet; `age:
 * null` only a row stored without one.
 */
export const deleteLiftingResults = internalMutation({
  args: {
    keys: v.array(v.object({ eventId: v.string(), meet: v.string(), name: v.string(), age: v.optional(v.union(v.string(), v.null())) })),
  },
  handler: async (ctx, { keys }) => {
    const events = new Map<string, Map<string, Doc<'lifting_results'>[]>>();
    const rows = new Map<string, Doc<'lifting_results'>>();
    for (const key of keys) {
      let byKey = events.get(key.eventId);
      if (!byKey) {
        byKey = await eventResultsByKey(ctx, key.eventId);
        events.set(key.eventId, byKey);
      }
      const matches =
        key.age === undefined
          ? [...byKey.values()].flat().filter((row) => resultKey({ ...row, age: null }) === resultKey({ ...key, age: null }))
          : (byKey.get(resultKey(key)) ?? []);
      for (const row of matches) rows.set(row._id, row);
    }
    return { deleted: await deleteResultRows(ctx, [...rows.values()]) };
  },
});

/**
 * An event may lose at most this share of its stored results (and always
 * this many) in one prune without `allowShrink`: a corrected name or a
 * withdrawn result is a row or two, not a fifth of a meet.
 */
const RESULT_PRUNE_LIMIT = { share: 0.1, min: 5 };

/**
 * Rows one prune call deletes at most: each deletion rewrites its athlete's
 * history, as a batch of upserts does (`INGEST_BATCH` in the Sport80 sync),
 * so a retitled meet is pruned over several calls.
 */
export const RESULT_PRUNE_BATCH = 200;

/**
 * After a complete payload of an event's results was upserted: deletes the
 * event's stored rows that payload no longer has (a name Sport80 corrected,
 * a result withdrawn, rows under the meet's old title), through the same
 * path as every result write, so histories, summaries, views and search
 * follow. `keep` is the payload's rows, matched on the upsert's identity
 * (`resultKey`: meet, folded name, age category; `age` is required, so a
 * caller cannot leave it out and have every row with one deleted). Only
 * stored rows dated within SAME_EDITION_DAYS of the payload's are judged: a
 * row of another edition under the event id (#369) is not one this payload
 * dropped. A row
 * whose athlete is still in the payload under another meet title or age
 * category was only retitled; the rest count against RESULT_PRUNE_LIMIT,
 * past which nothing is deleted unless `allowShrink`. Deletes at most
 * RESULT_PRUNE_BATCH rows, dropped ones first (so a later call's guard sees
 * no larger share), and returns how many stale rows remain for the next call.
 */
export const pruneEventResults = internalMutation({
  args: {
    eventId: v.string(),
    keep: v.array(v.object({ meet: v.string(), name: v.string(), age: v.union(v.string(), v.null()), date: v.string() })),
    allowShrink: v.optional(v.boolean()),
  },
  handler: async (ctx, { eventId, keep, allowShrink }) => {
    if (!eventId) throw new Error('eventId is required');
    if (keep.length === 0) throw new Error(`refusing to prune event ${eventId}'s results against an empty payload`);
    const kept = new Set(keep.map(resultKey));
    const names = new Set(keep.map((row) => normalizeName(row.name)));
    const dates = [...new Set(keep.map((row) => row.date))];
    // Only rows the Sport80 sync writes (USAW, not adaptive) of this
    // edition: an imported row of another source, or of another edition, under
    // the same event id is not its to delete.
    const stored = (
      await readAll(
        ctx.db
          .query('lifting_results')
          .withIndex('by_event_and_name', (q) => q.eq('eventId', eventId)),
        EVENT_RESULTS_MAX,
        'results of one event',
      )
    ).filter((row) => row.federation === 'USAW' && !row.adaptive && dates.some((date) => sameEditionDates(row.date, date)));
    const stale = stored.filter((row) => !kept.has(resultKey(row)));
    const dropped = stale.filter((row) => !names.has(normalizeName(row.name)));
    const retitled = stale.filter((row) => names.has(normalizeName(row.name)));
    // Judged against the event's rows less the retitled copies, which are
    // its athletes counted twice.
    if (!allowShrink && exceedsShrink(dropped.length, stored.length - retitled.length, RESULT_PRUNE_LIMIT)) {
      throw new Error(
        `refusing to delete ${dropped.length} of event ${eventId}'s ${stored.length - retitled.length} stored results no longer in its Sport80 table ` +
          `(${dropped.slice(0, 10).map((row) => row.name).join(', ')}${dropped.length > 10 ? ', …' : ''}). ` +
          `If Sport80 really dropped them: npx convex run scrapers/sport80:run '{"only":["${eventId}"],"allowShrink":true}' (add --prod for production)`,
      );
    }
    const deleted = await deleteResultRows(ctx, [...dropped, ...retitled].slice(0, RESULT_PRUNE_BATCH));
    return { deleted, remaining: stale.length - deleted };
  },
});
