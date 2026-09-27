import { canonicalizePlatform, filterSessionAthletes, isLiftResult } from '@/lib/athletes';
import { LiftResult, Platform, SupabaseLiftResult } from '@/data/types/athletes';
import {
  Meet,
  MeetName,
  timezoneOffsets,
  USTimeZoneIdentifier,
} from '@/data/types/meet';
import type { Schedule } from '@/types/schedule';
import {
  ATTEMPT_HISTORY_YEARS,
  getHistoryCutoffDate,
  getTimeZoneAbbreviation,
  meetCalendarDateAnchor,
  YEAR_BESTS_YEARS,
} from '@/utils/dateTime';
import { getOffsetMinutesAtInstant, parseClockTime } from '@/utils/timezone';
import {
  HTTP_VALIDATOR_CACHE_LIMIT,
  usableEtag,
  ValidatorCache,
  type ValidatorEntry,
} from '@/lib/api/http-cache';
import { callApi, TransportRequestError, type ApiCall } from '@/lib/api/transport';

// The app's backend is Convex (`convex/`). Each function below calls the
// Convex query or mutation that answers exactly the JSON the Rust API's route
// of the same path did, so the mappers and validators in this file are the
// boundary they always were. `lib/api/transport.ts` owns the connection.

const DEFAULT_TIMEOUT_MS = 10000;
const SLOW_API_LOG_THRESHOLD_MS = 500;
/**
 * Names per request for the name-list calls whose rows are large: full
 * history (`results:byNames`) and the two-year window (`results:recent`).
 * One history batch is held in memory while it is written out, so this also
 * bounds the offline download's peak memory (see `meet-manager`).
 */
export const NAMES_QUERY_CHUNK_SIZE = 40;
/**
 * Names per request where each name answers with a handful of numbers or rows:
 * `results:bests` (three bests per name) and `latestOnly` history (one meet
 * per name). Equal to the server's name-list cap (100); one more name is a
 * `400`. Sorting a 1,562-athlete national start list by best total was 40
 * sequential requests at 40 names; it is 16 at 100.
 */
export const SMALL_ROWS_NAMES_CHUNK_SIZE = 100;

/**
 * Meet dates are calendar dates with no time. 16:00 UTC is inside the same
 * calendar day for every `USTimeZoneIdentifier` (UTC-10 .. UTC-4), so reading
 * the zone offset at this instant gives the meet's own offset on that date.
 */
