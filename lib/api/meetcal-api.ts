import { LiftResult, Platform, SupabaseLiftResult } from '@/data/types/athletes';
import {
  Meet,
  MeetName,
  timezoneOffsets,
  USTimeZoneIdentifier,
} from '@/data/types/meet';
import type { Schedule } from '@/types/schedule';
import { getTimeZoneAbbreviation } from '@/utils/dateTime';
import { getOffsetMinutesAtInstant, parseClockTime } from '@/utils/timezone';

const DEFAULT_API_BASE_URL = 'https://api.meetcal.app';
const DEFAULT_TIMEOUT_MS = 10000;
const SLOW_API_LOG_THRESHOLD_MS = 500;
export const NAMES_QUERY_CHUNK_SIZE = 40;

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
  return new Date(Date.UTC(year, month - 1, day, 16, 0, 0));
}

function resolveTimeZoneIdentifier(value: string): USTimeZoneIdentifier {
  if (Object.prototype.hasOwnProperty.call(timezoneOffsets, value)) {
    return value as USTimeZoneIdentifier;
  }
  return 'America/New_York';
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
};

export class MeetCalApiError extends Error {
  status: number;
  body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = 'MeetCalApiError';
    this.status = status;
    this.body = body;
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

async function requestJson<T>(
  method: string,
  path: string,
  query?: Record<string, QueryValue>,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
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
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options?.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    status = response.status;
    const text = await response.text();

    if (!response.ok) {
      throw new MeetCalApiError(
        `${method} ${path} failed with ${response.status}`,
        response.status,
        text,
      );
    }

    return parseResponseJson(method, path, text) as T;
  } catch (error) {
    if (error instanceof MeetCalApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`${method} ${path} timed out after ${timeoutMs}ms`);
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

export function getJson<T>(
  path: string,
  query?: Record<string, QueryValue>,
  options?: RequestOptions,
): Promise<T> {
  return requestJson<T>('GET', path, query, undefined, options);
}

export function putJson<T>(
  path: string,
  body: unknown,
  options?: RequestOptions,
): Promise<T> {
  return requestJson<T>('PUT', path, undefined, body, options);
}

export function patchJson<T>(
  path: string,
  body: unknown,
  options?: RequestOptions,
): Promise<T> {
  return requestJson<T>('PATCH', path, undefined, body, options);
}

export function deleteJson<T>(
  path: string,
  query?: Record<string, QueryValue>,
  options?: RequestOptions,
): Promise<T> {
  return requestJson<T>('DELETE', path, query, undefined, options);
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
  attempt_estimates: unknown[];
  year_bests_by_name: Record<string, ApiYearBests>;
  recent_results_by_name: Record<string, ApiLiftingResult[]>;
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

export function normalizePlatform(platform: string | null | undefined): Platform {
  const value = (platform || '').trim();
  const normalized = value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
  const validPlatforms: Platform[] = ['Red', 'White', 'Blue', 'Stars', 'Stripes', 'Rogue'];
  return validPlatforms.includes(normalized as Platform) ? normalized as Platform : 'Red';
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

function dateForMeetTimezone(date: string, timeZoneIdentifier: USTimeZoneIdentifier): string {
  const [datePart] = date.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const safeUtcDate = Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)
    ? new Date(date)
    : new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  return safeUtcDate.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: timeZoneIdentifier,
  });
}

export function mapApiMeet(row: ApiMeet): Meet {
  const timeZoneIdentifier = resolveTimeZoneIdentifier(row.time_zone || '');
  const offsetZone =
    getTimeZoneAbbreviation(row.time_zone || timeZoneIdentifier) === 'Local'
      ? timeZoneIdentifier
      : row.time_zone;
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
      abbreviation: getTimeZoneAbbreviation(row.time_zone || timeZoneIdentifier, meetInstant),
      utcOffset: getUTCOffsetHours(offsetZone, row.start_date),
    },
    dates: {
      start: row.start_date,
      end: row.end_date,
    },
    status,
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
      weightClass: row.weight_class,
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
  const sessionNumber = row.session_number ?? row.session?.session_number;
  const sessionPlatform = row.session_platform ?? row.session?.session_platform;
  const date = row.date ?? row.schedule_row?.date ?? row.session?.date ?? undefined;
  const startTime = row.start_time ?? row.schedule_row?.start_time ?? row.session?.start_time ?? undefined;
  const weighInTime = row.weigh_in_time ?? row.schedule_row?.weigh_in_time ?? row.session?.weigh_in_time ?? undefined;

