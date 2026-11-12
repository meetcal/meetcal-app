// Meet entries from Sport80 (replaces `usaw/entry_scraper/csv_scraper.js`).
// The Node scraper drove a headless browser through the public entries page;
// the table on that page is filled from a public JSON endpoint, which this
// reads directly: `/api/public/events/datatable/{event}/entries/{stage}`,
// 100 rows a page, the meet's name in the table's title.
import { isRecord, kindOf, rowCount } from '../../lib/json';

export const SPORT80 = 'https://usaweightlifting.sport80.com';

const ENTRIES_PAGE = /\/public\/events\/(\d+)\/entries\/(\d+)/;

function entriesPage(pageUrl: string): { event: string; stage: string } {
  const match = ENTRIES_PAGE.exec(pageUrl);
  if (!match) throw new Error(`not a Sport80 entries page: ${pageUrl}`);
  return { event: match[1], stage: match[2] };
}

/** The entries data endpoint behind a public entries page URL. */
export function entriesEndpoint(pageUrl: string): string {
  const { event, stage } = entriesPage(pageUrl);
  return `${SPORT80}/api/public/events/datatable/${event}/entries/${stage}`;
}

/** The Sport80 event id of a public entries page URL: the id the meet sync stores as the meet's `sourceId`. */
export function entriesEventId(pageUrl: string): string {
  return entriesPage(pageUrl).event;
}

/**
 * Why an entries list was not stored: no stored meet is its event (by id) or
 * has its title. Usually the meet was stored before Sport80 retitled it, or
 * the target is for a meet MeetCal does not list.
 */
export function unstoredEntriesMessage(title: string, eventId: string, url: string): string {
  return (
    `the entries list ${JSON.stringify(title)} (Sport80 event ${eventId}) is no stored meet, so it was not stored. ` +
    `If Sport80 retitled a meet stored under another name, tie it to the event: npx convex run ingest:setMeetSourceId '{"name":"<stored name>","sourceId":"${eventId}"}'. ` +
    `If MeetCal does not list the meet, remove the target: npx convex run scrapers/entryTargets:remove '{"url":"${url}"}'`
  );
}

/** The table title without its " - Members" suffix, as the page's heading read. */
export function meetFromTitle(title: string): string {
  const trimmed = title.trim();
  return trimmed.endsWith(' - Members') ? trimmed.slice(0, -' - Members'.length) : trimmed;
}

/**
 * The shared stand-in for a missing membership number (`placeholder_member_id`
 * in the Python writer): athletes without one are keyed on meet and name.
 */
export function placeholderMemberId(name: string): string {
  const normalized = name.split(/\s+/).filter(Boolean).join(' ').toLowerCase();
  return `noid:${normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
}

export type EntryRow = {
  id?: unknown;
  member_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  weightlifting_age?: number | string | null;
  club?: string | null;
  gender?: string | null;
  weight_class?: string | null;
  entry_total?: number | string | null;
};

export type Entry = {
  memberId: string;
  name: string;
  age: number;
  club: string;
  gender: string;
  weightClass: string;
  entryTotal: number;
  meet: string;
  /** Filled by the sync from the member's other registrations (#345). */
  wso?: string;
};

export type EntriesTable = { title?: string; total?: number; data?: EntryRow[] };

export function readEntriesTable(body: unknown): EntriesTable {
  if (!isRecord(body)) throw new Error('entries: the response is not an object');
  const { title, total, data } = body;
  const count = rowCount(total);
  if (total !== undefined && total !== null && count === null) throw new Error(`entries: total is not a row count (${JSON.stringify(total)})`);
  if (data !== undefined && data !== null && !Array.isArray(data)) throw new Error('entries: data is not a list');
  const text = (row: Record<string, unknown>, i: number, field: string): string | null => {
    const value = row[field];
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') throw new Error(`entries: row ${i}: ${field} is ${kindOf(value)}`);
    return value;
  };
  const scalar = (row: Record<string, unknown>, i: number, field: string): number | string | null => {
    const value = row[field];
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`entries: row ${i}: ${field} is ${kindOf(value)}`);
    return value;
  };
  const rows = (data ?? []).map((item: unknown, i: number): EntryRow => {
    if (!isRecord(item)) throw new Error(`entries: row ${i} is not an object`);
    const memberId = scalar(item, i, 'member_id');
    const numberOrText = (field: string) => {
      const value = item[field];
      return typeof value === 'number' || typeof value === 'string' ? value : null;
    };
    return {
      ...('id' in item ? { id: item.id } : {}),
      member_id: memberId === null ? null : String(memberId),
      first_name: text(item, i, 'first_name'),
      last_name: text(item, i, 'last_name'),
      weightlifting_age: numberOrText('weightlifting_age'),
      club: text(item, i, 'club'),
      gender: text(item, i, 'gender'),
      weight_class: text(item, i, 'weight_class'),
      entry_total: numberOrText('entry_total'),
    };
  });
  return { ...(typeof title === 'string' ? { title } : {}), ...(count === null ? {} : { total: count }), ...(data ? { data: rows } : {}) };
}

/** JavaScript's `parseInt`, with the writer's default of 0 where it gives NaN. */
function whole(value: number | string | null | undefined): number {
  const parsed = parseInt(String(value ?? '').trim(), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * The last name without the pronouns some entrants append in parentheses
 * ("Mullen (She/her)" -> "Mullen"), every word of it kept ("De La Cruz").
 * The Node scraper cut the name at its first space, which cut every
 * multi-word surname too ("De La Cruz" -> "De"), so those entries never
 * matched the athlete's results.
 */
export function lastNameOf(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\([^)]*\)?/g, '').split(/\s+/).filter(Boolean).join(' ');
}

/** One entry: pronouns dropped from the last name, a missing membership number replaced by its placeholder. */
export function entryFromRow(row: EntryRow, meet: string): Entry {
  const first = (row.first_name ?? '').trim();
  const last = lastNameOf(row.last_name);
  const name = `${first} ${last}`;
  const memberId = (row.member_id ?? '').trim();
  return {
    memberId: memberId || placeholderMemberId(name),
    name,
    age: whole(row.weightlifting_age),
    club: (row.club ?? '').trim(),
    gender: (row.gender ?? '').trim(),
    weightClass: (row.weight_class ?? '').trim(),
    entryTotal: whole(row.entry_total),
    meet,
  };
}
