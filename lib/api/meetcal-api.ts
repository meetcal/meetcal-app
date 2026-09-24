import { canonicalizePlatform, filterSessionAthletes, isLiftResult } from '@/lib/athletes';
import { LiftResult, Platform, SupabaseLiftResult } from '@/data/types/athletes';
import {
  Meet,
  MeetName,
  timezoneOffsets,
  USTimeZoneIdentifier,
} from '@/data/types/meet';
import type { Schedule } from '@/types/schedule';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
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

const DEFAULT_API_BASE_URL = 'https://api.meetcal.app';
const DEFAULT_TIMEOUT_MS = 10000;

// Sent on every request so the API can gate stricter validation on the app
// version instead of flipping behaviour for builds already in the field. The
// backend threshold lives in meetcal-backend `app/src/common/client.rs`.
export const CLIENT_VERSION_HEADER = 'X-MeetCal-App';

/**
 * The version declared on every request. `expoConfig.version` is empty in
 * some release builds (an OTA manifest without a version, a bare workflow), and
 * an omitted header makes the API treat a 6.2.0+ client as a legacy one. The
 * native bundle version is what the store built, so it is the fallback.
 */
export function resolveAppVersion(
  expoVersion: string | null | undefined,
  nativeVersion: string | null | undefined,
): string {
  const expo = typeof expoVersion === 'string' ? expoVersion.trim() : '';
  if (expo) return expo;
  const native = typeof nativeVersion === 'string' ? nativeVersion.trim() : '';
  return native;
}

export const APP_VERSION: string = resolveAppVersion(
  Constants.expoConfig?.version,
  Application.nativeApplicationVersion,
);
const SLOW_API_LOG_THRESHOLD_MS = 500;
/**
 * Names per request for the name-list endpoints whose rows are large: full
 * history (`/lifting-results/by-names`) and the two-year window (`/recent`).
 * One history batch is held in memory while it is written out, so this also
 * bounds the offline download's peak memory (see `meet-manager`).
 */
export const NAMES_QUERY_CHUNK_SIZE = 40;
/**
 * Names per request where each name answers with a handful of numbers or rows:
 * `/lifting-results/bests` (three bests per name) and `latest_only` history
 * (one meet per name). Equal to the API's `MAX_NAME_LIST_LEN` (100), which is
 * not version-gated; one more name is a `400`. Sorting a 1,562-athlete
 * national start list by best total was 40 sequential requests at 40 names;
 * it is 16 at 100.
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

function parseResponseJson(method: string, path: string, text: string): unknown {
  if (!text) {
    throw new Error(`${method} ${path} returned an empty body`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${method} ${path} returned invalid JSON`);
  }
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

export const MEETCAL_API_BASE_URL =
  process.env.EXPO_PUBLIC_MEETCAL_API_URL || DEFAULT_API_BASE_URL;

type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | (string | number | boolean | null | undefined)[];

type RequestOptions = {
  token?: string | null;
  timeoutMs?: number;
  /** Sent as `If-None-Match`; a `304` then resolves instead of throwing. */
  ifNoneMatch?: string | null;
};

type RawResponse = {
  status: number;
  text: string;
  etag: string | null;
};