  return {
    memberId: row.member_id || '',
    name: row.name,
    age: toFiniteNumber(row.age, 0),
    club: row.club,
    wso: row.wso || undefined,
    gender: row.gender || '',
    weightClass: row.weight_class || '',
    entryTotal: row.entry_total,
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
}

export function mapApiLiftingResult(row: ApiLiftingResult, index = 0): SupabaseLiftResult {
  return {
    id: row.id ?? index,
    event_id: row.event_id ?? '',
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

export async function fetchApiMeets(): Promise<Meet[]> {
  const rows = assertArray<ApiMeet>(await getJson('/meets'), '/meets');
  return rows.map((row, index) =>
    mapApiMeet(
      assertHasFields(row, `/meets[${index}]`, [
        'name',
        'start_date',
        'end_date',
        'time_zone',
        'status',
      ]) as ApiMeet,
    ),
  );
}

export async function fetchApiMeetByName(meet: string): Promise<Meet | null> {
  try {
    const row = assertHasFields(
      await getJson('/meets/details', { meet }),
      '/meets/details',
      ['name', 'start_date', 'end_date', 'time_zone'],
    ) as ApiMeet;
    return row ? mapApiMeet(row) : null;
  } catch (error) {
    if (error instanceof MeetCalApiError && error.status === 404) return null;
    throw error;
  }
}

export async function fetchApiSchedule(meet: MeetName): Promise<Schedule> {
  const [meetDetails, rows] = await Promise.all([
    fetchApiMeetByName(meet),
    getJson('/meets/schedule', { meet }),
  ]);
  return mapApiSchedule(assertArray<ApiScheduleRow>(rows, '/meets/schedule'), meetDetails ?? undefined);
}

export async function fetchApiAthletes(meet: MeetName): Promise<LiftResult[]> {
  const rows = assertArray<ApiAthlete>(await getJson('/meets/athletes', { meet }), '/meets/athletes');
  return rows.map(mapApiAthlete);
}

export async function fetchApiAthletesWithSession(
  meet: MeetName,
  sessionNumber?: number,
  platform?: string,
): Promise<LiftResult[]> {
  const rows = assertArray<ApiAthleteWithSession>(
    await getJson('/meets/athletes-sessions', {
      meet,
      session_number: sessionNumber,
      platform,
    }),
    '/meets/athletes-sessions',
  );
  return rows.map(mapApiAthlete);
}

export async function fetchApiLiftingResultsForMeet(meet: MeetName): Promise<SupabaseLiftResult[]> {
  const rows = assertArray<ApiLiftingResult>(
    await getJson('/lifting-results', { meet }),
    '/lifting-results',
  );
  return rows.map(mapApiLiftingResult);
}

export async function fetchApiResultsByNames(names: string[]): Promise<SupabaseLiftResult[]> {
  if (names.length === 0) return [];
  const rows: SupabaseLiftResult[] = [];
  for (const chunk of chunkValues(names, NAMES_QUERY_CHUNK_SIZE)) {
    const part = assertArray<ApiLiftingResult>(
      await getJson('/lifting-results/by-names', { names: chunk }),
      '/lifting-results/by-names',
    );
    rows.push(...part.map(mapApiLiftingResult));
  }
  return rows;
}

export async function fetchApiRecentResultsByNames(
  names: string[],
  cutoffDate?: string,
): Promise<SupabaseLiftResult[]> {
  if (names.length === 0) return [];
  const rows: SupabaseLiftResult[] = [];
  for (const chunk of chunkValues(names, NAMES_QUERY_CHUNK_SIZE)) {
    const part = assertArray<ApiLiftingResult>(
      await getJson('/lifting-results/recent', {
        names: chunk,
        cutoff_date: cutoffDate,
      }),
      '/lifting-results/recent',
    );
    rows.push(...part.map(mapApiLiftingResult));
  }
  return rows;
}

export async function fetchApiYearBests(name: string, cutoffDate?: string) {
  const row = assertHasFields(await getJson('/lifting-results/year', {
    name,
    cutoff_date: cutoffDate,
  }), '/lifting-results/year', ['best_snatch', 'best_cj', 'best_total']) as ApiYearBests;
  return [mapApiYearBests(row)];
}

export async function fetchApiYearBestsByNames(
  names: string[],
  cutoffDate?: string,
): Promise<Record<string, ReturnType<typeof mapApiYearBests>>> {
  if (names.length === 0) return {};
  const merged: Record<string, ReturnType<typeof mapApiYearBests>> = {};
  for (const chunk of chunkValues(names, NAMES_QUERY_CHUNK_SIZE)) {
    const response = await getJson('/lifting-results/bests', {
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

export async function fetchApiMeetPackage(
  meet: MeetName,
  historyCutoffDate?: string,
): Promise<ApiMeetPackage> {
  const pkg = assertHasFields(await getJson('/meets/package', {
    meet,
    history_cutoff_date: historyCutoffDate,
  }, { timeoutMs: 20000 }), '/meets/package', ['meet', 'schedule', 'athletes', 'meet_results']);
  assertObject(pkg.meet, '/meets/package.meet');
  assertArray(pkg.schedule, '/meets/package.schedule');
  assertArray(pkg.athletes, '/meets/package.athletes');
  assertArray(pkg.meet_results, '/meets/package.meet_results');
  return pkg as ApiMeetPackage;
}

export async function fetchApiWsoList(): Promise<string[]> {
  const response = await getJson('/data/wso/');
  if (Array.isArray(response)) {
    return assertStringArray(response, '/data/wso/');
  }
  assertObject(response, '/data/wso/');
  return assertStringArray(response.wsos, '/data/wso/.wsos');
}

export async function fetchApiWsoAgeGroups(wso: string): Promise<string[]> {
  return assertStringArray(await getJson('/data/wso/age-groups', { wso }), '/data/wso/age-groups');
}

export async function fetchApiClubNames(): Promise<string[]> {
  return assertStringArray(await getJson('/clubs'), '/clubs');
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
  assertObject(row, 'deleteSavedSession');
  return { deleted: (row as { deleted?: unknown }).deleted === true };
}

export async function deleteSavedSessions(
  token: string,
  meet?: string,
): Promise<{ deleted_count: number }> {
  const authToken = requireToken(token, 'deleteSavedSessions');
  const row = await deleteJson('/users/me/saved-sessions', { meet }, { token: authToken });
  assertObject(row, 'deleteSavedSessions');
  const deletedCount = (row as { deleted_count?: unknown }).deleted_count;
  return {
    deleted_count: typeof deletedCount === 'number' && Number.isFinite(deletedCount) ? deletedCount : 0,
  };
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
