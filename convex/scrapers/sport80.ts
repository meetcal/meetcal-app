'use node';

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import {
  eventDate,
  eventIdOf,
  formatResults,
  hasResultsRoute,
  nested,
  eventSource,
  failingEventIds,
  isSourceOfEvent,
  MAX_ROLLING_EVENTS_A_NIGHT,
  pickNewestEvents,
  pickNightlyEvents,
  pickRequestedEvents,
  RESULTS_JOB,
  type ResultRow,
} from './parse/sport80';
import { sourcesFailed, type SourceFailure } from '../lib/cronAlerts';
import { NOT_REACHED, runBudget } from './lib/budget';
import { Sport80 } from './lib/sport80Api';

type Dict = Record<string, unknown>;

const READ_SHARE = 0.5;
const READ_DEADLINE_SHARE = 0.75;

/** Rows per ingest call: each writes its rows and rewrites their athletes' history documents. */
const INGEST_BATCH = 200;

/**
 * A meet with more than this share of its rows unreadable fails (its readable
 * rows still stored): that is a payload Sport80 changed, not a stray cell.
 */
export const MAX_UNREADABLE_SHARE = 0.2;

/** Whether a meet's unreadable rows are more than the stray cells a sync skips quietly. */
export function tooManyUnreadable(unreadable: number, rows: number): boolean {
  return rows > 0 && unreadable > rows * MAX_UNREADABLE_SHARE;
}

/** Prune calls (of `ingest.RESULT_PRUNE_BATCH` rows each) one meet gets in a run. */
const MAX_PRUNE_CALLS = 25;

/** A row the sync can store: it has a name, and its age category is text. */
const readable = (row: ResultRow) => typeof row.name === 'string' && row.name !== '' && (row.age === null || typeof row.age === 'string');

type MeetOutcome = { meet: string; eventId: string; rows: number; inserted: number; updated: number; unchanged: number; failed: number; deleted: number };
type RunResult = { meets: { eventId: string; meet: string; rows: ResultRow[]; notWhole?: string }[]; outcomes: MeetOutcome[]; failed: string[] };