export class MeetCalApiError extends Error {
  status: number;
  body: string;
  /**
   * The response's `Retry-After`, in seconds, when it carried a usable one
   * (a delay in seconds or an HTTP-date). Callers that retry once (the
   * history download) wait this long, capped on their side.
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

/** A `Retry-After` header as non-negative seconds, or undefined when unusable. */
export function parseRetryAfterSeconds(
  header: string | null | undefined,
  now: number = Date.now(),
): number | undefined {
  if (typeof header !== 'string' || header.trim() === '') return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds : undefined;
  const at = Date.parse(header);
  if (!Number.isFinite(at)) return undefined;
  return Math.max(0, (at - now) / 1000);
}

/**
 * Server clock, as seen in the last response's `Date` header.
 *
 * Destructive housekeeping — auto-unsaving started sessions (server DELETE
 * included), clearing a downloaded meet once it has ended — used to trust
 * `Date.now()`. A device clock a few hours ahead deleted today's sessions
 * before they began; a day ahead wiped the downloaded meet at the next
 * refresh tick, offline included. Those decisions now use the server's
 * clock, sampled from every response and never persisted: a fresh process
 * has no sample until it has talked to the API, and callers skip rather
 * than guess (late is harmless, early is data loss).
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

let serverClockSample: ServerClockSample | null = null;

function recordServerClock(dateHeader: string | null | undefined): void {
  if (typeof dateHeader !== 'string' || dateHeader === '') return;
  const serverNow = Date.parse(dateHeader);
  if (!Number.isFinite(serverNow)) return;
  const deviceNow = Date.now();
  // `Date` has one-second resolution and is stamped before the body streams;
  // the latest sample is the closest to now, so it replaces any older one.
  serverClockSample = { skewMs: serverNow - deviceNow, sampledAt: deviceNow };
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
 * Null when this process has not heard from the API yet.
 */
export function getTrustedNow(): Date | null {
  if (!serverClockSample) return null;
  return new Date(Date.now() + serverClockSample.skewMs);
}

/** Forgets the clock sample. For tests. */
export function resetServerClockForTests(): void {
  serverClockSample = null;
}

/**
 * The request did not finish inside its timeout.
 *
 * A distinct class rather than a plain `Error`, because "the request timed
 * out" and "the request failed" get different treatment: the meets list falls
 * back to cache and throttles the log for a timeout, while a real failure is
 * always reported. Callers used to tell them apart with
 * `error.message.includes('fetchMeets timed out')` — which never matched,
 * since the thrown message is `GET /meets timed out after 10000ms`, so the
 * timeout branch was dead and every timeout logged as an error.
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

/**
 * The *server* gave up before we did. The API's request ceiling answers with
 * `408 {"error":"timeout"}` (a gateway may send `504`), so without this it
 * surfaced as a `MeetCalApiError` ("failed with 408") and skipped every
 * caller's timeout branch. A subclass so
 * `instanceof MeetCalApiTimeoutError` keeps matching; `status` is kept for
 * logs.
 */
export class MeetCalApiServerTimeoutError extends MeetCalApiTimeoutError {
  status: number;

  constructor(method: string, path: string, timeoutMs: number, status: number) {
    super(method, path, timeoutMs, `${method} ${path} timed out server-side (${status})`);
    this.name = 'MeetCalApiServerTimeoutError';
    this.status = status;
  }
}

/** Statuses that mean "the request ran out of time", not "the request was bad". */
const SERVER_TIMEOUT_STATUSES: ReadonlySet<number> = new Set([408, 504]);

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

export function buildApiUrl(
  path: string,
  query?: Record<string, QueryValue>,
): string {
  const base = MEETCAL_API_BASE_URL.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const params = new URLSearchParams();

  Object.entries(query || {}).forEach(([key, value]) => {
    if (value == null) return;
    const values = Array.isArray(value) ? [value.filter((item) => item != null).join(',')] : [value];
    values.forEach((item) => {
      if (item == null) return;
      params.append(key, String(item));
    });
  });

  const qs = params.toString();
  return `${base}${normalizedPath}${qs ? `?${qs}` : ''}`;
}

async function requestRaw(
  method: string,
  path: string,
  query?: Record<string, QueryValue>,
  body?: unknown,
  options?: RequestOptions,
): Promise<RawResponse> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const url = buildApiUrl(path, query);
  const startedAt =
    typeof performance !== 'undefined' ? performance.now() : Date.now();
  let status: number | null = null;

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (APP_VERSION) {
    headers[CLIENT_VERSION_HEADER] = APP_VERSION;
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options?.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options?.ifNoneMatch) {
    headers['If-None-Match'] = options.ifNoneMatch;
  }

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    status = response.status;
    const etag = response.headers?.get?.('etag') ?? null;
    recordServerClock(response.headers?.get?.('date'));

    if (status === 304 && options?.ifNoneMatch) {
      return { status, text: '', etag };
    }

    const text = await response.text();

    if (SERVER_TIMEOUT_STATUSES.has(response.status)) {
      throw new MeetCalApiServerTimeoutError(method, path, timeoutMs, response.status);
    }

    if (!response.ok) {
      throw new MeetCalApiError(
        `${method} ${path} failed with ${response.status}`,
        response.status,
        text,
        parseRetryAfterSeconds(response.headers?.get?.('retry-after')),
      );
    }

    return { status, text, etag };
  } catch (error) {
    if (error instanceof MeetCalApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new MeetCalApiTimeoutError(method, path, timeoutMs);
    }
    throw error;
  } finally {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      const elapsedMs = Math.round(
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) -
          startedAt,
      );
      if (elapsedMs >= SLOW_API_LOG_THRESHOLD_MS) {
        console.info('[perf] slow api request', {
          elapsedMs,
          method,
          path,
          status,
          url,
        });
      }
    }
    clearTimeout(timeoutId);
  }
}