const MEET_DATE_OFFSET_PROBE_HOUR_UTC = 16;
function chunkValues<T>(values: T[], size: number): T[][] {
  if (values.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}

function requireToken(token: string | null | undefined, label: string): string {
  if (typeof token !== 'string' || token.trim().length === 0) {
    throw new Error(`${label} requires an auth token`);
  }
  return token;
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function instantForMeetDate(dateIso: string | null | undefined): Date {
  if (typeof dateIso !== 'string' || dateIso.length === 0) {
    return new Date();
  }
  const [datePart] = dateIso.split('T');
  const [year, month, day] = (datePart ?? '').split('-').map(Number);
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
    return new Date();
  }
  return new Date(
    Date.UTC(year, month - 1, day, MEET_DATE_OFFSET_PROBE_HOUR_UTC, 0, 0),
  );
}

/**
 * Deliberately falls back rather than throwing: a meet with an unrecognised
 * `time_zone` still has a name, a venue and a schedule, and rejecting it here
 * would drop the whole `/meets` list over one bad row. The fallback is not
 * silent though — every displayed time for that meet will be an hour or three
 * off, and this is the only place that can say why.
 */
const FALLBACK_TIME_ZONE: USTimeZoneIdentifier = 'America/New_York';

function resolveTimeZoneIdentifier(
  value: string,
): { identifier: USTimeZoneIdentifier; known: boolean } {
  if (Object.prototype.hasOwnProperty.call(timezoneOffsets, value)) {
    return { identifier: value as USTimeZoneIdentifier, known: true };
  }
  // Warned in production too: this is the only signal that a meet's times
  // are being rendered in the wrong zone, and it is one line per bad meet row.
  console.warn(
    `[api] unknown meet time zone ${JSON.stringify(value)}, falling back to ${FALLBACK_TIME_ZONE}`,
  );
  return { identifier: FALLBACK_TIME_ZONE, known: false };
}

export class MeetCalApiError extends Error {
  status: number;
  body: string;
  /**
   * How long the server asked the caller to wait before retrying, in seconds,
   * when it said. Callers that retry once (the history download) wait this
   * long, capped on their side.
   */
  retryAfterSeconds?: number;

  constructor(message: string, status: number, body: string, retryAfterSeconds?: number) {
    super(message);
    this.name = 'MeetCalApiError';
    this.status = status;
    this.body = body;
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Server clock, as sampled from the `system:serverTime` mutation.
 *
 * Destructive housekeeping — auto-unsaving started sessions (server DELETE
 * included), clearing a downloaded meet once it has ended — used to trust
 * `Date.now()`. A device clock a few hours ahead deleted today's sessions
 * before they began; a day ahead wiped the downloaded meet at the next
 * refresh tick, offline included. Those decisions now use the server's
 * clock, sampled alongside the first request and refreshed while the app
 * talks to the backend, never persisted: a fresh process has no sample until
 * it has talked to the backend, and callers skip rather than guess (late is
 * harmless, early is data loss).
 */
export type ServerClockSample = {
  /** Server time minus device time at the sample, in ms. Positive: device is behind. */
  skewMs: number;
  /** `Date.now()` on the device when the sample was taken. */
  sampledAt: number;
};

/**
 * Beyond this, the device clock is not merely drifting and a decision that
 * mixes device wall-clock inputs (stored meet-local times) with server time
 * is not one to make automatically. Well past NTP drift, well short of a
 * time-zone mistake.
 */
export const MAX_PLAUSIBLE_CLOCK_SKEW_MS = 15 * 60 * 1000;

/** A sample older than this is refreshed (in the background) on the next request. */
export const SERVER_CLOCK_RESAMPLE_MS = 10 * 60 * 1000;
/**
 * How long the first request of the process waits, after its own answer, for
 * the clock sample it triggered. The mutation runs alongside the request, so
 * it is normally already done; the bound keeps a sample stuck on a dropped
 * connection from holding up data that has arrived.
 */
const SERVER_CLOCK_FIRST_SAMPLE_GRACE_MS = 2000;

function waitAtMost(promise: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** After this, an unanswered clock sample is given up on and may be retried. */
const SERVER_CLOCK_SAMPLE_TIMEOUT_MS = 10000;
/** A sample whose round trip took longer than this is too imprecise to keep. */
const MAX_CLOCK_SAMPLE_ROUND_TRIP_MS = 5000;

let serverClockSample: ServerClockSample | null = null;
let serverClockInFlight: Promise<void> | null = null;

/**
 * Asks the server for its clock and records the skew against the midpoint of
 * the round trip. Failures are swallowed: the sample is a hint, and the
 * request it rides alongside reports its own errors.
 */
function sampleServerClock(): { done: Promise<void>; started: boolean } {
  if (serverClockInFlight) return { done: serverClockInFlight, started: false };
  const sentAt = Date.now();
  const sample = callApi({ path: '/clock', fn: 'system:serverTime', kind: 'mutation', args: {} })
    .then((serverNow) => {
      if (typeof serverNow !== 'number' || !Number.isFinite(serverNow)) return;
      const receivedAt = Date.now();
      // The midpoint is only as good as half the round trip.
      if (receivedAt - sentAt > MAX_CLOCK_SAMPLE_ROUND_TRIP_MS) return;
      serverClockSample = { skewMs: serverNow - (sentAt + receivedAt) / 2, sampledAt: receivedAt };
    })
    .catch(() => {});
  // A sample stuck on a dropped connection is abandoned, so a later request
  // can start a fresh one instead of joining it forever.
  serverClockInFlight = waitAtMost(sample, SERVER_CLOCK_SAMPLE_TIMEOUT_MS).finally(() => {
    serverClockInFlight = null;
  });
  return { done: serverClockInFlight, started: true };
}

/**
 * Takes a new server clock sample (or joins the one in flight) and returns
 * the latest sample once it settles. For a decision that needs the server's
 * time now, not whenever the last request happened to sample it (the prune of
 * started sessions). Bounded by `SERVER_CLOCK_SAMPLE_TIMEOUT_MS`.
 */
export async function refreshServerClock(): Promise<ServerClockSample | null> {
  await sampleServerClock().done;
  return serverClockSample;
}

/** The last server clock sample this process took, or null before any response. */
export function getServerClockSample(): ServerClockSample | null {
  return serverClockSample;
}

/** Server time minus device time in ms, or null before any response. */
export function getServerClockSkewMs(): number | null {
  return serverClockSample?.skewMs ?? null;
}

/**
 * Now, on the server's clock: the device clock corrected by the last sample.
 * Null when this process has not heard from the backend yet.
 */
export function getTrustedNow(): Date | null {
  if (!serverClockSample) return null;
  return new Date(Date.now() + serverClockSample.skewMs);
}

/** Forgets the clock sample. For tests. */
export function resetServerClockForTests(): void {
  serverClockSample = null;
  serverClockInFlight = null;
}

/**
 * The request did not finish inside its timeout.
 *
 * A distinct class rather than a plain `Error`, because "the request timed
 * out" and "the request failed" get different treatment: the meets list falls
 * back to cache and throttles the log for a timeout, while a real failure is
 * always reported.
 */
export class MeetCalApiTimeoutError extends Error {
  path: string;
  timeoutMs: number;

  constructor(method: string, path: string, timeoutMs: number, message?: string) {
    super(message ?? `${method} ${path} timed out after ${timeoutMs}ms`);
    this.name = 'MeetCalApiTimeoutError';
    this.path = path;
    this.timeoutMs = timeoutMs;
  }
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} expected an object response`);
  }
}

function assertArray<T>(value: unknown, label: string): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} expected an array response`);
  }
  return value as T[];
}

function assertStringArray(value: unknown, label: string): string[] {
  const rows = assertArray<unknown>(value, label);
  if (!rows.every((row) => typeof row === 'string')) {
    throw new Error(`${label} expected a string array response`);
  }
  return rows;
}

function assertHasFields(value: unknown, label: string, fields: string[]): Record<string, unknown> {
  assertObject(value, label);
  const missing = fields.filter((field) => !(field in value));
  if (missing.length > 0) {
    throw new Error(`${label} missing fields: ${missing.join(', ')}`);
  }
  return value;
}

function methodLabel(call: ApiCall): string {
  return call.kind === 'query' ? 'GET' : 'POST';
}

/**
 * One call through the transport, with the client's timeout, the server clock
 * sample, and the error classes callers branch on: a rejected request is a
 * `MeetCalApiError` carrying the status the Rust API would have answered, a
 * request that outlives `timeoutMs` a `MeetCalApiTimeoutError`.
 *
 * The request that starts the process's first clock sample also waits
 * (briefly) for it, so the first response normally leaves a sample behind;
 * later ones refresh a stale sample in the background.
 */
async function request(call: ApiCall, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<unknown> {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  // The timeout also aborts the request, so it never lands later (a stale
  // save arriving after a newer unsave would bring the session back).
  const abort = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new MeetCalApiTimeoutError(methodLabel(call), call.path, timeoutMs));
      abort?.abort();
    }, timeoutMs);
  });
  const clock =
    serverClockSample === null || Date.now() - serverClockSample.sampledAt > SERVER_CLOCK_RESAMPLE_MS
      ? sampleServerClock()
      : null;

  try {
    const result = await Promise.race([callApi(abort ? { ...call, signal: abort.signal } : call), timeout]);
    // Only the request that started the process's first sample waits for it;
    // refreshes of an existing sample, and requests that merely find one in
    // flight, never do.
    if (clock?.started && serverClockSample === null) {
      await waitAtMost(clock.done, SERVER_CLOCK_FIRST_SAMPLE_GRACE_MS);
    }
    return result;
  } catch (error) {
    if (error instanceof TransportRequestError) {
      throw new MeetCalApiError(error.message, error.status, error.body);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      const elapsedMs = Math.round(
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt,
      );
      if (elapsedMs >= SLOW_API_LOG_THRESHOLD_MS) {
        console.info('[perf] slow api request', { elapsedMs, path: call.path, fn: call.fn });
      }
    }
  }
}

function readQuery(path: string, fn: string, args: Record<string, unknown> = {}): Promise<unknown> {
  return request({ path, fn, kind: 'query', args });
}

