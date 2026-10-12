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
  pickNewestEvents,
  USAW_DOMAIN,
  type ResultRow,
} from './parse/sport80';
import { sourcesFailed, type SourceFailure } from '../lib/cronAlerts';

/**
 * USAW meet results from Sport80 (port of
 * `usaw/sport80_api/update_supabase_from_sport80.py`): the 30 most recent
 * events of this year and last, each meet's results upserted into
 * `lifting_results` (matched on event id, meet, folded name and age
 * category, `ingest.resultKey`; unchanged rows are not written, so a
 * re-sync of an unchanged meet costs no writes). Rows the
 * event's table no longer has (a corrected name, a withdrawn result, the
 * meet's old title) are then deleted (`ingest.pruneEventResults`, which
 * refuses to delete much without `allowShrink`), but only for a meet whose
 * every row was read: a row that could not be read is not one Sport80 dropped.
 */
type Dict = Record<string, unknown>;

/** Pages one table may take: tables are requested as one page, so more is a misbehaving API. */
const MAX_PAGES = 50;

/** Whether a table provably read in full: it reports a row count (`total`), and that many rows were read. */
export function tableComplete(rows: number, total: unknown): boolean {
  return typeof total === 'number' && Number.isInteger(total) && total >= 0 && rows === total;
}

/**
 * A table's pages joined. A table short of the `total` it reports throws.
 * `notWhole` says why the rows, though returned, are no proof the table was
 * read in full, so no basis for deleting what it lacks: it reports no
 * `total`, or a row came back on two pages (the pages' order shifted between
 * requests, so the repeat may stand in for a row no page returned).
 */
export function joinPages(pages: readonly Dict[][], total: unknown): { rows: Dict[]; notWhole?: string } {
  const rows = pages.flat();
  if (typeof total === 'number' && rows.length !== total) throw new Error(`read ${rows.length} rows of the ${total} the table reports`);
  if (!tableComplete(rows.length, total)) return { rows, notWhole: 'the table reports no row count' };
  const earlier = new Set<string>();
  for (const page of pages) {
    const keys = page.map((row) => JSON.stringify(row));
    if (keys.some((key) => earlier.has(key))) return { rows, notWhole: 'a row came back on two pages (their order shifted)' };
    for (const key of keys) earlier.add(key);
  }
  return { rows };
}

/** The Sport80 public API: key and base URL come from the site's `window.env`. */
class Sport80 {
  private constructor(private readonly env: Record<string, string>) {}

  static async connect(): Promise<Sport80> {
    const response = await fetch(`${USAW_DOMAIN}/public/rankings/`, { signal: AbortSignal.timeout(60_000) });
    // A 5xx page has no `window.env` either: say what really failed.
    if (!response.ok) throw new Error(`sport80: rankings page failed with ${response.status}`);
    const page = await response.text();
    const match = /window\.env = ({.*?});/s.exec(page);
    if (!match) throw new Error('sport80: window.env not found on the rankings page');
    return new Sport80(JSON.parse(match[1]));
  }

  private headers() {
    return {
      'X-API-TOKEN': this.env.SERVICES_API_PUBLIC_KEY,
      authority: this.env.RANKINGS_DOMAIN_URL,
      accept: 'application/json',
      'Content-Type': 'application/json',
    };
  }