export const run = internalAction({
  // `only`: event ids to sync (of this year's and last year's events, not
  // only the newest; an id the index lacks fails the run). `allowShrink`: let an
  // event's prune delete more than it otherwise may, after checking by hand.
  args: { dryRun: v.optional(v.boolean()), only: v.optional(v.array(v.string())), allowShrink: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun, only, allowShrink }): Promise<RunResult> => {
    const budget = runBudget();
    const api = await budget.orStop(Sport80.connect());
    const year = new Date().getUTCFullYear();
    // Everything that could not be read or stored, by a source name that
    // stays the same from run to run. The rest is still stored, then the run
    // fails naming these, so the alert fires and the next run retries.
    const failures: SourceFailure[] = [];
    const failed = () => failures.map(({ source, error }) => `${source}: ${error}`);
    const events: Dict[] = [];
    for (const y of [year, year - 1]) {
      try {
        events.push(...(await budget.orStop(api.eventIndex(y))));
      } catch (error) {
        failures.push({ source: `event index ${y}`, error: (error as Error).message });
      }
    }
    const failedLastRun: string[] = only ? [] : await ctx.runQuery(internal.cronStatus.failedSources, { job: RESULTS_JOB });
    const stillFailing = failingEventIds(failedLastRun);
    const notRetried = (ids: readonly string[]) =>
      ids.map((id) => ({
        source: failedLastRun.find((source) => isSourceOfEvent(source, id)) ?? eventSource(null, id),
        error: 'failed in the last run and the event index it is in could not be read, not synced',
      }));
    if (!events.length) throw sourcesFailed('sport80: no events fetched', [...failures, ...notRetried(stillFailing)]);

    let newest: Dict[];
    let unreadable: ReturnType<typeof pickNewestEvents>['unreadable'];
    if (only) {
      const requested = pickRequestedEvents(events, only);
      ({ picked: newest, unreadable } = requested);
      const indexes = [year, year - 1].filter((y) => !failures.some((f) => f.source === `event index ${y}`));
      for (const id of requested.missing) {
        failures.push({ source: eventSource(null, id), error: `not in the event index read (${indexes.join(', ')}), not synced` });
      }
    } else {
      const nightly = pickNightlyEvents(events, Date.now(), { stillFailing });
      ({ newest, unreadable } = nightly);
      console.log(`sport80: reading ${nightly.recentCount} recent events, ${nightly.retriedCount} that failed last run and ${nightly.rollingCount} older ones due tonight`);
      if (failures.length > 0) failures.push(...notRetried(nightly.notInTheIndex));
      if (nightly.rollingLeftOut > 0) {
        failures.push({ source: 'rolling pass', error: `${nightly.rollingLeftOut} older events due tonight were not read (more than ${MAX_ROLLING_EVENTS_A_NIGHT}); raise ROLLING_NIGHTS in parse/sport80.ts` });
      }
    }
    const reported = new Set<string>();
    for (const { event, date, recent } of unreadable) {
      const source = eventSource(String(nested(event, 'meet') ?? '?'), eventIdOf(event));
      const error = `unreadable date ${JSON.stringify(date)}, not synced`;
      if (reported.has(source)) continue;
      reported.add(source);
      if (recent) failures.push({ source, error });
      else console.warn(`sport80: ${source}: ${error}`);
    }

    const meets: RunResult['meets'] = [];
    const seen = new Set<string>();
    for (const event of newest) {
      const eventId = eventIdOf(event);
      const meet = nested(event, 'meet') as string | null;
      if (!eventId || !meet || seen.has(eventId)) continue;
      seen.add(eventId);
      if (!hasResultsRoute(event) || (only && !only.includes(eventId))) continue;
      if (budget.spent(READ_SHARE)) {
        failures.push({ source: eventSource(meet, eventId), error: NOT_REACHED });
        continue;
      }
      let table: { rows: Dict[]; notWhole?: string };
      try {
        table = await budget.orStop(api.eventResults(eventId), READ_DEADLINE_SHARE);
      } catch (error) {
        failures.push({ source: eventSource(meet, eventId), error: `${eventDate(event)}: ${(error as Error).message}` });
        continue;
      }
      if (table.rows.length) meets.push({ eventId, meet, rows: formatResults(eventId, meet, eventDate(event), table.rows), notWhole: table.notWhole });
    }
    for (const id of only ?? []) {
      if (meets.some((m) => m.eventId === id) || failures.some((f) => isSourceOfEvent(f.source, id))) continue;
      failures.push({ source: eventSource(null, id), error: 'no results read (no results page, no meet name, or an empty table), not synced' });
    }
    for (const failure of failed()) console.error(`sport80: ${failure}`);
    if (dryRun) return { meets, outcomes: [], failed: failed() };

    const outcomes: MeetOutcome[] = [];
    let storedCount = 0;
    for (const { eventId, meet, rows, notWhole } of meets) {
      const source = eventSource(meet, eventId);
      if (budget.spent()) {
        failures.push({ source, error: `read but not stored: ${NOT_REACHED}` });
        continue;
      }
      const outcome: MeetOutcome = { meet, eventId, rows: rows.length, inserted: 0, updated: 0, unchanged: 0, failed: 0, deleted: 0 };
      outcomes.push(outcome);
      // Rows with no name or an unreadable value are not stored, and are
      // logged (and returned in `outcomes`). A stray one does not fail the
      // run: a cell Sport80 keeps sending wrong would keep the job failing.
      // Many of a meet's rows unreadable is a changed payload, and does.
      const valid = rows.filter(readable);
      outcome.failed = rows.length - valid.length;
      if (outcome.failed > 0) console.warn(`sport80: ${source}: ${outcome.failed} unreadable row(s) not stored`);
      if (tooManyUnreadable(outcome.failed, rows.length)) {
        failures.push({ source, error: `${outcome.failed} of ${rows.length} rows unreadable (payload changed?), those not stored` });
      }
      try {
      for (let i = 0; i < valid.length; i += INGEST_BATCH) {
        budget.writeOnlyBeforeTheHardStop();
        const counts: { inserted: number; updated: number; unchanged: number } = await ctx.runMutation(
          internal.ingest.upsertLiftingResults,
          {
            allowShrink: allowShrink ?? false,
            rows: valid.slice(i, i + INGEST_BATCH).map((row) => ({
              eventId: row.eventId,
              meet: row.meet,
              date: row.date,
              name: row.name!,
              age: row.age ?? undefined,
              bodyWeight: row.bodyWeight ?? undefined,
              snatch1: row.snatch1 ?? undefined,
              snatch2: row.snatch2 ?? undefined,
              snatch3: row.snatch3 ?? undefined,
              snatchBest: row.snatchBest ?? undefined,
              cj1: row.cj1 ?? undefined,
              cj2: row.cj2 ?? undefined,
              cj3: row.cj3 ?? undefined,
              cjBest: row.cjBest ?? undefined,
              total: row.total ?? undefined,
              adaptive: row.adaptive,
              federation: row.federation,
            })),
          },
        );
        outcome.inserted += counts.inserted;
        outcome.updated += counts.updated;
        outcome.unchanged += counts.unchanged;
      }
      } catch (error) {
        failures.push({ source, error: `not stored: ${(error as Error).message}` });
        continue;
      }
      if (valid.length > 0) storedCount += 1;
      // Only a meet read in full is a safe basis for deleting what it lacks.
      if (outcome.failed > 0 || valid.length === 0) continue;
      if (notWhole) {
        failures.push({ source, error: `stale results not deleted: ${notWhole}` });
        continue;
      }
      try {
        const keep = valid.map((row) => ({ meet: row.meet, name: row.name!, age: row.age, date: row.date }));
        for (let call = 0; call < MAX_PRUNE_CALLS; call++) {
          budget.writeOnlyBeforeTheHardStop();
          const pruned: { deleted: number; remaining: number } = await ctx.runMutation(internal.ingest.pruneEventResults, { eventId, keep, allowShrink: allowShrink ?? false });
          outcome.deleted += pruned.deleted;
          if (pruned.remaining === 0 || pruned.deleted === 0) break;
        }
      } catch (error) {
        failures.push({ source, error: `stale results not deleted: ${(error as Error).message}` });
      }
    }

    const inserted = outcomes.filter((o) => o.inserted > 0).map((o) => o.meet);
    const updated = outcomes.filter((o) => o.inserted === 0 && o.updated > 0).map((o) => o.meet);
    const deleted = outcomes.reduce((sum, o) => sum + o.deleted, 0);
    console.log(`sport80: ${meets.length} meets, ${inserted.length} with new results, ${updated.length} updated, ${deleted} stale result(s) deleted`);
    if (failures.length) throw sourcesFailed(`sport80: ${failures.length} problem(s), ${storedCount} of ${meets.length} meet(s) read were stored`, failures);
    return { meets, outcomes, failed: failed() };
  },
});
