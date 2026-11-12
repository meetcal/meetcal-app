// Pure parts of `scrapers/sport80.ts` (port of `usaw/sport80_api/update_supabase_from_sport80.py`).

import { isRecord, kindOf } from '../../lib/json';
import { pyFloat } from '../lib/numbers';
import { DAY_MS } from '../../lib/dates';

export const USAW_DOMAIN = 'https://usaweightlifting.sport80.com';
export const RECENT_EVENTS = 30;

type Dict = Record<string, unknown>;

export type Sport80Env = { RANKINGS_DOMAIN_URL: string; SERVICES_API_PUBLIC_KEY: string };

export function readSport80Env(json: string): Sport80Env {
  let env: unknown;
  try {
    env = JSON.parse(json);
  } catch {
    throw new Error('sport80: window.env on the rankings page is not JSON');
  }
  if (!isRecord(env)) throw new Error('sport80: window.env on the rankings page is not an object');
  const value = (key: keyof Sport80Env): string => {
    const found = typeof env[key] === 'number' ? String(env[key]) : env[key];
    if (typeof found !== 'string' || found.trim() === '') throw new Error(`sport80: window.env has no ${key} (the rankings page changed?)`);
    return found;
  };
  const RANKINGS_DOMAIN_URL = value('RANKINGS_DOMAIN_URL');
  if (!URL.canParse(RANKINGS_DOMAIN_URL)) throw new Error(`sport80: window.env RANKINGS_DOMAIN_URL is not a URL (${JSON.stringify(RANKINGS_DOMAIN_URL)})`);
  return { RANKINGS_DOMAIN_URL, SERVICES_API_PUBLIC_KEY: value('SERVICES_API_PUBLIC_KEY') };
}

export function readTablePage(body: unknown): Dict {
  if (!isRecord(body)) throw new Error(`the table response is ${kindOf(body)}, not an object`);
  return body;
}

export function pageRows(page: Dict): Dict[] {
  const { data } = page;
  if (data === undefined || data === null) return [];
  if (!Array.isArray(data)) throw new Error(`the table's data is ${kindOf(data)}, not a list of rows`);
  return data.map((row: unknown, i) => {
    if (!isRecord(row)) throw new Error(`the table's row ${i} is not an object`);
    return row;
  });
}

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

function firstAction(event: Dict): unknown {
  const actions: unknown = event.action;
  if (!Array.isArray(actions)) return undefined;
  const [first]: unknown[] = actions;
  return first;
}

export function eventIdOf(event: Dict): string | null {
  const action = firstAction(event);
  if (isRecord(action) && typeof action.route === 'string') return (action.route.split('/').pop() ?? '').trim();
  return event.id ? String(event.id).trim() : null;
}

export function hasResultsRoute(event: Dict): boolean {
  const action = firstAction(event);
  return isRecord(action) && 'route' in action;
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

export const RECENT_DAYS = 21;
export const ROLLING_NIGHTS = 28;
export const MAX_ROLLING_EVENTS_A_NIGHT = 120;

export const RESULTS_JOB = 'results-sport80';

export const eventSource = (meet: string | null, eventId: string | null) => (meet === null ? `event ${eventId ?? '?'}` : `${meet} (event ${eventId ?? '?'})`);

export const isSourceOfEvent = (source: string, eventId: string) => source === eventSource(null, eventId) || source.endsWith(`(event ${eventId})`);

export function failingEventIds(failedSources: readonly string[]): string[] {
  const ids = failedSources.map((source) => /(?:^|\()event (\d+)\)?$/.exec(source)?.[1]).filter((id): id is string => id !== undefined);
  return [...new Set(ids)];
}

export type NightlyEvents = {
  newest: Dict[];
  recentCount: number;
  retriedCount: number;
  rollingCount: number;
  rollingLeftOut: number;
  notInTheIndex: string[];
  unreadable: { event: Dict; date: string; recent: boolean }[];
};

export function pickNightlyEvents(
  events: Dict[],
  now: number,
  {
    count = RECENT_EVENTS,
    recentDays = RECENT_DAYS,
    rollingNights = ROLLING_NIGHTS,
    maxRolling = MAX_ROLLING_EVENTS_A_NIGHT,
    stillFailing = [] as readonly string[],
  } = {},
): NightlyEvents {
  const { newest, unreadable } = pickNewestEvents(events, count);
  const recentIds = new Set(newest.map(eventIdOf));
  const recent = [...newest];
  const older = new Map<string, Dict>();
  const earliestRecentDay = (Math.floor(now / DAY_MS) - recentDays) * DAY_MS;
  for (const event of events) {
    const id = eventIdOf(event);
    const date = eventDate(event);
    if (id === null || date === null || recentIds.has(id) || older.has(id)) continue;
    if (date >= earliestRecentDay) {
      recentIds.add(id);
      recent.push(event);
    } else {
      older.set(id, event);
    }
  }
  const tonight = Math.floor(now / DAY_MS) % rollingNights;
  const dueTonight = [...older.values()].filter((event) => idNumber(event) % rollingNights === tonight).sort((a, b) => idNumber(b) - idNumber(a));
  const rolling = dueTonight.slice(0, maxRolling);
  const picked = new Set([...recent, ...rolling].map(eventIdOf));
  const inTheIndex = new Set(events.map(eventIdOf));
  const retried = stillFailing.flatMap((id) => {
    const event = picked.has(id) ? undefined : older.get(id);
    return event === undefined ? [] : [event];
  });
  const oldestRecentId = recent.length < count ? -Infinity : Math.min(...recent.map(idNumber));
  return {
    newest: [...recent, ...retried, ...rolling],
    recentCount: recent.length,
    retriedCount: retried.length,
    rollingCount: rolling.length,
    rollingLeftOut: dueTonight.length - rolling.length,
    notInTheIndex: stillFailing.filter((id) => !picked.has(id) && !older.has(id) && !inTheIndex.has(id)),
    unreadable: unreadable.map((entry) => ({ ...entry, recent: entry.recent || idNumber(entry.event) > oldestRecentId })),
  };
}

/**
 * The events a run asked for by id (`only`), from the whole index, however
 * many newer events there are: the override for a refused prune must reach
 * the event it names after newer ones push it out of the newest
 * (`pickNewestEvents`). `missing` are the ids the index does not have, which
 * the sync fails on rather than report a run that did nothing as done. One
 * with an unreadable date, or none, is `unreadable` (and `recent`: it was
 * asked for).
 */
export function pickRequestedEvents(
  events: Dict[],
  only: readonly string[],
): { picked: Dict[]; unreadable: { event: Dict; date: string; recent: boolean }[]; missing: string[] } {
  const wanted = new Set(only);
  const found = new Set<string>();
  const picked: Dict[] = [];
  const unreadable: { event: Dict; date: string; recent: boolean }[] = [];
  for (const event of events) {
    const id = eventIdOf(event);
    if (!id || !wanted.has(id) || found.has(id)) continue;
    found.add(id);
    // No date at all is as unreadable as one in an unknown format: its rows
    // would be stored undated.
    const date = eventDate(event) === null ? (unreadableEventDate(event) ?? '') : null;
    if (date === null) picked.push(event);
    else unreadable.push({ event, date, recent: true });
  }
  return { picked, unreadable, missing: [...wanted].filter((id) => !found.has(id)) };
}