/**
 * Parsed JSON as `unknown`. There is deliberately no type parameter: a
 * `requestJson<T>` let a caller's annotation (`const rows: Row[] = await
 * getJson(...)`) infer `T` and cast past `JSON.parse` unchecked. Callers narrow
 * with `assertArray` / `assertHasFields` / a validator.
 */
async function requestJson(
  method: string,
  path: string,
  query?: Record<string, QueryValue>,
  body?: unknown,
  options?: RequestOptions,
): Promise<unknown> {
  const { text } = await requestRaw(method, path, query, body, options);
  return parseResponseJson(method, path, text);
}

const validatorCache = new ValidatorCache(HTTP_VALIDATOR_CACHE_LIMIT);

/** Forgets every remembered `ETag`/body pair. For tests and sign-out style resets. */
export function clearHttpValidatorCache(): void {
  validatorCache.clear();
}

function sameEtag(a: string, b: string): boolean {
  const strip = (tag: string) => (tag.startsWith('W/') ? tag.slice(2) : tag);
  return strip(a) === strip(b);
}

/**
 * Conditional GET for endpoints that send a strong `ETag` (see
 * `lib/api/http-cache.ts`). Sends the last tag for this exact URL as
 * `If-None-Match`; a `304` resolves to the value `validate` accepted when that
 * tag was stored, so shape checks never get skipped, only repeated work.
 *
 * The remembered entry is read once, before the request, so an eviction while
 * the request is in flight cannot strand a `304` without a body; if a
 * concurrent request replaced that entry meanwhile, the `304` resolves to the
 * replacement instead, so a slow revalidation never returns data older than
 * what a faster one already stored. A `304` whose
 * own `ETag` names a different tag than we sent is not trusted: the entry is
 * dropped and the request is retried once without a validator (where a `304`
 * is an error, as it always was). Every non-2xx/304 status throws exactly as
 * `getJson` does.
 *
 * React Native's own URL cache does not get in the way: iOS switches a request
 * carrying `If-None-Match` to `NSURLRequestReloadIgnoringLocalCacheData`
 * (RCTNetworking) and OkHttp skips its cache for a request with conditions, so
 * the `304` reaches `requestRaw`. Without a validator either one may answer
 * from its own store after revalidating, which still arrives as a `200` body.
 */
async function getJsonRevalidated<T>(
  path: string,
  query: Record<string, QueryValue> | undefined,
  validate: (json: unknown) => T,
): Promise<T> {
  const url = buildApiUrl(path, query);
  const held = validatorCache.get(url) as ValidatorEntry<T> | undefined;
  let raw = await requestRaw('GET', path, query, undefined, { ifNoneMatch: held?.etag });

  if (raw.status === 304) {
    const answered = usableEtag(raw.etag);
    if (held && (answered == null || sameEtag(answered, held.etag))) {
      const current = validatorCache.get(url) as ValidatorEntry<T> | undefined;
      if (current && current !== held) {
        // A concurrent request stored a newer body while this one was in
        // flight; this 304 only vouches for the older tag, so never publish
        // the superseded value over it.
        return current.value;
      }
      if (current === held) validatorCache.set(url, held); // refresh recency
      return held.value;
    }
    validatorCache.delete(url);
    raw = await requestRaw('GET', path, query);
  }

  const value = validate(parseResponseJson('GET', path, raw.text));
  const etag = usableEtag(raw.etag);
  if (etag) {
    validatorCache.set(url, { etag, value });
  } else {
    validatorCache.delete(url);
  }
  return value;
}

export function getJson(
  path: string,
  query?: Record<string, QueryValue>,
  options?: RequestOptions,
): Promise<unknown> {
  return requestJson('GET', path, query, undefined, options);
}

/**
 * `getJson` for the endpoints that return a bare row array.
 *
 * `getJson<Row[]>(...)` is an unchecked `as T` past a `JSON.parse`: the callers
 * then go straight to `.filter`/`.map`, so an object response (an error
 * envelope, a paging wrapper) fails as `rows.filter is not a function` deep
 * inside a fetcher. Asserting here names the endpoint that misbehaved and keeps
 * boundary validation in one place.
 */
export async function getJsonArray<T>(
  path: string,
  query?: Record<string, QueryValue>,
  options?: RequestOptions,
): Promise<T[]> {
  return assertArray<T>(await getJson(path, query, options), path);
}

