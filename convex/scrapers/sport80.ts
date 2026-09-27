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
  newestEvents,
  USAW_DOMAIN,
  type ResultRow,
} from './parse/sport80';

/**
 * USAW meet results from Sport80 (port of
 * `usaw/sport80_api/update_supabase_from_sport80.py`): the 30 most recent
 * events of this year and last, each meet's results upserted into
 * `lifting_results` (matched on event id, meet and name; unchanged rows are
 * not written, so a re-sync of an unchanged meet costs no writes).
 */
type Dict = Record<string, unknown>;

/** The Sport80 public API: key and base URL come from the site's `window.env`. */
class Sport80 {
  private constructor(private readonly env: Record<string, string>) {}

  static async connect(): Promise<Sport80> {
    const page = await (await fetch(`${USAW_DOMAIN}/public/rankings/`, { signal: AbortSignal.timeout(60_000) })).text();
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

  /** Every page's `data`, following `next_page_url`; any failed page fails the whole table. */
  private async collate(first: Dict, payload?: Dict): Promise<Dict[]> {
    const rows: Dict[] = [...((first.data as Dict[]) ?? [])];
    let current = first;
    while (typeof current.next_page_url === 'string' && current.next_page_url) {
      current = await this.post(current.next_page_url, payload);
      rows.push(...((current.data as Dict[]) ?? []));
    }
    return rows;
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
    return await this.collate(await this.post(this.url('/api/events/table/data', 1000), payload), payload);
  }

  async eventResults(eventId: string): Promise<Dict[]> {
    return await this.collate(await this.post(this.url(`/api/events/${eventId}/table/data`, 2000)));
  }
}

/** Rows per ingest call: each writes its rows and rewrites their athletes' history documents. */
const INGEST_BATCH = 200;

type MeetOutcome = { meet: string; eventId: string; rows: number; inserted: number; updated: number; unchanged: number; failed: number };
type RunResult = { meets: { eventId: string; meet: string; rows: ResultRow[] }[]; outcomes: MeetOutcome[]; failed: string[] };

export const run = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }): Promise<RunResult> => {
    const api = await Sport80.connect();
    const year = new Date().getUTCFullYear();
    // Everything that could not be read. The rest is still stored, then the
    // run fails naming these, so the alert fires and the next run retries.
    const failed: string[] = [];
    const events: Dict[] = [];
    for (const y of [year, year - 1]) {
      try {
          events.push(...(await api.eventIndex(y)));
      } catch (error) {
        failed.push(`event index ${y}: ${(error as Error).message}`);
      }
    }
    if (!events.length) throw new Error(`sport80: no events fetched (${failed.join('; ')})`);

    const meets: RunResult['meets'] = [];
    const seen = new Set<string>();
    for (const event of newestEvents(events)) {
      const eventId = eventIdOf(event);
      const meet = nested(event, 'meet') as string | null;
      if (!eventId || !meet || seen.has(eventId)) continue;
      seen.add(eventId);
      if (!hasResultsRoute(event)) continue;
      let items: Dict[];
      try {
        items = await api.eventResults(eventId);
      } catch (error) {
        failed.push(`${meet} (event ${eventId}, ${eventDate(event)}): ${(error as Error).message}`);
        continue;
      }
      if (items.length) meets.push({ eventId, meet, rows: formatResults(eventId, meet, eventDate(event), items) });
    }
    for (const failure of failed) console.error(`sport80: ${failure}`);
    if (dryRun) return { meets, outcomes: [], failed };

    const outcomes: MeetOutcome[] = [];
    for (const { eventId, meet, rows } of meets) {
      const outcome: MeetOutcome = { meet, eventId, rows: rows.length, inserted: 0, updated: 0, unchanged: 0, failed: 0 };
      // Rows with no name or an unreadable value are not stored, and are
      // logged (and returned in `outcomes`). They do not fail the run: a cell
      // Sport80 keeps sending wrong would keep the job failing, and a job
      // already failing sends no alert for a real outage.
      const valid = rows.filter((row) => typeof row.name === 'string' && row.name !== '' && (row.age === null || typeof row.age === 'string'));
      outcome.failed = rows.length - valid.length;
      if (outcome.failed > 0) console.warn(`sport80: ${meet} (event ${eventId}): ${outcome.failed} unreadable row(s) not stored`);
      try {
      for (let i = 0; i < valid.length; i += INGEST_BATCH) {
        const counts: { inserted: number; updated: number; unchanged: number } = await ctx.runMutation(
          internal.ingest.upsertLiftingResults,
          {
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
        failed.push(`${meet} (event ${eventId}): not stored: ${(error as Error).message}`);
      }
      outcomes.push(outcome);
    }

    const inserted = outcomes.filter((o) => o.inserted > 0).map((o) => o.meet);
    const updated = outcomes.filter((o) => o.inserted === 0 && o.updated > 0).map((o) => o.meet);
    console.log(`sport80: ${meets.length} meets, ${inserted.length} with new results, ${updated.length} updated`);
    if (failed.length) throw new Error(`sport80: ${failed.length} problem(s), the rest was stored: ${failed.join('; ')}`);
    return { meets, outcomes, failed };
  },
});