function parseJsonText(text: string, path: string): unknown {
  if (text.length === 0) throw new Error(`${path} returned an empty body`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${path} returned invalid JSON`);
  }
}

/**
 * Large answers arrive as JSON text (`{ json }`): the server passes stored
 * text through instead of building thousands of values (see
 * `convex/lib/views.ts`), and the text is parsed once, here. Anything else is
 * the value itself.
 */
function decodeJsonText(value: unknown, path: string): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'json' in value) {
    const { json } = value as { json: unknown };
    if (typeof json !== 'string') throw new Error(`${path} returned a non-text json field`);
    return parseJsonText(json, path);
  }
  return value;
}

type ConditionalAnswer = { etag: string | null; body: unknown; hasBody: boolean };

/**
 * `{ etag, json? }` (or `{ etag, body? }`) from a conditional query, checked
 * before anything reads it. No body means "unchanged since `etag`".
 */
function readConditional(value: unknown, path: string): ConditionalAnswer {
  assertObject(value, path);
  const etag = typeof value.etag === 'string' ? value.etag : null;
  if ('json' in value && value.json !== undefined) {
    return { etag, body: decodeJsonText({ json: value.json }, path), hasBody: true };
  }
  const hasBody = 'body' in value && value.body !== undefined;
  return { etag, body: value.body, hasBody };
}

const validatorCache = new ValidatorCache(HTTP_VALIDATOR_CACHE_LIMIT);
// Orders overlapping revalidations of one key (`ValidatorEntry.started`).
let revalidationsStarted = 0;

/** Forgets every remembered `etag`/body pair. For tests and sign-out style resets. */
export function clearHttpValidatorCache(): void {
  validatorCache.clear();
}

function stableKey(fn: string, args: Record<string, unknown>): string {
  const sorted = Object.keys(args)
    .filter((key) => args[key] !== undefined)
    .sort()
    .map((key) => [key, args[key]]);
  return `${fn}:${JSON.stringify(sorted)}`;
}

/**
 * Conditional read for the queries that tag their answers (see
 * `convex/lib/etag.ts`). Sends the tag last stored for these exact arguments
 * as `ifNoneMatch`; an answer without a body resolves to the value `validate`
 * accepted when that tag was stored, so shape checks never get skipped, only
 * repeated work and bytes on the wire.
 *
 * The remembered entry is read once, before the request, so an eviction while
 * the request is in flight cannot strand a bodiless answer; if a concurrent
 * request replaced that entry meanwhile, the answer resolves to the
 * replacement instead, so a slow revalidation never returns data older than
 * what a faster one already stored. Likewise a full answer is not stored over
 * an entry stored (or confirmed) by a request that started after it, and
 * resolves to that entry instead: the slower response may have read the data
 * before the faster one did. A bodiless answer naming a different tag than we
 * sent is not trusted: the entry is dropped and the request is retried once
 * without a tag.
 */
async function getRevalidated<T>(
  path: string,
  fn: string,
  args: Record<string, unknown>,
  validate: (json: unknown) => T,
): Promise<T> {
  const key = stableKey(fn, args);
  revalidationsStarted += 1;
  const started = revalidationsStarted;
  const held = validatorCache.get(key) as ValidatorEntry<T> | undefined;
  const call = (ifNoneMatch: string | undefined): Promise<unknown> =>
    request({ path, fn, kind: 'query', args: { ...args, ifNoneMatch }, conditional: true });
  let answer = readConditional(await call(held?.etag), path);

  if (!answer.hasBody) {
    if (held && (answer.etag == null || answer.etag === held.etag)) {
      const current = validatorCache.get(key) as ValidatorEntry<T> | undefined;
      if (current && current !== held) {
        // A concurrent request stored a newer body while this one was in
        // flight; this answer only vouches for the older tag, so never
        // publish the superseded value over it.
        return current.value;
      }
      // Refreshes recency, and dates the entry to this confirmation.
      if (current === held) validatorCache.set(key, { ...held, started });
      return held.value;
    }
    validatorCache.delete(key);
    answer = readConditional(await call(undefined), path);
    if (!answer.hasBody) throw new Error(`${path} answered without a body`);
  }

  const value = validate(answer.body);
  const current = validatorCache.get(key) as ValidatorEntry<T> | undefined;
  if (current && (current.started ?? 0) > started) return current.value;
  const etag = usableEtag(answer.etag);
  if (etag) {
    validatorCache.set(key, { etag, value, started });
  } else {
    validatorCache.delete(key);
  }
  return value;
}

export type ApiMeet = {
  id?: string;
  federation?: string;
  end_date: string;
  name: string;
  start_date: string;
  time_zone: string;
  venue_city: string;
  venue_name: string;
  venue_state: string;
  venue_street: string;
  venue_zip: string;
  venue_map_pdf_url?: string | null;
  venue_map_apple_url?: string | null;
  status: string;
};

export type ApiScheduleRow = {
  date: string;
  meet?: string;
  platform: string;
  session_id: number;
  start_time: string;
  weigh_in_time: string;
  weight_class: string;
};

export type ApiAthlete = {
  member_id: string;
  adaptive: boolean;
  age: number;
  club: string;
  entry_total: number;
  gender: string;
  meet?: string;
  name: string;
  session_number?: number | null;
  session_platform?: string | null;
  weight_class: string;
  wso?: string | null;
};

export type ApiAthleteWithSession = ApiAthlete & {
  date?: string | null;
  start_time?: string | null;
  weigh_in_time?: string | null;
  schedule_row?: ApiScheduleRow | null;
  session?: {
    session_number: number;
    session_platform: string;
    date?: string | null;
    start_time?: string | null;
    weigh_in_time?: string | null;
  } | null;
};

export type ApiLiftingResult = {
  id?: number;
  event_id?: string;
  federation?: string;
  meet: string;
  date: string;
  name: string;
  age: string;
  body_weight: number;
  snatch1: number;
  snatch2: number;
  snatch3: number;
  snatch_best: number;
  cj1: number;
  cj2: number;
  cj3: number;
  cj_best: number;
  total: number;
  adaptive?: boolean;
};

export type ApiYearBests = {
  best_snatch: number;
  best_cj: number;
  best_total: number;
};

export type ApiMeetPackage = {
  meet: ApiMeet;
  schedule: {
    date: string;
    sessions: {
      session_id: number;
      start_time: string;
      weigh_in_time: string;
      platforms: { platform: string; weight_class: string }[];
    }[];
  }[];
  athletes: (ApiAthlete & {
    session?: {
      session_number: number;
      session_platform: string;
      date?: string | null;
      start_time?: string | null;
      weigh_in_time?: string | null;
    } | null;
  })[];
  meet_results: ApiLiftingResult[];
  // Optional sections, selected with `include=`. Absent unless asked for (or
  // when talking to a backend that predates the parameter, which sends all).
  attempt_estimates?: unknown[];
  year_bests_by_name?: Record<string, ApiYearBests>;
  recent_results_by_name?: Record<string, ApiLiftingResult[]>;
};

export type ApiSavedSession = {
  session_id: string;
  meet: string;
  session_number: number;
  platform: string;
  weight_class?: string | null;
  start_time?: string | null;
  date?: string | null;
  notes?: string | null;
  athlete_names: string[];
  updated_at: number;
};

function getUTCOffsetHours(timeZoneIdentifier: string, dateIso: string): number {
  const instant = instantForMeetDate(dateIso);
  return -getOffsetMinutesAtInstant(timeZoneIdentifier, instant) / 60;
}

/**
 * Canonical platform name for an API row. Platforms are free text on the
 * server, so any name survives (`"Gold"` stays `"Gold"`); only casing and
 * whitespace are normalized. The old version coerced every unknown name to
 * `'Red'`, which merged a meet's Red and Gold platforms into one session.
 */
export function normalizePlatform(platform: string | null | undefined): Platform {
  return canonicalizePlatform(platform);
}

export function formatApiTime(time: string | null | undefined): string {
  if (!time) return '';
  try {
    const { hour, minute } = parseClockTime(time);
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHours = hour % 12 || 12;
    return `${displayHours}:${minute.toString().padStart(2, '0')} ${period}`;
  } catch {
    return '';
  }
}

/**
 * Display title for a schedule day. The API's `date` is scraped text, not a
 * typed date, so it is anchored through the one calendar-date parser
 * (`meetCalendarDateAnchor`, noon UTC). The old inline copy fell back to
 * `new Date(date)` for anything that was not `YYYY-MM-DD`, and a row dated
 * "TBD" rendered as the day title "Invalid Date". A value that is not a
 * calendar date is shown as sent.
 */
function dateForMeetTimezone(date: string, timeZoneIdentifier: USTimeZoneIdentifier): string {
  const anchor = meetCalendarDateAnchor(date);
  if (!anchor) return date;
  return anchor.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: timeZoneIdentifier,
  });
}

/**
 * `Meet` plus the one fact the mapper alone knows: whether `time` is the
 * meet's real zone or the fallback. Every consumer of `Meet` keeps working; a
 * screen that wants to flag the fallback reads `timeZoneUnknown`.
 */
export type MappedMeet = Meet & { timeZoneUnknown: boolean };

export function mapApiMeet(row: ApiMeet): MappedMeet {
  const { identifier: timeZoneIdentifier, known } = resolveTimeZoneIdentifier(
    row.time_zone || '',
  );
  const meetInstant = instantForMeetDate(row.start_date);
  const status =
    row.status === 'ongoing' || row.status === 'completed' || row.status === 'upcoming'
      ? row.status
      : 'upcoming';
  return {
    id: row.id || row.name,
    name: row.name,
    venue: {
      name: row.venue_name,
      address: {
        street: row.venue_street,
        city: row.venue_city,
        state: row.venue_state,
        zip: row.venue_zip,
      },
    },
    venueMapPdfUrl: row.venue_map_pdf_url ?? null,
    venueMapAppleUrl: row.venue_map_apple_url ?? null,
    time: {
      timeZone: row.time_zone,
      timeZoneIdentifier,
      // Every field here derives from the *same* zone. Splitting them (the
      // abbreviation and offset from the raw value, the identifier from the
      // fallback) showed a "CST" label next to times converted in New York.
      abbreviation: getTimeZoneAbbreviation(timeZoneIdentifier, meetInstant),
      utcOffset: getUTCOffsetHours(timeZoneIdentifier, row.start_date),
    },
    dates: {
      start: row.start_date,
      end: row.end_date,
    },
    status,
    timeZoneUnknown: !known,
  };
}

export function mapApiSchedule(rows: ApiScheduleRow[], meet?: Meet): Schedule {
  const timeZoneIdentifier = meet?.time.timeZoneIdentifier ?? 'America/New_York';
  const scheduleMap = new Map<string, {
    date: string;
    fullDate: string;
    sessions: Map<number, Schedule[number]['sessions'][number]>;
  }>();

  rows.forEach((row) => {
    if (!scheduleMap.has(row.date)) {
      scheduleMap.set(row.date, {
        date: dateForMeetTimezone(row.date, timeZoneIdentifier),
        fullDate: row.date,
        sessions: new Map(),
      });
    }
    const dayData = scheduleMap.get(row.date)!;
    if (!dayData.sessions.has(row.session_id)) {
      dayData.sessions.set(row.session_id, {
        id: String(row.session_id),
        number: row.session_id,
        startTime: formatApiTime(row.start_time),
        weighInTime: formatApiTime(row.weigh_in_time),
        platforms: [],
      });
    }
    const session = dayData.sessions.get(row.session_id)!;
    session.platforms.push({
      platform: normalizePlatform(row.platform),
      weightClass: row.weight_class ?? '',
      platformStartTime: formatApiTime(row.start_time),
    });
  });

  return Array.from(scheduleMap.values()).map((day) => ({
    date: day.date,
    fullDate: day.fullDate,
    sessions: Array.from(day.sessions.values()).sort((a, b) => a.number - b.number),
  }));
}

export function mapPackageSchedule(pkg: ApiMeetPackage): Schedule {
  const meet = mapApiMeet(pkg.meet);
  const rows = pkg.schedule.flatMap((day) =>
    day.sessions.flatMap((session) =>
      session.platforms.map((platform) => ({
        date: day.date,
        meet: pkg.meet.name,
        platform: platform.platform,
        session_id: session.session_id,
        start_time: session.start_time,
        weigh_in_time: session.weigh_in_time,
        weight_class: platform.weight_class,
      })),
    ),
  );
  return mapApiSchedule(rows, meet);
}

export function mapApiAthlete(row: ApiAthleteWithSession): LiftResult {
  assertObject(row, 'athlete');
  const sessionNumber = row.session_number ?? row.session?.session_number;
  const sessionPlatform = row.session_platform ?? row.session?.session_platform;
  const date = row.date ?? row.schedule_row?.date ?? row.session?.date ?? undefined;
  const startTime = row.start_time ?? row.schedule_row?.start_time ?? row.session?.start_time ?? undefined;
  const weighInTime = row.weigh_in_time ?? row.schedule_row?.weigh_in_time ?? row.session?.weigh_in_time ?? undefined;

  const athlete = {
    memberId: row.member_id || '',
    name: row.name,
    age: toFiniteNumber(row.age, 0),
    // Nullable in practice even though the row type says otherwise; the
    // screens already render '' and 0 for these, so default rather than
    // failing the row.
    club: row.club ?? '',
    wso: row.wso || undefined,
    gender: row.gender || '',
    weightClass: row.weight_class || '',
    entryTotal: toFiniteNumber(row.entry_total, 0),
    adaptive: row.adaptive || false,
    session: sessionNumber != null && sessionPlatform
      ? {
          number: sessionNumber,
          platform: normalizePlatform(sessionPlatform),
          ...(date != null && { date }),
          ...(startTime != null && { startTime: formatApiTime(startTime) }),
          ...(weighInTime != null && { weighInTime: formatApiTime(weighInTime) }),
        }
      : undefined,
  };
  if (!isLiftResult(athlete)) throw new Error('athlete contains invalid fields');
  return athlete;
}

/**
 * Map a roster, dropping (and reporting) only rows that cannot be salvaged —
 * no name, or a malformed session. One bad row must not fail an entire start
 * list or an offline download.
 */
export function mapApiAthletes(rows: readonly ApiAthleteWithSession[], source: string): LiftResult[] {
  const athletes: LiftResult[] = [];
  let dropped = 0;
  for (const row of rows) {
    try {
      athletes.push(mapApiAthlete(row));
    } catch {
      dropped += 1;
    }
  }
  if (dropped > 0) {
    console.warn(`[api] ${source}: dropped ${dropped} of ${rows.length} malformed athlete rows`);
  }
  return athletes;
}

/**
 * Rows are de-duplicated across cached meets by `event_id`. When the API has
 * none, a stable composite of the row's identity beats `''`, which collapsed
 * every id-less row into one key.
 */
function fallbackEventId(row: ApiLiftingResult): string {
  return `${row.meet ?? ''}|${row.date ?? ''}|${row.name ?? ''}`;
}

export function mapApiLiftingResult(row: ApiLiftingResult, index = 0): SupabaseLiftResult {
  return {
    id: row.id ?? index,
    event_id: row.event_id || fallbackEventId(row),
    meet: row.meet ?? '',
    date: row.date ?? '',
    name: row.name ?? '',
    age: typeof row.age === 'number' || typeof row.age === 'string' ? row.age : '',
    body_weight: row.body_weight ?? 0,
    snatch1: row.snatch1 ?? null,
    snatch2: row.snatch2 ?? null,
    snatch3: row.snatch3 ?? null,
    snatch_best: row.snatch_best ?? null,
    cj1: row.cj1 ?? null,
    cj2: row.cj2 ?? null,
    cj3: row.cj3 ?? null,
    cj_best: row.cj_best ?? null,
    total: row.total ?? null,
  };
}

export function mapApiYearBests(row: ApiYearBests) {
  return {
    bestSnatch: row.best_snatch ?? 0,
    bestCJ: row.best_cj ?? 0,
    bestTotal: row.best_total ?? 0,
  };
}

function validateApiMeets(json: unknown): ApiMeet[] {
  return assertArray<unknown>(json, '/meets').map(
    (row, index) =>
      assertHasFields(row, `/meets[${index}]`, [
        'name',
        'start_date',
        'end_date',
        'time_zone',
        'status',
      ]) as ApiMeet,
  );
}

function validateApiMeetDetails(json: unknown): ApiMeet {
  return assertHasFields(json, '/meets/details', [
    'name',
    'start_date',
    'end_date',
    'time_zone',
  ]) as ApiMeet;
}

function validateApiSchedule(json: unknown): ApiScheduleRow[] {
  return assertArray<ApiScheduleRow>(json, '/meets/schedule');
}

// The three below revalidate with the remembered tag. The cache holds the
// validated API rows, never the mapped app objects, so every caller still gets
// freshly built objects it may mutate.

/**
 * The meets list's window ("starts within three months") is evaluated at this
 * instant, rounded down to the hour so every client in that hour shares one
 * cached answer on the server.
 */
function meetsWindowNow(): number {
  const hourMs = 60 * 60 * 1000;
  const now = getTrustedNow()?.getTime() ?? Date.now();
  return Math.floor(now / hourMs) * hourMs;
}

export async function fetchApiMeets(): Promise<Meet[]> {
  const rows = await getRevalidated('/meets', 'meets:list', { now: meetsWindowNow() }, validateApiMeets);
  return rows.map((row) => mapApiMeet(row));
}

export async function fetchApiMeetByName(meet: string): Promise<Meet | null> {
  try {
    const row = await getRevalidated('/meets/details', 'meets:details', { meet }, validateApiMeetDetails);
    return row ? mapApiMeet(row) : null;
  } catch (error) {
    if (error instanceof MeetCalApiError && error.status === 404) return null;
    throw error;
  }
}

/**
 * @param meetDetails The meet, when the caller already holds it (the cached
 * meets list, the selected meet). Skips the `meets:details` round trip that
 * otherwise rides alongside every schedule fetch.
 */
export async function fetchApiSchedule(
  meet: MeetName,
  meetDetails?: Meet | null,
): Promise<Schedule> {
  const [resolvedMeet, rows] = await Promise.all([
    meetDetails ? Promise.resolve(meetDetails) : fetchApiMeetByName(meet),
    getRevalidated('/meets/schedule', 'meets:schedule', { meet }, validateApiSchedule),
  ]);
  return mapApiSchedule(rows, resolvedMeet ?? undefined);
}

export async function fetchApiAthletes(meet: MeetName): Promise<LiftResult[]> {
  const rows = assertArray<ApiAthlete>(
    decodeJsonText(await readQuery('/meets/athletes', 'meets:athletes', { meet }), '/meets/athletes'),
    '/meets/athletes',
  );
  return mapApiAthletes(rows, '/meets/athletes');
}

/**
 * Athletes with their session assignment, optionally narrowed to one session
 * and/or platform.
 *
 * The server's `platform` filter compares case-folded names. When a session
 * number is given the request is still narrowed by `sessionNumber` only (a
 * session is a handful of platforms, so the extra rows are cheap) and the
 * platform is matched client-side with the app's one case-insensitive rule,
 * so the two rules can never disagree. Only a platform-without-session query
 * is sent to the server as is.
 */
export async function fetchApiAthletesWithSession(
  meet: MeetName,
  sessionNumber?: number,
  platform?: string,
): Promise<LiftResult[]> {
  const filterLocally = sessionNumber != null && !!platform;
  const rows = assertArray<ApiAthleteWithSession>(
    decodeJsonText(
      await readQuery('/meets/athletes-sessions', 'meets:athletesSessions', {
        meet,
        sessionNumber: sessionNumber ?? undefined,
        platform: filterLocally ? undefined : platform,
      }),
      '/meets/athletes-sessions',
    ),
    '/meets/athletes-sessions',
  );
  const athletes = mapApiAthletes(rows, '/meets/athletes-sessions');
  return filterLocally ? filterSessionAthletes(athletes, sessionNumber, platform) : athletes;
}

// The cutoff defaults below come from the one UTC-only cutoff policy in
// `utils/dateTime.ts`; the server requires them.

export type ResultsByNamesOptions = {
  /**
   * Only the rows from each athlete's most recent meet date (`latestOnly`).
   * Applied per normalized name (case and whitespace folded).
   */
  latestOnly?: boolean;
};

// Chunking keeps each request under the server's name-list cap.
export async function fetchApiResultsByNames(
  names: string[],
  options: ResultsByNamesOptions = {},
): Promise<SupabaseLiftResult[]> {
  if (names.length === 0) return [];
  const rows: SupabaseLiftResult[] = [];
  const chunkSize = options.latestOnly ? SMALL_ROWS_NAMES_CHUNK_SIZE : NAMES_QUERY_CHUNK_SIZE;
  for (const chunk of chunkValues(names, chunkSize)) {
    const part = assertArray<ApiLiftingResult>(
      decodeJsonText(
        await readQuery('/lifting-results/by-names', 'results:byNames', {
          names: chunk,
          latestOnly: options.latestOnly ? true : undefined,
        }),
        '/lifting-results/by-names',
      ),
      '/lifting-results/by-names',
    );
    rows.push(...part.map(mapApiLiftingResult));
  }
  return rows;
}

export async function fetchApiRecentResultsByNames(
  names: string[],
  cutoffDate: string = getHistoryCutoffDate(ATTEMPT_HISTORY_YEARS),
): Promise<SupabaseLiftResult[]> {
  if (names.length === 0) return [];
  const rows: SupabaseLiftResult[] = [];
  for (const chunk of chunkValues(names, NAMES_QUERY_CHUNK_SIZE)) {
    const part = assertArray<ApiLiftingResult>(
      decodeJsonText(
        await readQuery('/lifting-results/recent', 'results:recent', { names: chunk, cutoffDate }),
        '/lifting-results/recent',
      ),
      '/lifting-results/recent',
    );
    rows.push(...part.map(mapApiLiftingResult));
  }
  return rows;
}

export async function fetchApiYearBests(
  name: string,
  cutoffDate: string = getHistoryCutoffDate(YEAR_BESTS_YEARS),
) {
  const row = assertHasFields(
    await readQuery('/lifting-results/year', 'results:yearBests', { name, cutoffDate }),
    '/lifting-results/year',
    ['best_snatch', 'best_cj', 'best_total'],
  ) as ApiYearBests;
  return [mapApiYearBests(row)];
}

/**
 * Name-keyed bests arrive as `[{ name, best_snatch, best_cj, best_total }]`
 * (Convex object keys must be ASCII; athlete names are not) and leave here as
 * the name-keyed map the app has always used.
 */
function namedBestsToMap(rows: unknown[], label: string): Record<string, ReturnType<typeof mapApiYearBests>> {
  const byName: Record<string, ReturnType<typeof mapApiYearBests>> = {};
  rows.forEach((row, index) => {
    const fields = assertHasFields(row, `${label}[${index}]`, ['name', 'best_snatch', 'best_cj', 'best_total']);
    if (typeof fields.name !== 'string') throw new Error(`${label}[${index}] has invalid name`);
    byName[fields.name] = mapApiYearBests(fields as unknown as ApiYearBests);
  });
  return byName;
}

export async function fetchApiYearBestsByNames(
  names: string[],
  cutoffDate: string = getHistoryCutoffDate(YEAR_BESTS_YEARS),
): Promise<Record<string, ReturnType<typeof mapApiYearBests>>> {
  if (names.length === 0) return {};
  const merged: Record<string, ReturnType<typeof mapApiYearBests>> = {};
  for (const chunk of chunkValues(names, SMALL_ROWS_NAMES_CHUNK_SIZE)) {
    const rows = assertArray<unknown>(
      await readQuery('/lifting-results/bests', 'results:bests', { names: chunk, cutoffDate }),
      '/lifting-results/bests',
    );
    Object.assign(merged, namedBestsToMap(rows, '/lifting-results/bests'));
  }
  return merged;
}

export async function searchApi(query: string, startDate?: string, endDate?: string) {
  const response = assertHasFields(
    await readQuery('/search', 'results:search', { query, startDate, endDate }),
    '/search',
    ['matched_name', 'suggestions', 'results'],
  );
  const suggestions = assertStringArray(response.suggestions, '/search.suggestions');
  const results = assertArray<ApiLiftingResult>(response.results, '/search.results');
  return {
    matchedName: typeof response.matched_name === 'string' ? response.matched_name : null,
    suggestions,
    results: results.map(mapApiLiftingResult),
  };
}

/**
 * The package is the heaviest read the app makes (a national meet's roster,
 * schedule, results and a year of bests); it gets more time than the default.
 */
export const MEET_PACKAGE_TIMEOUT_MS = 14000;
const MEET_PACKAGE_FIELDS = ['meet', 'schedule', 'athletes', 'meet_results'];
/**
 * Package sections the app actually ingests. The download pulls full history
 * from `results:byNames` instead of the package's `recent_results_by_name`,
 * and the server only builds `year_bests`.
 */
export const MEET_PACKAGE_INCLUDE = ['year_bests'] as const;

export type MeetPackageFetch =
  | { status: 'fresh'; etag: string | null; package: ApiMeetPackage }
  | { status: 'not_modified' };

/**
 * Fetches the meet package, revalidating with `ifNoneMatch` when the caller
 * still holds the previous tag. `not_modified` means the package the caller
 * already decomposed into local storage is identical to what the server would
 * send.
 */
export async function fetchApiMeetPackageConditional(
  meet: MeetName,
  historyCutoffDate?: string,
  ifNoneMatch?: string | null,
): Promise<MeetPackageFetch> {
  const answer = readConditional(
    await request(
      {
        path: '/meets/package',
        fn: 'meets:packageForMeet',
        kind: 'query',
        args: {
          meet,
          historyCutoffDate,
          include: [...MEET_PACKAGE_INCLUDE],
          ifNoneMatch: ifNoneMatch ?? undefined,
        },
        conditional: true,
      },
      MEET_PACKAGE_TIMEOUT_MS,
    ),
    '/meets/package',
  );
  if (!answer.hasBody) {
    if (ifNoneMatch && (answer.etag == null || answer.etag === ifNoneMatch)) {
      return { status: 'not_modified' };
    }
    throw new Error('/meets/package answered without a body');
  }
  const pkg = assertHasFields(answer.body, '/meets/package', MEET_PACKAGE_FIELDS);
  assertObject(pkg.meet, '/meets/package.meet');
  assertArray(pkg.schedule, '/meets/package.schedule');
  assertArray(pkg.athletes, '/meets/package.athletes');
  assertArray(pkg.meet_results, '/meets/package.meet_results');
  if ('year_bests' in pkg) {
    // Sent as a list (see `namedBestsToMap`); the rest of the app reads the
    // map the Rust API sent, with the API's snake_case fields.
    const byName: Record<string, ApiYearBests> = {};
    assertArray<unknown>(pkg.year_bests, '/meets/package.year_bests').forEach((row, index) => {
      const fields = assertHasFields(row, `/meets/package.year_bests[${index}]`, [
        'name',
        'best_snatch',
        'best_cj',
        'best_total',
      ]);
      if (typeof fields.name !== 'string') throw new Error(`/meets/package.year_bests[${index}] has invalid name`);
      byName[fields.name] = {
        best_snatch: toFiniteNumber(fields.best_snatch),
        best_cj: toFiniteNumber(fields.best_cj),
        best_total: toFiniteNumber(fields.best_total),
      };
    });
    const { year_bests: _wire, ...rest } = pkg;
    return { status: 'fresh', etag: answer.etag, package: { ...rest, year_bests_by_name: byName } as ApiMeetPackage };
  }
  return { status: 'fresh', etag: answer.etag, package: pkg as ApiMeetPackage };
}

// ---------------------------------------------------------------------------
// Reference data (`/data/*`, `/clubs`).
//
// These tables change a few times a season and the screens that show them
// refetch on every visit, so every query tags its answer and they all go
// through `getRevalidated`. What the cache keeps, and what an unchanged answer
// hands back, is the output of the validators below: fresh, frozen objects
// that carry exactly the declared fields. Callers only read them — they
// filter/map into their own structures — and the freeze means an accidental
// in-place edit can never rewrite what the next unchanged answer returns.
//
// Validation is per row, not all-or-nothing: the source tables have nullable
// columns, and the fetchers in `lib/database/` already drop an incomplete row
// rather than lose the whole table over it. So a field of the wrong type reads
// as `null` and a non-object row is skipped; only a non-array body (an error
// envelope, a paging wrapper) is rejected, which throws and caches nothing.
// ---------------------------------------------------------------------------

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function validateRows<T extends object>(
  json: unknown,
  label: string,
  readRow: (row: Record<string, unknown>) => T,
): readonly Readonly<T>[] {
  const rows: Readonly<T>[] = [];
  for (const row of assertArray<unknown>(json, label)) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    rows.push(Object.freeze(readRow(row as Record<string, unknown>)));
  }
  return Object.freeze(rows);
}

function validateStringList(json: unknown, label: string): readonly string[] {
  return Object.freeze([...assertStringArray(json, label)]);
}

export type ApiRecordRow = {
  age_category: string | null;
  gender: string | null;
  weight_class: string | null;
  record_type: string | null;
  snatch_record: number | null;
  cj_record: number | null;
  total_record: number | null;
};

export type ApiStandardRow = {
  age_category: string | null;
  gender: string | null;
  weight_class: string | null;
  standard_a: number | null;
  standard_b: number | null;
};

export type ApiQualifyingTotalRow = {
  event_name: string | null;
  age_category: string | null;
  gender: string | null;
  weight_class: string | null;
  qualifying_total: number | null;
};

export type ApiIntlRankingRow = {
  meet: string | null;
  ranking: number | null;
  name: string | null;
  weight_class: string | null;
  total: number | null;
  percent_a: number | null;
  gender: string | null;
  age_category: string | null;
};

export type ApiNationalRankingRow = {
  name: string | null;
  total: number | null;
};

export type ApiWsoRecordRow = {
  wso: string | null;
  age_category: string | null;
  gender: string | null;
  weight_class: string | null;
  snatch_record: number | null;
  cj_record: number | null;
  total_record: number | null;
};

export type ApiAdaptiveRecordRow = {
  weight_class: string | null;
  snatch: number | null;
  cj: number | null;
  total: number | null;
};

function validateApiRecords(json: unknown): readonly Readonly<ApiRecordRow>[] {
  return validateRows(json, '/data/records', (row) => ({
    age_category: nullableString(row.age_category),
    gender: nullableString(row.gender),
    weight_class: nullableString(row.weight_class),
    record_type: nullableString(row.record_type),
    snatch_record: nullableNumber(row.snatch_record),
    cj_record: nullableNumber(row.cj_record),
    total_record: nullableNumber(row.total_record),
  }));
}

function validateApiStandards(json: unknown): readonly Readonly<ApiStandardRow>[] {
  return validateRows(json, '/data/standards', (row) => ({
    age_category: nullableString(row.age_category),
    gender: nullableString(row.gender),
    weight_class: nullableString(row.weight_class),
    standard_a: nullableNumber(row.standard_a),
    standard_b: nullableNumber(row.standard_b),
  }));
}

function validateApiQualifyingTotals(
  json: unknown,
): readonly Readonly<ApiQualifyingTotalRow>[] {
  return validateRows(json, '/data/qualifying-totals', (row) => ({
    event_name: nullableString(row.event_name),
    age_category: nullableString(row.age_category),
    gender: nullableString(row.gender),
    weight_class: nullableString(row.weight_class),
    qualifying_total: nullableNumber(row.qualifying_total),
  }));
}

function validateApiIntlRankings(json: unknown): readonly Readonly<ApiIntlRankingRow>[] {
  return validateRows(json, '/data/intl-rankings', (row) => ({
    meet: nullableString(row.meet),
    ranking: nullableNumber(row.ranking),
    name: nullableString(row.name),
    weight_class: nullableString(row.weight_class),
    total: nullableNumber(row.total),
    percent_a: nullableNumber(row.percent_a),
    gender: nullableString(row.gender),
    age_category: nullableString(row.age_category),
  }));
}

function validateApiNationalRankings(
  json: unknown,
): readonly Readonly<ApiNationalRankingRow>[] {
  return validateRows(json, '/data/nat-rankings', (row) => ({
    name: nullableString(row.name),
    total: nullableNumber(row.total),
  }));
}

function validateApiWsoRecords(json: unknown): readonly Readonly<ApiWsoRecordRow>[] {
  return validateRows(json, '/data/wso/records', (row) => ({
    wso: nullableString(row.wso),
    age_category: nullableString(row.age_category),
    gender: nullableString(row.gender),
    weight_class: nullableString(row.weight_class),
    snatch_record: nullableNumber(row.snatch_record),
    cj_record: nullableNumber(row.cj_record),
    total_record: nullableNumber(row.total_record),
  }));
}

function validateApiAdaptiveRecords(
  json: unknown,
): readonly Readonly<ApiAdaptiveRecordRow>[] {
  return validateRows(json, '/data/adaptive', (row) => ({
    weight_class: nullableString(row.weight_class),
    snatch: nullableNumber(row.snatch),
    cj: nullableNumber(row.cj),
    total: nullableNumber(row.total),
  }));
}

export function fetchApiRecords(): Promise<readonly Readonly<ApiRecordRow>[]> {
  return getRevalidated('/data/records', 'reference:records', {}, validateApiRecords);
}

export function fetchApiStandards(): Promise<readonly Readonly<ApiStandardRow>[]> {
  return getRevalidated('/data/standards', 'reference:standards', {}, validateApiStandards);
}

export function fetchApiQualifyingTotals(): Promise<readonly Readonly<ApiQualifyingTotalRow>[]> {
  return getRevalidated(
    '/data/qualifying-totals',
    'reference:qualifyingTotals',
    {},
    validateApiQualifyingTotals,
  );
}

export function fetchApiIntlRankings(): Promise<readonly Readonly<ApiIntlRankingRow>[]> {
  return getRevalidated('/data/intl-rankings', 'reference:intlRankings', {}, validateApiIntlRankings);
}

export function fetchApiNationalRankings(
  federation: string,
  ageCategory: string,
): Promise<readonly Readonly<ApiNationalRankingRow>[]> {
  return getRevalidated(
    '/data/nat-rankings',
    'reference:nationalRankings',
    { federation, ageCategory },
    validateApiNationalRankings,
  );
}

export function fetchApiWsoRecords(
  wso: string,
  ageCategory?: string,
  gender?: string,
): Promise<readonly Readonly<ApiWsoRecordRow>[]> {
  return getRevalidated(
    '/data/wso/records',
    'reference:wsoRecords',
    { wso, ageCategory, gender },
    validateApiWsoRecords,
  );
}

export function fetchApiAdaptiveRecords(
  gender: string,
  excludeFederation: string,
): Promise<readonly Readonly<ApiAdaptiveRecordRow>[]> {
  return getRevalidated(
    '/data/adaptive',
    'reference:adaptiveRecords',
    { excludeFederation, gender },
    validateApiAdaptiveRecords,
  );
}

// The string lists are returned as a copy: callers sort and splice them.

export async function fetchApiWsoList(): Promise<string[]> {
  return [
    ...(await getRevalidated('/data/wso/', 'reference:wsoList', {}, (json) =>
      validateStringList(json, '/data/wso/'),
    )),
  ];
}

export async function fetchApiWsoAgeGroups(wso: string): Promise<string[]> {
  return [
    ...(await getRevalidated('/data/wso/age-groups', 'reference:wsoAgeGroups', { wso }, (json) =>
      validateStringList(json, '/data/wso/age-groups'),
    )),
  ];
}

export async function fetchApiClubNames(): Promise<string[]> {
  return [
    ...(await getRevalidated('/clubs', 'reference:clubs', {}, (json) =>
      validateStringList(json, '/clubs'),
    )),
  ];
}

/** A club's entries across meets; `lib/database/fetch-club-stats` validates the rows. */
export async function fetchApiClubAthletes(club: string): Promise<unknown[]> {
  return assertArray<unknown>(await readQuery('/clubs/athletes', 'reference:clubAthletes', { club }), '/clubs/athletes');
}

/** A club's results at one meet; `lib/database/fetch-club-stats` validates the shape. */
export async function fetchApiClubMeetStats(club: string, meet: string): Promise<Record<string, unknown>> {
  const response = await readQuery('/clubs/meet-stats', 'reference:clubMeetStats', { club, meet });
  assertObject(response, '/clubs/meet-stats');
  return response;
}

function mapApiSavedSession(row: unknown, index: number): ApiSavedSession {
  const obj = assertHasFields(row, `/users/me/saved-sessions[${index}]`, [
    'session_id',
    'meet',
    'session_number',
    'platform',
    'athlete_names',
    'updated_at',
  ]);
  if (typeof obj.session_id !== 'string' || obj.session_id.length === 0) {
    throw new Error(`/users/me/saved-sessions[${index}] has invalid session_id`);
  }
  if (typeof obj.meet !== 'string' || obj.meet.length === 0) {
    throw new Error(`/users/me/saved-sessions[${index}] has invalid meet`);
  }
  if (typeof obj.session_number !== 'number' || !Number.isFinite(obj.session_number)) {
    throw new Error(`/users/me/saved-sessions[${index}] has invalid session_number`);
  }
  if (typeof obj.platform !== 'string') {
    throw new Error(`/users/me/saved-sessions[${index}] has invalid platform`);
  }
  if (!Array.isArray(obj.athlete_names) || !obj.athlete_names.every((name) => typeof name === 'string')) {
    throw new Error(`/users/me/saved-sessions[${index}] has invalid athlete_names`);
  }
  if (typeof obj.updated_at !== 'number' || !Number.isFinite(obj.updated_at)) {
    throw new Error(`/users/me/saved-sessions[${index}] has invalid updated_at`);
  }
  return {
    session_id: obj.session_id,
    meet: obj.meet,
    session_number: obj.session_number,
    platform: obj.platform,
    weight_class: typeof obj.weight_class === 'string' ? obj.weight_class : null,
    start_time: typeof obj.start_time === 'string' ? obj.start_time : null,
    date: typeof obj.date === 'string' ? obj.date : null,
    notes: typeof obj.notes === 'string' ? obj.notes : null,
    athlete_names: obj.athlete_names,
    updated_at: obj.updated_at,
  };
}

function userCall(
  path: string,
  fn: string,
  kind: ApiCall['kind'],
  token: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  return request({ path, fn, kind, args, token });
}

export async function fetchSavedSessions(token: string): Promise<ApiSavedSession[]> {
  const authToken = requireToken(token, 'fetchSavedSessions');
  const response = await userCall('/users/me/saved-sessions', 'users:savedSessions', 'query', authToken);
  assertObject(response, '/users/me/saved-sessions');
  const sessions = assertArray<unknown>(
    (response as { sessions?: unknown }).sessions,
    '/users/me/saved-sessions.sessions',
  );
  return sessions.map(mapApiSavedSession);
}

export async function putSavedSession(
  token: string,
  sessionId: string,
  body: {
    meet: string;
    session_number: number;
    platform: string;
    weight_class?: string;
    start_time?: string;
    date?: string;
    notes?: string;
    athlete_names?: string[];
  },
): Promise<{ session_id: string; updated_at: number }> {
  const authToken = requireToken(token, 'putSavedSession');
  const row = assertHasFields(
    await userCall(`/users/me/saved-sessions/${sessionId}`, 'users:putSavedSession', 'mutation', authToken, {
      sessionId,
      ...body,
    }),
    'putSavedSession',
    ['session_id', 'updated_at'],
  );
  if (typeof row.session_id !== 'string' || typeof row.updated_at !== 'number') {
    throw new Error('putSavedSession returned an invalid payload');
  }
  return { session_id: row.session_id, updated_at: row.updated_at };
}

export async function deleteSavedSession(
  token: string,
  sessionId: string,
): Promise<{ deleted: boolean }> {
  const authToken = requireToken(token, 'deleteSavedSession');
  const row = await userCall(
    `/users/me/saved-sessions/${sessionId}`,
    'users:deleteSavedSession',
    'mutation',
    authToken,
    { sessionId },
  );
  // The outbox drops the pending delete once this resolves, so an
  // acknowledgement that is not `{ deleted: bool }` fails here and the delete
  // stays queued (a retry is idempotent).
  const ack = assertHasFields(row, 'deleteSavedSession', ['deleted']);
  if (typeof ack.deleted !== 'boolean') {
    throw new Error('deleteSavedSession returned an invalid payload');
  }
  return { deleted: ack.deleted };
}

export async function deleteSavedSessions(
  token: string,
  meet?: string,
): Promise<{ deleted_count: number }> {
  const authToken = requireToken(token, 'deleteSavedSessions');
  const row = await userCall('/users/me/saved-sessions', 'users:deleteSavedSessions', 'mutation', authToken, {
    meet,
  });
  const ack = assertHasFields(row, 'deleteSavedSessions', ['deleted_count']);
  if (typeof ack.deleted_count !== 'number' || !Number.isFinite(ack.deleted_count)) {
    throw new Error('deleteSavedSessions returned an invalid payload');
  }
  return { deleted_count: ack.deleted_count };
}

export async function fetchUserPreferences(
  token: string,
): Promise<{ auto_unsave_started_sessions: boolean }> {
  const authToken = requireToken(token, 'fetchUserPreferences');
  const row = assertHasFields(
    await userCall('/users/me/preferences', 'users:preferences', 'query', authToken),
    '/users/me/preferences',
    ['auto_unsave_started_sessions'],
  );
  if (typeof row.auto_unsave_started_sessions !== 'boolean') {
    throw new Error('/users/me/preferences.auto_unsave_started_sessions expected a boolean');
  }
  return { auto_unsave_started_sessions: row.auto_unsave_started_sessions };
}

export async function patchAutoUnsavePreference(
  token: string,
  enabled: boolean,
): Promise<{ auto_unsave_started_sessions: boolean }> {
  const authToken = requireToken(token, 'patchAutoUnsavePreference');
  const row = assertHasFields(
    await userCall('/users/me/preferences/auto-unsave', 'users:setAutoUnsave', 'mutation', authToken, {
      enabled,
    }),
    '/users/me/preferences/auto-unsave',
    ['auto_unsave_started_sessions'],
  );
  if (typeof row.auto_unsave_started_sessions !== 'boolean') {
    throw new Error('/users/me/preferences/auto-unsave.auto_unsave_started_sessions expected a boolean');
  }
  return { auto_unsave_started_sessions: row.auto_unsave_started_sessions };
}
