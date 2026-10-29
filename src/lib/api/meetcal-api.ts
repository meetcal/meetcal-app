import { canonicalizePlatform, filterSessionAthletes, isLiftResult, normalizeAthleteName } from '@/lib/athletes';
import { LiftResult, Platform, SupabaseLiftResult } from '@/data/types/athletes';
import { Meet, MeetName } from '@/data/types/meet';
import type { Schedule } from '@/types/schedule';
import {
  ATTEMPT_HISTORY_YEARS,
  getHistoryCutoffDate,
  getTimeZoneAbbreviation,
  meetCalendarDateAnchor,
  YEAR_BESTS_YEARS,
} from '@/utils/dateTime';
import {
  convertZonedLocalToUTC,
  getOffsetMinutesAtInstant,
  isValidTimeZone,
  parseClockTime,
} from '@/utils/timezone';
import {
  HTTP_VALIDATOR_CACHE_LIMIT,
  usableEtag,
  ValidatorCache,
  type ValidatorEntry,
} from '@/lib/api/http-cache';
import { accessPassFor, wantsAccessPass, type AccessPass } from '@/lib/api/premium-queries';
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
 * Meet dates are calendar dates with no time. The meet's offset and zone label
 * on a date are read at this wall-clock time *in the meet's zone*: a fixed UTC
 * hour lands on another calendar day somewhere (16:00 UTC is already tomorrow
 * in Tokyo), and noon is clear of every DST change.
 */
const MEET_DATE_OFFSET_PROBE_TIME = '12:00';
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

/** Midday on the meet's calendar date `dateIso`, in the meet's zone; now when it is not a date. */
function instantForMeetDate(dateIso: string | null | undefined, timeZone: string): Date {
  const [datePart] = typeof dateIso === 'string' ? dateIso.split('T') : [''];
  try {
    return convertZonedLocalToUTC(datePart ?? '', MEET_DATE_OFFSET_PROBE_TIME, timeZone);
  } catch {
    return new Date();
  }
}

/**
 * Deliberately falls back rather than throwing: a meet with an unrecognised
 * `time_zone` still has a name, a venue and a schedule, and rejecting it here
 * would drop the whole `/meets` list over one bad row. The fallback is not
 * silent though — every displayed time for that meet will be hours off, and
 * this is the only place that can say why.
 */
const FALLBACK_TIME_ZONE = 'America/New_York';

/**
 * Any IANA zone the device's `Intl` knows is the meet's real zone, US or not
 * ("Asia/Tokyo", "Australia/Sydney"). A blank zone (the server could not tell
 * it) or one the device cannot read falls back, with a warning, and is flagged.
 */