/** `getJson` for the endpoints that return a single JSON object. */
export async function getJsonObject<T>(
  path: string,
  query?: Record<string, QueryValue>,
  options?: RequestOptions,
): Promise<T> {
  const response = await getJson(path, query, options);
  assertObject(response, path);
  return response as T;
}

export function postJson(
  path: string,
  body: unknown,
  options?: RequestOptions,
): Promise<unknown> {
  return requestJson('POST', path, undefined, body, options);
}

export function putJson(
  path: string,
  body: unknown,
  options?: RequestOptions,
): Promise<unknown> {
  return requestJson('PUT', path, undefined, body, options);
}

export function patchJson(
  path: string,
  body: unknown,
  options?: RequestOptions,
): Promise<unknown> {
  return requestJson('PATCH', path, undefined, body, options);
}

export function deleteJson(
  path: string,
  query?: Record<string, QueryValue>,
  options?: RequestOptions,
): Promise<unknown> {
  return requestJson('DELETE', path, query, undefined, options);
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

// The three below revalidate with the remembered `ETag`. The cache holds the
// validated API rows, never the mapped app objects, so every caller still gets
// freshly built objects it may mutate.

export async function fetchApiMeets(): Promise<Meet[]> {
  const rows = await getJsonRevalidated('/meets', undefined, validateApiMeets);
  return rows.map((row) => mapApiMeet(row));
}

export async function fetchApiMeetByName(meet: string): Promise<Meet | null> {
  try {
    const row = await getJsonRevalidated('/meets/details', { meet }, validateApiMeetDetails);
    return row ? mapApiMeet(row) : null;
  } catch (error) {
    if (error instanceof MeetCalApiError && error.status === 404) return null;
    throw error;
  }
}

/**
 * @param meetDetails The meet, when the caller already holds it (the cached
 * meets list, the selected meet). Skips the `/meets/details` round trip that
 * otherwise rides alongside every schedule fetch.
 */
export async function fetchApiSchedule(
  meet: MeetName,
  meetDetails?: Meet | null,
): Promise<Schedule> {
  const [resolvedMeet, rows] = await Promise.all([
    meetDetails ? Promise.resolve(meetDetails) : fetchApiMeetByName(meet),
    getJsonRevalidated('/meets/schedule', { meet }, validateApiSchedule),
  ]);
  return mapApiSchedule(rows, resolvedMeet ?? undefined);
}

export async function fetchApiAthletes(meet: MeetName): Promise<LiftResult[]> {
  const rows = assertArray<ApiAthlete>(await getJson('/meets/athletes', { meet }), '/meets/athletes');
  return mapApiAthletes(rows, '/meets/athletes');
}

/**
 * Athletes with their session assignment, optionally narrowed to one session
 * and/or platform.
 *
 * The server's `platform` filter is an exact string compare against the
 * stored `session_platform`. Scrapers store the same title-cased form the app
 * canonicalizes to, but the column is free text and a hand-written row could
 * hold `"RED "`, which `platform=Red` would miss server-side. So when a session
 * number is given the request is narrowed by `session_number` only (a session
 * is a handful of platforms, so the extra rows are cheap) and the platform is
 * matched client-side with the app's one case-insensitive rule. Only a
 * platform-without-session query is sent to the server as is.
 */
export async function fetchApiAthletesWithSession(
  meet: MeetName,
  sessionNumber?: number,
  platform?: string,
): Promise<LiftResult[]> {
  const filterLocally = sessionNumber != null && !!platform;
  const rows = assertArray<ApiAthleteWithSession>(
    await getJson('/meets/athletes-sessions', {
      meet,
      session_number: sessionNumber,
      platform: filterLocally ? undefined : platform,
    }),
    '/meets/athletes-sessions',
  );
  const athletes = mapApiAthletes(rows, '/meets/athletes-sessions');
  return filterLocally ? filterSessionAthletes(athletes, sessionNumber, platform) : athletes;
}

// Clients on 6.2.0+ must always send `cutoff_date`; the defaults below come
// from the one UTC-only cutoff policy in `utils/dateTime.ts`.

export type ResultsByNamesOptions = {
  /**
   * Only the rows from each athlete's most recent meet date (`latest_only`).
   * The API applies it per normalized name (case and whitespace folded).
   */
  latestOnly?: boolean;
};

// Name lists go in a JSON body so a name containing a comma stays one name.
// Chunking keeps each request under the API's name-list cap.
export async function fetchApiResultsByNames(
  names: string[],
  options: ResultsByNamesOptions = {},
): Promise<SupabaseLiftResult[]> {
  if (names.length === 0) return [];
  const rows: SupabaseLiftResult[] = [];
  const chunkSize = options.latestOnly ? SMALL_ROWS_NAMES_CHUNK_SIZE : NAMES_QUERY_CHUNK_SIZE;
  for (const chunk of chunkValues(names, chunkSize)) {
    const body = options.latestOnly ? { names: chunk, latest_only: true } : { names: chunk };
    const part = assertArray<ApiLiftingResult>(
      await postJson('/lifting-results/by-names', body),
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
      await postJson('/lifting-results/recent', { names: chunk, cutoff_date: cutoffDate }),
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
  const row = assertHasFields(await getJson('/lifting-results/year', {
    name,
    cutoff_date: cutoffDate,
  }), '/lifting-results/year', ['best_snatch', 'best_cj', 'best_total']) as ApiYearBests;
  return [mapApiYearBests(row)];
}

export async function fetchApiYearBestsByNames(
  names: string[],
  cutoffDate: string = getHistoryCutoffDate(YEAR_BESTS_YEARS),
): Promise<Record<string, ReturnType<typeof mapApiYearBests>>> {
  if (names.length === 0) return {};
  const merged: Record<string, ReturnType<typeof mapApiYearBests>> = {};
  for (const chunk of chunkValues(names, SMALL_ROWS_NAMES_CHUNK_SIZE)) {
    const response = await postJson('/lifting-results/bests', {
      names: chunk,
      cutoff_date: cutoffDate,
    });
    assertObject(response, '/lifting-results/bests');
    for (const [name, row] of Object.entries(response)) {
      merged[name] = mapApiYearBests(
        assertHasFields(row, `/lifting-results/bests.${name}`, [
          'best_snatch',
          'best_cj',
          'best_total',
        ]) as ApiYearBests,
      );
    }
  }
  return merged;
}

export async function searchApi(query: string, startDate?: string, endDate?: string) {
  const response = assertHasFields(await getJson('/search', {
    query,
    start_date: startDate,
    end_date: endDate,
  }), '/search', ['matched_name', 'suggestions', 'results']);
  const suggestions = assertStringArray(response.suggestions, '/search.suggestions');
  const results = assertArray<ApiLiftingResult>(response.results, '/search.results');
  return {
    matchedName: typeof response.matched_name === 'string' ? response.matched_name : null,
    suggestions,
    results: results.map(mapApiLiftingResult),
  };
}

/**
 * The API's own request ceiling is 15 s (it answers `408` past that), so a
 * client timeout above it only ever waited for the server's 408. Kept below
 * the ceiling so the client-side abort still fires first on a dead link.
 */
export const MEET_PACKAGE_TIMEOUT_MS = 14000;
const MEET_PACKAGE_FIELDS = ['meet', 'schedule', 'athletes', 'meet_results'];
/**
 * Package sections the app actually ingests. `recent_results_by_name` and
 * `attempt_estimates` were requested, decoded and thrown away — the download
 * pulls full history from `/lifting-results/by-names` instead. Older backends
 * ignore the parameter and send everything, which the parser tolerates.
 */
export const MEET_PACKAGE_INCLUDE = ['year_bests'] as const;

export type MeetPackageFetch =
  | { status: 'fresh'; etag: string | null; package: ApiMeetPackage }
  | { status: 'not_modified' };

/**
 * Fetches the meet package, revalidating with `If-None-Match` when the caller
 * still holds the previous `ETag`. A `304` means the package the caller already
 * decomposed into local storage is byte-identical to what the API would send.
 */
export async function fetchApiMeetPackageConditional(
  meet: MeetName,
  historyCutoffDate?: string,
  ifNoneMatch?: string | null,
): Promise<MeetPackageFetch> {
  const raw = await requestRaw(
    'GET',
    '/meets/package',
    {
      meet,
      history_cutoff_date: historyCutoffDate,
      include: [...MEET_PACKAGE_INCLUDE],
    },
    undefined,
    { timeoutMs: MEET_PACKAGE_TIMEOUT_MS, ifNoneMatch },
  );
  if (raw.status === 304) {
    return { status: 'not_modified' };
  }
  const parsed = parseResponseJson('GET', '/meets/package', raw.text);
  const pkg = assertHasFields(parsed, '/meets/package', MEET_PACKAGE_FIELDS);
  assertObject(pkg.meet, '/meets/package.meet');
  assertArray(pkg.schedule, '/meets/package.schedule');
  assertArray(pkg.athletes, '/meets/package.athletes');
  assertArray(pkg.meet_results, '/meets/package.meet_results');
  return { status: 'fresh', etag: raw.etag, package: pkg as ApiMeetPackage };
}

// ---------------------------------------------------------------------------
// Reference data (`/data/*`, `/clubs`).
//
// These tables change a few times a season, the screens that show them refetch
// on every visit, and the API tags them with a strong `ETag` (or will: a route
// without one just never stores a validator), so they all go through
// `getJsonRevalidated`. What the cache keeps, and what a `304` hands back, is
// the output of the validators below: fresh, frozen objects that carry exactly
// the declared fields. Callers only read them — they filter/map into their own
// structures — and the freeze means an accidental in-place edit can never
// rewrite what the next `304` returns.
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
  return getJsonRevalidated('/data/records', undefined, validateApiRecords);
}

export function fetchApiStandards(): Promise<readonly Readonly<ApiStandardRow>[]> {
  return getJsonRevalidated('/data/standards', undefined, validateApiStandards);
}

export function fetchApiQualifyingTotals(): Promise<readonly Readonly<ApiQualifyingTotalRow>[]> {
  return getJsonRevalidated('/data/qualifying-totals', undefined, validateApiQualifyingTotals);
}

export function fetchApiIntlRankings(): Promise<readonly Readonly<ApiIntlRankingRow>[]> {
  return getJsonRevalidated('/data/intl-rankings', undefined, validateApiIntlRankings);
}

export function fetchApiNationalRankings(
  federation: string,
  ageCategory: string,
): Promise<readonly Readonly<ApiNationalRankingRow>[]> {
  return getJsonRevalidated(
    '/data/nat-rankings',
    { federation, age_category: ageCategory },
    validateApiNationalRankings,
  );
}

export function fetchApiWsoRecords(
  wso: string,
  ageCategory?: string,
  gender?: string,
): Promise<readonly Readonly<ApiWsoRecordRow>[]> {
  return getJsonRevalidated(
    '/data/wso/records',
    { wso, age_category: ageCategory, gender },
    validateApiWsoRecords,
  );
}

export function fetchApiAdaptiveRecords(
  gender: string,
  excludeFederation: string,
): Promise<readonly Readonly<ApiAdaptiveRecordRow>[]> {
  return getJsonRevalidated(
    '/data/adaptive',
    { exclude_federation: excludeFederation, gender },
    validateApiAdaptiveRecords,
  );
}

// The string lists are returned as a copy: callers sort and splice them.

export async function fetchApiWsoList(): Promise<string[]> {
  return [
    ...(await getJsonRevalidated('/data/wso/', undefined, (json) =>
      validateStringList(json, '/data/wso/'),
    )),
  ];
}

export async function fetchApiWsoAgeGroups(wso: string): Promise<string[]> {
  return [
    ...(await getJsonRevalidated('/data/wso/age-groups', { wso }, (json) =>
      validateStringList(json, '/data/wso/age-groups'),
    )),
  ];
}

export async function fetchApiClubNames(): Promise<string[]> {
  return [
    ...(await getJsonRevalidated('/clubs', undefined, (json) =>
      validateStringList(json, '/clubs'),
    )),
  ];
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

export async function fetchSavedSessions(token: string): Promise<ApiSavedSession[]> {
  const authToken = requireToken(token, 'fetchSavedSessions');
  const response = await getJson('/users/me/saved-sessions', undefined, { token: authToken });
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
    await putJson(`/users/me/saved-sessions/${encodeURIComponent(sessionId)}`, body, {
      token: authToken,
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
  const row = await deleteJson(
    `/users/me/saved-sessions/${encodeURIComponent(sessionId)}`,
    undefined,
    { token: authToken },
  );
  // The outbox drops the pending delete once this resolves, so an
  // acknowledgement that is not the backend's `{ deleted: bool }` fails here
  // and the delete stays queued (a retry is idempotent).
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
  const row = await deleteJson('/users/me/saved-sessions', { meet }, { token: authToken });
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
    await getJson('/users/me/preferences', undefined, { token: authToken }),
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
    await patchJson('/users/me/preferences/auto-unsave', { enabled }, { token: authToken }),
    '/users/me/preferences/auto-unsave',
    ['auto_unsave_started_sessions'],
  );
  if (typeof row.auto_unsave_started_sessions !== 'boolean') {
    throw new Error('/users/me/preferences/auto-unsave.auto_unsave_started_sessions expected a boolean');
  }
  return { auto_unsave_started_sessions: row.auto_unsave_started_sessions };
}