  /** A page of a table; a failed request throws, so a partial table is never taken for a whole one. */
  private async post(url: string, payload?: Dict): Promise<Dict> {
    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`POST ${new URL(url).pathname} failed with ${response.status}`);
    return (await response.json()) as Dict;
  }

  /**
   * Every page's `data`, following `next_page_url`; any failed page fails
   * the whole table, and so does a table short of the `total` it reports.
   * The results sync deletes what a table lacks, so it prunes only a table
   * `joinPages` finds whole.
   */
  private async collate(first: Dict, payload?: Dict): Promise<{ rows: Dict[]; notWhole?: string }> {
    const pages: Dict[][] = [(first.data as Dict[]) ?? []];
    let current = first;
    for (let page = 1; typeof current.next_page_url === 'string' && current.next_page_url; page++) {
      if (page > MAX_PAGES) throw new Error(`table has over ${MAX_PAGES} pages`);
      current = await this.post(current.next_page_url, payload);
      pages.push((current.data as Dict[]) ?? []);
    }
    return joinPages(pages, first.total);
  }

  /**
   * Tables are requested as one page (`p=0&l=…`). The API's default 30-row
   * pages are sorted by a key with ties it orders differently from one
   * request to the next, so walking them could skip or repeat rows (the
   * Python job's did); `next_page_url` is still followed if a table outgrows
   * the page.
   */
  private url(path: string, rows: number): string {
    return new URL(`${path}?p=0&l=${rows}&s=`, this.env.RANKINGS_DOMAIN_URL).toString();
  }

  async eventIndex(year: number): Promise<Dict[]> {
    const payload = { date_range_start: `${year}-01-01`, date_range_end: `${year}-12-31` };
    return (await this.collate(await this.post(this.url('/api/events/table/data', 1000), payload), payload)).rows;
  }

  async eventResults(eventId: string): Promise<{ rows: Dict[]; notWhole?: string }> {
    return await this.collate(await this.post(this.url(`/api/events/${eventId}/table/data`, 2000)));
  }
}

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
  // `only`: event ids to sync (of the recent events). `allowShrink`: let an
  // event's prune delete more than it otherwise may, after checking by hand.
  args: { dryRun: v.optional(v.boolean()), only: v.optional(v.array(v.string())), allowShrink: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun, only, allowShrink }): Promise<RunResult> => {
    const api = await Sport80.connect();
    const year = new Date().getUTCFullYear();
    // Everything that could not be read or stored, by a source name that
    // stays the same from run to run. The rest is still stored, then the run
    // fails naming these, so the alert fires and the next run retries.
    const failures: SourceFailure[] = [];
    const failed = () => failures.map(({ source, error }) => `${source}: ${error}`);
    const events: Dict[] = [];
    for (const y of [year, year - 1]) {
      try {
        events.push(...(await api.eventIndex(y)));
      } catch (error) {
        failures.push({ source: `event index ${y}`, error: (error as Error).message });
      }
    }
    if (!events.length) throw sourcesFailed('sport80: no events fetched', failures);

    // A date in a format not seen before is not guessed at (month and day
    // could be swapped): the event is left out, and the run fails naming it
    // when it could be among the newest (`pickNewestEvents`).
    const { newest, unreadable } = pickNewestEvents(events);
    const reported = new Set<string>();
    for (const { event, date, recent } of unreadable) {
      const source = `${String(nested(event, 'meet') ?? '?')} (event ${eventIdOf(event) ?? '?'})`;
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
      let table: { rows: Dict[]; notWhole?: string };
      try {
        table = await api.eventResults(eventId);
      } catch (error) {
        failures.push({ source: `${meet} (event ${eventId})`, error: `${eventDate(event)}: ${(error as Error).message}` });
        continue;
      }
      if (table.rows.length) meets.push({ eventId, meet, rows: formatResults(eventId, meet, eventDate(event), table.rows), notWhole: table.notWhole });
    }
    for (const failure of failed()) console.error(`sport80: ${failure}`);
    if (dryRun) return { meets, outcomes: [], failed: failed() };

    const outcomes: MeetOutcome[] = [];
    for (const { eventId, meet, rows, notWhole } of meets) {
      const source = `${meet} (event ${eventId})`;
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
        // One meet's write failing leaves the other meets to be stored.
        failures.push({ source, error: `not stored: ${(error as Error).message}` });
        continue;
      }
      // Only a meet read in full is a safe basis for deleting what it lacks.
      if (outcome.failed > 0 || valid.length === 0) continue;
      if (notWhole) {
        failures.push({ source, error: `stale results not deleted: ${notWhole}` });
        continue;
      }
      try {
        const keep = valid.map((row) => ({ meet: row.meet, name: row.name!, age: row.age, date: row.date }));
        // A batch a call; the rest of a huge prune waits for the next run.
        for (let call = 0; call < MAX_PRUNE_CALLS; call++) {
          const pruned: { deleted: number; remaining: number } = await ctx.runMutation(internal.ingest.pruneEventResults, {
            eventId,
            keep,
            allowShrink: allowShrink ?? false,
          });
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
    if (failures.length) throw sourcesFailed(`sport80: ${failures.length} problem(s), the rest was stored`, failures);
    return { meets, outcomes, failed: failed() };
  },
});
