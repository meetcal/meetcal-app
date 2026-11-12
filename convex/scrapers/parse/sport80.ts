// Pure parts of `scrapers/sport80.ts` (port of `usaw/sport80_api/update_supabase_from_sport80.py`).

import { isRecord, kindOf, textOrNull } from '../../lib/json';
import { pyFloat } from '../lib/numbers';
import { isValidIsoDate } from '../../lib/validation';
import { normalizeGender } from '../../lib/normalize';
import { DAY_MS, isoDateOf } from '../../lib/dates';
import { foldDivision } from '../../lib/lifters';
import { UNDATED_RESULT_DATE } from '../../lib/results';

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
    const column = isRecord(data.columns) ? data.columns[columnName] : undefined;
    return isRecord(column) ? (column.value ?? null) : null;
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
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw.split(' ')[0] ?? '');
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

function readResultOrUnnamed(eventId: string, meet: string, day: string, item: Dict): ResultRow {
  try {
    return formatResult(eventId, meet, day, item);
  } catch {
    return { ...formatResult(eventId, meet, day, {}), name: null };
  }
}

export function formatResults(eventId: string, meet: string, date: number | null, items: Dict[]): ResultRow[] {
  const day = date === null ? UNDATED_RESULT_DATE : isoDateOf(date);
  return items.map((item) => readResultOrUnnamed(eventId, meet, day, item));
}

export function formatAthleteResults(items: Dict[]): ResultRow[] {
  return items.map((item) => {
    const date = typeof item.date === 'string' && isValidIsoDate(item.date) ? item.date : null;
    const meet = typeof item.meet === 'string' ? item.meet : '';
    const row = readResultOrUnnamed('', meet, date ?? UNDATED_RESULT_DATE, item);
    return date === null ? { ...row, name: null } : row;
  });
}

function formatResult(eventId: string, meet: string, day: string, item: Dict): ResultRow {
  return {
    eventId,
    meet,
    date: day,
    name: textOrNull(or(nested(item, 'lifter', 'Athlete'), nested(item, 'name', 'Name'))),
    age: textOrNull(or(nested(item, 'age_category', 'Age Category'), nested(item, 'age', 'Age'))),
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

export type RankingClass = { id: number; label: string };

export function rankingClasses(table: Dict): RankingClass[] {
  const filters = Array.isArray(table.filters) ? table.filters : [];
  const filter = filters.find((f): f is Dict => isRecord(f) && f.name === 'weight_class');
  if (!filter || !Array.isArray(filter.items)) throw new Error('sport80: the rankings table has no weight class filter');
  return filter.items.map((item, index): RankingClass => {
    if (!isRecord(item) || typeof item.text !== 'string' || typeof item.value !== 'number' || !Number.isInteger(item.value)) {
      throw new Error(`sport80: weight class ${index} of the rankings filter is unreadable: ${JSON.stringify(item)}`);
    }
    return { id: item.value, label: item.text };
  });
}

const INACTIVE_PREFIX = '(inactive)';

export function foldClassLabel(label: string): string {
  const lower = label.toLowerCase().trim();
  return foldDivision(lower.startsWith(INACTIVE_PREFIX) ? lower.slice(INACTIVE_PREFIX.length) : lower);
}

export function rankingClassIds(ageCategory: string, classes: readonly RankingClass[]): number[] {
  const wanted = foldClassLabel(ageCategory);
  return classes.filter((c) => foldClassLabel(c.label) === wanted).map((c) => c.id);
}

export type LifterSighting = {
  athleteId: string;
  membership: string | null;
  name: string;
  gender: string | null;
  birthYear: number | null;
  club: string | null;
  wso: string | null;
  date: string;
};

const MEMBER_ROUTE = /\/public\/rankings\/member\/(\d+)(?:\/|$)/;
const PLAUSIBLE_LIFTER_AGE = { min: 4, max: 110 } as const;

function text(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function memberId(action: unknown): string | null {
  if (!Array.isArray(action)) return null;
  for (const button of action) {
    if (!isRecord(button) || typeof button.route !== 'string') continue;
    const match = MEMBER_ROUTE.exec(button.route);
    if (match) return match[1] ?? null;
  }
  return null;
}

function sightingGender(value: unknown): string | null {
  const raw = text(value);
  if (raw === null) return null;
  const gender = normalizeGender(raw);
  return gender === 'Men' || gender === 'Women' ? gender : null;
}

function birthYearAt(date: string, age: unknown): number | null {
  if (typeof age !== 'number' || !Number.isInteger(age) || age < PLAUSIBLE_LIFTER_AGE.min || age > PLAUSIBLE_LIFTER_AGE.max) return null;
  return Number(date.slice(0, 4)) - age;
}

export function lifterSighting(item: Dict): LifterSighting | null {
  const name = text(item.name);
  const athleteId = memberId(item.action);
  const date = typeof item.lift_date === 'string' && isValidIsoDate(item.lift_date) ? item.lift_date : null;
  if (name === null || athleteId === null || date === null) return null;
  return {
    athleteId,
    membership: text(item.membership),
    name,
    gender: sightingGender(item.gender),
    birthYear: birthYearAt(date, item.lifter_age),
    club: text(item.club),
    wso: text(item.wso),
    date,
  };
}
