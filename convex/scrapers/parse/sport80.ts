// Pure parts of `scrapers/sport80.ts` (port of `usaw/sport80_api/update_supabase_from_sport80.py`).

import { pyFloat } from '../lib/numbers';

export const USAW_DOMAIN = 'https://usaweightlifting.sport80.com';
export const RECENT_EVENTS = 30;

type Dict = Record<string, unknown>;

/**
 * `get_nested_value`: with a column name and a `columns` map present, that
 * column's `value` (and nothing else, even if missing); otherwise the plain key.
 */
export function nested(data: Dict, primaryKey: string, columnName?: string): unknown {
  if (columnName && 'columns' in data) {
    const columns = (data.columns ?? {}) as Record<string, Dict | undefined>;
    return columns[columnName]?.value ?? null;
  }
  return data[primaryKey] ?? null;
}

/** Python `or`: the first truthy value, else the last. */
function or(...values: unknown[]): unknown {
  for (const value of values) if (value) return value;
  return values[values.length - 1] ?? null;
}

function utc(year: number, month: number, day: number): number | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.getTime() : null;
}

/** The event's start date as sent, or null when it has none. */
function rawEventDate(event: Dict): string | null {
  const raw = or(nested(event, 'date', 'Start Date'), nested(event, 'start_date'));
  return raw ? String(raw) : null;
}

/**
 * `parse_event_date`: the start date's first space-separated token as an ISO
 * date (`2026-10-04`, the one format the event index sends), or null.
 *
 * The Python also read slash dates, day/month first, which would swap the
 * month and day of a US `MM/DD/YYYY` date whose day is 12 or less (the site
 * is set to US dates). Sport80 has not been seen sending one (every event of
 * 2025 and 2026 checked in October 2026 was ISO), so any other format is not
 * guessed at: see `unreadableEventDate`.
 */
export function eventDate(event: Dict): number | null {
  const raw = rawEventDate(event);
  if (!raw) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw.split(' ')[0]);
  return iso ? utc(Number(iso[1]), Number(iso[2]), Number(iso[3])) : null;
}

/** The start date as sent when the event has one `eventDate` cannot read, else null. */
export function unreadableEventDate(event: Dict): string | null {
  const raw = rawEventDate(event);
  return raw !== null && eventDate(event) === null ? raw : null;
}

/**
 * Newest first, events without a date last. Same-date events are ordered by
 * event id, newest first: the API returns them in an order that changes
 * between requests, which made the Python job's cut at 30 events pick
 * different meets from one run to the next.
 */
const idNumber = (event: Dict) => Number(eventIdOf(event) ?? 0) || 0;

export function newestEvents(events: Dict[], count = RECENT_EVENTS): Dict[] {
  return events
    .map((event) => ({ event, date: eventDate(event), id: idNumber(event) }))
    .sort((a, b) => (b.date ?? -Infinity) - (a.date ?? -Infinity) || b.id - a.id)
    .slice(0, count)
    .map(({ event }) => event);
}

/** The event id: the last segment of `action[0].route`, else `id`. */
export function eventIdOf(event: Dict): string | null {
  const action = event.action;
  if (Array.isArray(action) && action[0] && typeof action[0] === 'object' && typeof (action[0] as Dict).route === 'string') {
    return ((action[0] as Dict).route as string).split('/').pop()!.trim();
  }
  return event.id ? String(event.id).trim() : null;
}

export function hasResultsRoute(event: Dict): boolean {
  const action = event.action;
  return Array.isArray(action) && !!action[0] && typeof action[0] === 'object' && 'route' in (action[0] as Dict);
}

/** Python `float(x) if x is not None else None`; a value float() rejects makes the row invalid. */
function toFloat(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const number = pyFloat(String(value));
  if (number === null) throw new Error(`not a number: ${JSON.stringify(value)}`);
  return number;
}

export type ResultRow = {
  eventId: string;
  meet: string;
  date: string;
  name: string | null;
  age: string | null;
  bodyWeight: number | null;
  snatch1: number | null;
  snatch2: number | null;
  snatch3: number | null;
  snatchBest: number | null;
  cj1: number | null;
  cj2: number | null;
  cj3: number | null;
  cjBest: number | null;
  total: number | null;
  adaptive: false;
  federation: 'USAW';
};

/**
 * The meet's rows as the Python job formatted them, one per result item. An
 * item with a value that is not a number becomes a row with no name, which
 * the run logs and does not store: one bad cell loses that row, not the meet
 * or the night's sync.
 */
export function formatResults(eventId: string, meet: string, date: number | null, items: Dict[]): ResultRow[] {
  const day = date === null ? '1970-01-01' : new Date(date).toISOString().slice(0, 10);
  return items.map((item) => {
    try {
      return formatResult(eventId, meet, day, item);
    } catch {
      return { ...formatResult(eventId, meet, day, {}), name: null };
    }
  });
}

function formatResult(eventId: string, meet: string, day: string, item: Dict): ResultRow {
  return {
    eventId,
    meet,
    date: day,
    name: or(nested(item, 'lifter', 'Athlete'), nested(item, 'name', 'Name')) as string | null,
    age: or(nested(item, 'age_category', 'Age Category'), nested(item, 'age', 'Age')) as string | null,
    bodyWeight: toFloat(or(nested(item, 'body_weight_kg', 'Bodyweight'), nested(item, 'body_weight_(kg)'))),
    snatch1: toFloat(nested(item, 'snatch_lift_1', 'Snatch 1')),
    snatch2: toFloat(nested(item, 'snatch_lift_2', 'Snatch 2')),
    snatch3: toFloat(nested(item, 'snatch_lift_3', 'Snatch 3')),
    snatchBest: toFloat(nested(item, 'best_snatch', 'Best Snatch')),
    cj1: toFloat(or(nested(item, 'cj_lift_1', 'Clean & Jerk 1'), nested(item, 'c&j_lift_1'))),
    cj2: toFloat(or(nested(item, 'cj_lift_2', 'Clean & Jerk 2'), nested(item, 'c&j_lift_2'))),
    cj3: toFloat(or(nested(item, 'cj_lift_3', 'Clean & Jerk 3'), nested(item, 'c&j_lift_3'))),
    cjBest: toFloat(or(nested(item, 'best_cj', 'Best Clean & Jerk'), nested(item, 'best_c&j'))),
    total: toFloat(nested(item, 'total', 'Total')),
    adaptive: false,
    federation: 'USAW',
  };
}

/**
 * The newest events among those with a readable date (`newestEvents`), and
 * the events whose date `eventDate` cannot read. Those are left out, not
 * guessed at; one is `recent` when it could belong among the newest (its id
 * is above the oldest picked one's, ids rising with time, or fewer than
 * `count` were picked), which the sync fails on. An older one is only
 * logged: failing on it would keep the job failing for as long as the index
 * lists it, and a failing job sends no alert for a real outage.
 */
export function pickNewestEvents(events: Dict[], count = RECENT_EVENTS): { newest: Dict[]; unreadable: { event: Dict; date: string; recent: boolean }[] } {
  const dated: Dict[] = [];
  const undated: { event: Dict; date: string }[] = [];
  for (const event of events) {
    const date = unreadableEventDate(event);
    if (date === null) dated.push(event);
    else undated.push({ event, date });
  }
  const newest = newestEvents(dated, count);
  const oldestPicked = newest.length < count ? -Infinity : Math.min(...newest.map(idNumber));
  return { newest, unreadable: undated.map((entry) => ({ ...entry, recent: idNumber(entry.event) > oldestPicked })) };
}