function resolveTimeZoneIdentifier(
  value: string,
): { identifier: string; known: boolean } {
  if (isValidTimeZone(value)) {
    return { identifier: value, known: true };
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
 * Server clock, as sampled from the `Date` header of a `system:ping` answer
 * (a constant query, so always a cache hit; see `serverClockMs`).
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
 * How long `awaitServerClock` waits for a sample in flight. The first
 * request of the process used to wait this long for its sample before
 * handing back data that had already arrived, which delayed the first
 * schedule on every cold start; now only the decisions that want the
 * server's clock right after a request wait, and only for this long.
 */
export const SERVER_CLOCK_DECISION_GRACE_MS = 2000;

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

/**
 * The clock sample's request. App bundles before this one called the
 * `system:serverTime` mutation instead, which runs (and bills) every time.
 */
export const SERVER_CLOCK_CALL: ApiCall = { path: '/clock', fn: 'system:ping', kind: 'clock', args: {} };

let serverClockSample: ServerClockSample | null = null;
let serverClockInFlight: Promise<void> | null = null;

/**
 * Asks the server for its clock and records the skew against the midpoint of
 * the round trip. Failures are swallowed: the sample is a hint, and the
 * request it rides alongside reports its own errors.
 */
function sampleServerClock(): Promise<void> {
  if (serverClockInFlight) return serverClockInFlight;
  const sentAt = Date.now();
  const sample = callApi(SERVER_CLOCK_CALL)
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
  return serverClockInFlight;
}

/**
 * Takes a new server clock sample (or joins the one in flight) and returns
 * the latest sample once it settles. For a decision that needs the server's
 * time now, not whenever the last request happened to sample it (the prune of
 * started sessions). Bounded by `SERVER_CLOCK_SAMPLE_TIMEOUT_MS`.
 */
export async function refreshServerClock(): Promise<ServerClockSample | null> {
  await sampleServerClock();
  return serverClockSample;
}

/**
 * The server clock sample, waiting up to `maxWaitMs` for one when this
 * process has none yet (joining the sample in flight, or starting one).
 * Null when none arrives in time (offline, a dropped connection). For a
 * decision made right after a request that wants the server's clock (is the
 * stored meet over?) now that requests no longer wait for their sample.
 */
export async function awaitServerClock(
  maxWaitMs: number = SERVER_CLOCK_DECISION_GRACE_MS,
): Promise<ServerClockSample | null> {
  if (serverClockSample) return serverClockSample;
  await waitAtMost(sampleServerClock(), maxWaitMs);
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
  return call.kind === 'mutation' || call.kind === 'action' ? 'POST' : 'GET';
}

/**
 * One call through the transport, with the client's timeout, the server clock
 * sample, and the error classes callers branch on: a rejected request is a
 * `MeetCalApiError` carrying the status the Rust API would have answered, a
 * request that outlives `timeoutMs` a `MeetCalApiTimeoutError`.
 *
 * The clock sample is started alongside the request and never waited for:
 * the first answer of a cold start is what the first schedule paints from.
 * Until the sample lands, `getTrustedNow` is null and the callers that need
 * the server's clock skip their decision or wait (`awaitServerClock`).
 *
 * A premium read carries the access pass (`lib/api/premium-queries.ts`). If
 * the server refuses it (401 without one, 403 for a stale one), the read is
 * sent once more with a newly fetched pass.
 */
async function request(call: ApiCall, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<unknown> {
  // Every other call starts at once; the wait for a pass not yet held is
  // bounded on its own (`ACCESS_PASS_TIMEOUT_MS`), before the timeout starts.
  if (call.kind !== 'query' || call.token || !wantsAccessPass(call.fn, call.args)) return send(call, timeoutMs);
  const pass = await accessPassFor(call.fn, call.args);
  try {
    return await send(withPass(call, pass), timeoutMs);
  } catch (error) {
    if (!(error instanceof MeetCalApiError) || (error.status !== 401 && error.status !== 403)) throw error;
    const fresh = await accessPassFor(call.fn, call.args, { refused: pass, retry: true });
    if (fresh === undefined || fresh === pass) throw error;
    return await send(withPass(call, fresh), timeoutMs);
  }
}

function withPass(call: ApiCall, pass: string | undefined): ApiCall {
  return pass === undefined ? call : { ...call, args: { ...call.args, pass } };
}

async function send(call: ApiCall, timeoutMs: number): Promise<unknown> {
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
  if (serverClockSample === null || Date.now() - serverClockSample.sampledAt > SERVER_CLOCK_RESAMPLE_MS) {
    void sampleServerClock();
  }

  try {
    return await Promise.race([callApi(abort ? { ...call, signal: abort.signal } : call), timeout]);
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
 *
 * `keyArgs` names the arguments the cache is keyed on when some argument only
 * moves the question in time (the meets list's hour). The server's tag hashes
 * the body, so a tag stored for an earlier hour still answers truthfully: an
 * unchanged list comes back bodiless and a changed one in full.
 */
async function getRevalidated<T>(
  path: string,
  fn: string,
  args: Record<string, unknown>,
  validate: (json: unknown) => T,
  keyArgs: Record<string, unknown> = args,
): Promise<T> {
  const key = stableKey(fn, keyArgs);
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
      /**
       * `start_time` / `weigh_in_time` per platform: platforms of one session
       * can start at different times. Absent from packages built before they
       * were added; the session's (its first platform's) times apply then.
       */
      platforms: {
        platform: string;
        weight_class: string;
        start_time?: string | null;
        weigh_in_time?: string | null;
      }[];
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

/** Hours west of UTC at `instant` (4 for EDT, -9 for Tokyo, -5.5 for India). */
function getUTCOffsetHours(timeZoneIdentifier: string, instant: Date): number {
  const hours = -getOffsetMinutesAtInstant(timeZoneIdentifier, instant) / 60;
  return hours === 0 ? 0 : hours; // UTC itself: 0, not -0
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
 * (`meetCalendarDateAnchor`, noon UTC) and read back in UTC. The old inline
 * copy fell back to `new Date(date)` for anything that was not `YYYY-MM-DD`,
 * and a row dated "TBD" rendered as the day title "Invalid Date". Reading the
 * anchor in the meet's zone showed the next day for a meet east of UTC+12
 * (Auckland). A value that is not a calendar date is shown as sent.
 */
function formatScheduleDay(date: string): string {
  const anchor = meetCalendarDateAnchor(date);
  if (!anchor) return date;
  return anchor.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * `Meet` plus the one fact the mapper alone knows: whether `time` is the
 * meet's real zone or the fallback. Every consumer of `Meet` keeps working; a
 * screen that wants to flag the fallback reads `timeZoneUnknown`.
 */
export type MappedMeet = Meet & { timeZoneUnknown: boolean };

/**
 * A text field that is missing or not text reads as blank: the meet fetchers
 * already reject a row without its name, dates and zone (`assertMeetText`),
 * and a package's meet only feeds the schedule's time zone.
 */
export function mapApiMeet(row: ApiMeet): MappedMeet {
  assertObject(row, 'meet');
  const name = nullableString(row.name) ?? '';
  const timeZone = nullableString(row.time_zone) ?? '';
  const startDate = nullableString(row.start_date) ?? '';
  const { identifier: timeZoneIdentifier, known } = resolveTimeZoneIdentifier(timeZone);
  const meetInstant = instantForMeetDate(startDate, timeZoneIdentifier);
  const status =
    row.status === 'ongoing' || row.status === 'completed' || row.status === 'upcoming'
      ? row.status
      : 'upcoming';
  return {
    id: nullableString(row.id) || name,
    name,
    // The venue is display text only; a missing or mistyped part reads blank.
    venue: {
      name: nullableString(row.venue_name) ?? '',
      address: {
        street: nullableString(row.venue_street) ?? '',
        city: nullableString(row.venue_city) ?? '',
        state: nullableString(row.venue_state) ?? '',
        zip: nullableString(row.venue_zip) ?? '',
      },
    },
    venueMapPdfUrl: nullableString(row.venue_map_pdf_url),
    venueMapAppleUrl: nullableString(row.venue_map_apple_url),
    time: {
      timeZone,
      timeZoneIdentifier,
      // Every field here derives from the *same* zone. Splitting them (the
      // abbreviation and offset from the raw value, the identifier from the
      // fallback) showed a "CST" label next to times converted in New York.
      abbreviation: getTimeZoneAbbreviation(timeZoneIdentifier, meetInstant),
      utcOffset: getUTCOffsetHours(timeZoneIdentifier, meetInstant),
    },
    dates: {
      start: startDate,
      end: nullableString(row.end_date) ?? '',
    },
    status,
    timeZoneUnknown: !known,
  };
}

/**
 * The day and session number key a schedule row; a row without them would
 * become a day titled `undefined` or a session numbered `NaN`. Run by the
 * fetcher's validator, so a bad answer never reaches the validator cache, and
 * by the mapper, for the package path and any other caller that hands it
 * rows directly.
 */
function assertApiScheduleRow(row: unknown, label: string): ApiScheduleRow {
  assertObject(row, label);
  if (typeof row.date !== 'string' || typeof row.session_id !== 'number' || !Number.isFinite(row.session_id)) {
    throw new Error(`${label} has an invalid date or session_id`);
  }
  return row as ApiScheduleRow;
}

export function mapApiSchedule(rows: ApiScheduleRow[]): Schedule {
  const scheduleMap = new Map<string, {
    date: string;
    fullDate: string;
    sessions: Map<number, Schedule[number]['sessions'][number]>;
  }>();

  rows.forEach((row, index) => {
    assertApiScheduleRow(row, `schedule[${index}]`);
    if (!scheduleMap.has(row.date)) {
      scheduleMap.set(row.date, {
        date: formatScheduleDay(row.date),
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
      weightClass: nullableString(row.weight_class) ?? '',
      platformStartTime: formatApiTime(row.start_time),
      // Each platform row carries its own published weigh-in; the session's
      // `weighInTime` is only the first row's.
      platformWeighInTime: formatApiTime(row.weigh_in_time),
    });
  });

  return Array.from(scheduleMap.values()).map((day) => ({
    date: day.date,
    fullDate: day.fullDate,
    sessions: Array.from(day.sessions.values()).sort((a, b) => a.number - b.number),
  }));
}

export function mapPackageSchedule(pkg: ApiMeetPackage): Schedule {
  const rows = pkg.schedule.flatMap((day) =>
    day.sessions.flatMap((session) =>
      session.platforms.map((platform) => ({
        date: day.date,
        meet: pkg.meet.name,
        platform: platform.platform,
        session_id: session.session_id,
        // The platform's own time, as `/meets/schedule` reports it: copying
        // the session's (first platform's) time onto every platform put a
        // 9:30 Blue session at 9:00 offline, reminders included.
        start_time: platform.start_time ?? session.start_time,
        weigh_in_time: platform.weigh_in_time ?? session.weigh_in_time,
        weight_class: platform.weight_class,
      })),
    ),
  );
  return mapApiSchedule(rows);
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
function fallbackEventId(meet: string, date: string, name: string): string {
  return `${meet}|${date}|${name}`;
}

/**
 * Like the reference tables below, a field of the wrong type reads as blank
 * (text) or `null` (a lift), so one bad cell never reaches a screen or the
 * offline cache as a string where a number belongs.
 */
export function mapApiLiftingResult(row: ApiLiftingResult, index = 0): SupabaseLiftResult {
  assertObject(row, 'lifting result');
  const meet = nullableString(row.meet) ?? '';
  const date = nullableString(row.date) ?? '';
  const name = nullableString(row.name) ?? '';
  return {
    id: nullableNumber(row.id) ?? index,
    event_id: nullableString(row.event_id) || fallbackEventId(meet, date, name),
    meet,
    date,
    name,
    age: nullableString(row.age) ?? nullableNumber(row.age) ?? '',
    body_weight: nullableNumber(row.body_weight) ?? 0,
    // Numeric policy: Convex sends numbers; a lift of any other type reads as
    // `null` (no lift), unlike year bests, which are never null (`toFiniteNumber`).
    snatch1: nullableNumber(row.snatch1),
    snatch2: nullableNumber(row.snatch2),
    snatch3: nullableNumber(row.snatch3),
    snatch_best: nullableNumber(row.snatch_best),
    cj1: nullableNumber(row.cj1),
    cj2: nullableNumber(row.cj2),
    cj3: nullableNumber(row.cj3),
    cj_best: nullableNumber(row.cj_best),
    total: nullableNumber(row.total),
  };
}

export function mapApiYearBests(row: ApiYearBests) {
  // Numeric policy: a best is a number with 0 for none, read with
  // `toFiniteNumber` exactly as the package's year bests are; lifts in a
  // result row read `null` instead because their type allows it.
  return {
    bestSnatch: toFiniteNumber(row.best_snatch),
    bestCJ: toFiniteNumber(row.best_cj),
    bestTotal: toFiniteNumber(row.best_total),
  };
}

/** A meet row's name, dates and zone are text; without them there is nothing to show. */
function assertMeetText(row: Record<string, unknown>, label: string): void {
  const invalid = ['name', 'start_date', 'end_date', 'time_zone'].filter((field) => typeof row[field] !== 'string');
  if (invalid.length > 0) throw new Error(`${label} has invalid fields: ${invalid.join(', ')}`);
}

function validateApiMeets(json: unknown): ApiMeet[] {
  return assertArray<unknown>(json, '/meets').map((row, index) => {
    const fields = assertHasFields(row, `/meets[${index}]`, [
      'name',
      'start_date',
      'end_date',
      'time_zone',
      'status',
    ]);
    assertMeetText(fields, `/meets[${index}]`);
    return fields as ApiMeet;
  });
}

function validateApiMeetDetails(json: unknown): ApiMeet {
  const fields = assertHasFields(json, '/meets/details', [
    'name',
    'start_date',
    'end_date',
    'time_zone',
  ]);
  assertMeetText(fields, '/meets/details');
  return fields as ApiMeet;
}

function validateApiSchedule(json: unknown): ApiScheduleRow[] {
  return assertArray<unknown>(json, '/meets/schedule').map((row, index) =>
    assertApiScheduleRow(row, `/meets/schedule[${index}]`),
  );
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
  const rows = await getRevalidated('/meets', 'meets:list', { now: meetsWindowNow() }, validateApiMeets, {});
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
 * A meet's schedule. Its day titles are calendar dates, read in UTC, so it
 * needs nothing from the meet's details (it used to fetch them for the zone).
 */
export async function fetchApiSchedule(meet: MeetName): Promise<Schedule> {
  const rows = await getRevalidated('/meets/schedule', 'meets:schedule', { meet }, validateApiSchedule);
  return mapApiSchedule(rows);
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

/**
 * Name-keyed bests arrive as `[{ name, best_snatch, best_cj, best_total }]`
 * (Convex object keys must be ASCII; athlete names are not). One parser for
 * `results:bests` and the package's `year_bests`: a malformed row fails the
 * answer, naming its index, and a missing or mistyped best reads as 0.
 */
function parseNamedBests(rows: unknown[], label: string): { name: string; bests: ApiYearBests }[] {
  return rows.map((row, index) => {
    const fields = assertHasFields(row, `${label}[${index}]`, ['name', 'best_snatch', 'best_cj', 'best_total']);
    if (typeof fields.name !== 'string') throw new Error(`${label}[${index}] has invalid name`);
    return {
      name: fields.name,
      bests: {
        best_snatch: toFiniteNumber(fields.best_snatch),
        best_cj: toFiniteNumber(fields.best_cj),
        best_total: toFiniteNumber(fields.best_total),
      },
    };
  });
}

/**
 * Bests since `cutoffDate`, keyed by the caller's own spellings. The server
 * echoes each name cleaned (trimmed, whitespace folded), so a roster's
 * ' Jane Doe' is matched to its row through `normalizeAthleteName` here,
 * once, rather than by every caller (a caller that forgot stored the athlete
 * as "no results"). A name the answer does not cover is left out.
 */
export async function fetchApiYearBestsByNames(
  names: string[],
  cutoffDate: string = getHistoryCutoffDate(YEAR_BESTS_YEARS),
): Promise<Record<string, ReturnType<typeof mapApiYearBests>>> {
  if (names.length === 0) return {};
  const byFoldedName = new Map<string, ReturnType<typeof mapApiYearBests>>();
  for (const chunk of chunkValues(names, SMALL_ROWS_NAMES_CHUNK_SIZE)) {
    const rows = assertArray<unknown>(
      await readQuery('/lifting-results/bests', 'results:bests', { names: chunk, cutoffDate }),
      '/lifting-results/bests',
    );
    for (const { name, bests } of parseNamedBests(rows, '/lifting-results/bests')) {
      byFoldedName.set(normalizeAthleteName(name), mapApiYearBests(bests));
    }
  }
  const byName: Record<string, ReturnType<typeof mapApiYearBests>> = {};
  for (const name of names) {
    const bests = byFoldedName.get(normalizeAthleteName(name));
    if (bests) byName[name] = bests;
  }
  return byName;
}

/**
 * `results:search`: name suggestions, or with `startDate` and `endDate` (both
 * inclusive, `YYYY-MM-DD`) the results in that range. `truncated` says more
 * results matched than the answer holds (the most recent are kept), so the
 * search should be narrowed.
 */
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
    // Deployments before the field answered without it; they cut silently.
    truncated: response.truncated === true,
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
    // Sent as a list (see `parseNamedBests`); the rest of the app reads the
    // map the Rust API sent, with the API's snake_case fields. Keyed by the
    // server's spelling: there is no caller's spelling here, and the store
    // folds the key (`saveAthleteBestsBatch`).
    const byName: Record<string, ApiYearBests> = {};
    const rows = assertArray<unknown>(pkg.year_bests, '/meets/package.year_bests');
    for (const { name, bests } of parseNamedBests(rows, '/meets/package.year_bests')) {
      byName[name] = bests;
    }
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

/** One meet a club entered (`reference:clubMeets`). */
export type ApiClubMeet = {
  meet: string;
  /** The meet's first day, `YYYY-MM-DD`; null when the server has no meet row for it. */
  date: string | null;
};

/**
 * A club's distinct meets under every spelling of its name, newest first, in
 * one bounded read (`reference:clubMeets`, #209) instead of every
 * registration the club ever made. A row without a meet name is dropped and a
 * date that is not a string reads as null; a body without a `meets` array
 * throws, so nothing is cached from it.
 */
export async function fetchApiClubMeets(club: string): Promise<ApiClubMeet[]> {
  const response = await readQuery('/clubs/meets', 'reference:clubMeets', { club });
  assertObject(response, '/clubs/meets');
  const rows = assertArray<unknown>(response.meets, '/clubs/meets');
  const meets: ApiClubMeet[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const { meet, date } = row as Record<string, unknown>;
    if (typeof meet !== 'string' || meet.length === 0) continue;
    meets.push({ meet, date: nullableString(date) });
  }
  if (meets.length !== rows.length) {
    console.warn(`[api] /clubs/meets: dropped ${rows.length - meets.length} of ${rows.length} malformed meets`);
  }
  // A club with more meets than one answer holds gets its most recent; none comes close today.
  if (response.truncated === true && typeof __DEV__ !== 'undefined' && __DEV__) {
    console.info('[api] /clubs/meets: the server listed only the most recent meets', { club, meets: meets.length });
  }
  return meets;
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

/**
 * A saved-session write's place in its install's order (`convex/users.ts`):
 * the outbox's install id and the entry's rev, which only grows on that
 * install. The server ignores a write older than one it already applied from
 * the same install (one that landed after the client timed out), and answers
 * it as a success.
 */
export interface SavedSessionWriteRevision {
  device: string;
  rev: number;
}

/** Mirrors `MAX_SAVED_SESSION_DEVICE_LEN` in `convex/users.ts`. */
export const MAX_SAVED_SESSION_DEVICE_LEN = 64;

/** The revision as call arguments, checked before it is sent; none sends none. */
function writeRevisionArgs(
  revision: SavedSessionWriteRevision | undefined,
  label: string,
): Partial<SavedSessionWriteRevision> {
  if (revision === undefined) return {};
  const { device, rev } = revision;
  if (typeof device !== 'string' || device.trim() === '' || Array.from(device).length > MAX_SAVED_SESSION_DEVICE_LEN) {
    throw new Error(`${label} requires a device id of 1 to ${MAX_SAVED_SESSION_DEVICE_LEN} characters`);
  }
  if (typeof rev !== 'number' || !Number.isSafeInteger(rev) || rev < 1) {
    throw new Error(`${label} requires a rev that is a whole number from 1`);
  }
  return { device, rev };
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
  revision?: SavedSessionWriteRevision,
): Promise<{ session_id: string; updated_at: number }> {
  const authToken = requireToken(token, 'putSavedSession');
  const order = writeRevisionArgs(revision, 'putSavedSession');
  const row = assertHasFields(
    await userCall(`/users/me/saved-sessions/${sessionId}`, 'users:putSavedSession', 'mutation', authToken, {
      sessionId,
      ...body,
      ...order,
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
  revision?: SavedSessionWriteRevision,
): Promise<{ deleted: boolean }> {
  const authToken = requireToken(token, 'deleteSavedSession');
  const order = writeRevisionArgs(revision, 'deleteSavedSession');
  const row = await userCall(
    `/users/me/saved-sessions/${sessionId}`,
    'users:deleteSavedSession',
    'mutation',
    authToken,
    { sessionId, ...order },
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
  revision?: SavedSessionWriteRevision,
): Promise<{ deleted_count: number }> {
  const authToken = requireToken(token, 'deleteSavedSessions');
  const order = writeRevisionArgs(revision, 'deleteSavedSessions');
  const row = await userCall('/users/me/saved-sessions', 'users:deleteSavedSessions', 'mutation', authToken, {
    meet,
    ...order,
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

/**
 * Asks the server to check the signed-in user's subscription with RevenueCat
 * now (`entitlements:refresh`), so premium reads work right after a purchase
 * and for subscribers the server has not heard about yet. Answers whether the
 * server found it active.
 */
export async function refreshServerEntitlement(token: string): Promise<{ active: boolean }> {
  const authToken = requireToken(token, 'refreshServerEntitlement');
  const row = assertHasFields(
    await userCall('/users/me/entitlement', 'entitlements:refresh', 'action', authToken),
    '/users/me/entitlement',
    ['active'],
  );
  if (typeof row.active !== 'boolean') throw new Error('/users/me/entitlement.active expected a boolean');
  return { active: row.active };
}

/**
 * The shared access pass premium reads carry (`accessPass:pass`), for a signed-in
 * subscriber. A 403 means the server knows of no active subscription.
 */
export async function fetchAccessPass(token: string): Promise<AccessPass> {
  const authToken = requireToken(token, 'fetchAccessPass');
  const row = assertHasFields(await userCall('/access-pass', 'accessPass:pass', 'query', authToken), '/access-pass', ['pass', 'rotatesAt']);
  if (typeof row.pass !== 'string' || row.pass.length === 0) throw new Error('/access-pass.pass expected a non-empty string');
  if (typeof row.rotatesAt !== 'number' || !Number.isFinite(row.rotatesAt)) throw new Error('/access-pass.rotatesAt expected a number');
  return { pass: row.pass, rotatesAt: row.rotatesAt };
}

/** A MeetCal-issued sign-in token (`apiTokens:issue`): the JWT, its id, and when it expires (ms). */
export type IssuedApiToken = { token: string; tokenId: string; expiresAt: number };

/**
 * A new 90-day MeetCal-issued token for Siri's App Intents
 * (`apiTokens:issue` with `{ client: "siri" }`), for the user whose Clerk
 * session token this is (`lib/siri-token.ts`).
 */
export async function issueSiriToken(token: string): Promise<IssuedApiToken> {
  const authToken = requireToken(token, 'issueSiriToken');
  const row = assertHasFields(
    await userCall('/api-tokens', 'apiTokens:issue', 'action', authToken, { client: 'siri' }),
    '/api-tokens',
    ['token', 'tokenId', 'expiresAt'],
  );
  if (typeof row.token !== 'string' || row.token.length === 0) throw new Error('/api-tokens.token expected a non-empty string');
  if (typeof row.tokenId !== 'string' || row.tokenId.length === 0) throw new Error('/api-tokens.tokenId expected a non-empty string');
  if (typeof row.expiresAt !== 'number' || !Number.isFinite(row.expiresAt)) throw new Error('/api-tokens.expiresAt expected a number');
  return { token: row.token, tokenId: row.tokenId, expiresAt: row.expiresAt };
}

/**
 * Ends a MeetCal-issued token (`apiTokens:revoke`). Called with that token,
 * ends it whatever `tokenId` says; called with a Clerk session token, ends
 * the user's token `tokenId`. Ending a token already gone is not an error.
 */
export async function revokeApiToken(token: string, tokenId?: string): Promise<void> {
  const authToken = requireToken(token, 'revokeApiToken');
  await userCall('/api-tokens/revoke', 'apiTokens:revoke', 'mutation', authToken, tokenId === undefined ? {} : { tokenId });
}

/**
 * A one-time URL to upload one file of a meet submission to
 * (`meetSubmissions:generateUploadUrl`). A 429 once the user has sent the
 * day's submissions.
 */
export async function generateMeetSubmissionUploadUrl(token: string): Promise<string> {
  const authToken = requireToken(token, 'generateMeetSubmissionUploadUrl');
  const row = assertHasFields(
    await userCall('/meet-submissions/upload-url', 'meetSubmissions:generateUploadUrl', 'mutation', authToken),
    '/meet-submissions/upload-url',
    ['uploadUrl'],
  );
  if (typeof row.uploadUrl !== 'string' || !/^https:\/\//.test(row.uploadUrl)) {
    throw new Error('/meet-submissions/upload-url.uploadUrl expected an https URL');
  }
  return row.uploadUrl;
}

export interface MeetSubmissionBody {
  meetName: string;
  /** `YYYY-MM-DD` */
  startDate: string;
  /** `YYYY-MM-DD`, or null for a one-day meet. */
  endDate: string | null;
  /** The signed-in user's email, for the email's Reply-To. */
  contactEmail: string | null;
  files: { storageId: string; name: string }[];
}

/** Submits a meet for MeetCal to add (`meetSubmissions:submit`). */
export async function submitMeet(token: string, body: MeetSubmissionBody): Promise<void> {
  const authToken = requireToken(token, 'submitMeet');
  const row = assertHasFields(
    await userCall('/meet-submissions', 'meetSubmissions:submit', 'mutation', authToken, { ...body }),
    '/meet-submissions',
    ['submitted'],
  );
  if (row.submitted !== true) throw new Error('/meet-submissions.submitted expected true');
}

/** `results:wrapped`'s answer (`convex/lib/wrapped.ts`), checked. */
export type ApiWrappedStats = {
  totalWeightLifted: number;
  totalMeets: number;
  makePercentage: number;
  bestSnatch: number;
  bestCleanJerk: number;
  bestTotal: number;
  averageTotal: number;
  topMeet: string | null;
  improvementFromFirst: number | null;
  longestMakeStreak: number;
  favoriteAttempt: 1 | 2 | 3 | null;
  yearRank: string;
};

export type ApiWrappedAnswer =
  | { kind: 'athlete'; name: string; stats: ApiWrappedStats }
  | { kind: 'ambiguous'; names: string[]; truncated: boolean }
  | { kind: 'narrow' }
  | { kind: 'tooManyResults'; name: string }
  | { kind: 'none'; suggestions: string[] };

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} expected a number`);
  return value;
}

function mapWrappedStats(value: unknown): ApiWrappedStats {
  const stats = assertHasFields(value, '/wrapped.stats', [
    'totalWeightLifted',
    'totalMeets',
    'makePercentage',
    'bestSnatch',
    'bestCleanJerk',
    'bestTotal',
    'averageTotal',
    'topMeet',
    'improvementFromFirst',
    'longestMakeStreak',
    'favoriteAttempt',
    'yearRank',
  ]);
  const num = (key: string) => finiteNumber(stats[key], `/wrapped.stats.${key}`);
  const favorite = stats.favoriteAttempt;
  if (favorite !== null && favorite !== 1 && favorite !== 2 && favorite !== 3) throw new Error('/wrapped.stats.favoriteAttempt expected 1, 2, 3 or null');
  if (stats.topMeet !== null && typeof stats.topMeet !== 'string') throw new Error('/wrapped.stats.topMeet expected a string or null');
  if (typeof stats.yearRank !== 'string') throw new Error('/wrapped.stats.yearRank expected a string');
  return {
    totalWeightLifted: num('totalWeightLifted'),
    totalMeets: num('totalMeets'),
    makePercentage: num('makePercentage'),
    bestSnatch: num('bestSnatch'),
    bestCleanJerk: num('bestCleanJerk'),
    bestTotal: num('bestTotal'),
    averageTotal: num('averageTotal'),
    topMeet: stats.topMeet,
    improvementFromFirst: stats.improvementFromFirst === null ? null : num('improvementFromFirst'),
    longestMakeStreak: num('longestMakeStreak'),
    favoriteAttempt: favorite,
    yearRank: stats.yearRank,
  };
}

/**
 * Weightlifting Wrapped for `query`'s calendar `year`, scored on the server
 * (`results:wrapped`): free and public, so it sends no access pass. `picked`
 * (a name chosen from an `ambiguous` answer) takes only that exact name.
 */
export async function fetchWrapped(query: string, year: number, picked = false): Promise<ApiWrappedAnswer> {
  const answer = assertHasFields(await readQuery('/wrapped', 'results:wrapped', { query, year, picked: picked || undefined }), '/wrapped', ['kind']);
  switch (answer.kind) {
    case 'athlete':
      if (typeof answer.name !== 'string') throw new Error('/wrapped.name expected a string');
      return { kind: 'athlete', name: answer.name, stats: mapWrappedStats(answer.stats) };
    case 'ambiguous':
      return { kind: 'ambiguous', names: assertStringArray(answer.names, '/wrapped.names'), truncated: answer.truncated === true };
    case 'narrow':
      return { kind: 'narrow' };
    case 'tooManyResults':
      if (typeof answer.name !== 'string') throw new Error('/wrapped.name expected a string');
      return { kind: 'tooManyResults', name: answer.name };
    case 'none':
      return { kind: 'none', suggestions: answer.suggestions === undefined ? [] : assertStringArray(answer.suggestions, '/wrapped.suggestions') };
    default:
      throw new Error(`/wrapped returned an unknown kind ${JSON.stringify(answer.kind)}`);
  }
}
