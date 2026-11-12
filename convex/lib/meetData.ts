import { isListOf, isPairOf, isRecord, isString, isStringList } from './json';
import { ATHLETE_RESULTS_MAX, MEET_RESULTS_MAX, MEET_RESULT_TITLES_MAX, MEET_ROSTER_MAX, MEET_SESSIONS_MAX, readAll } from './boundedRead';
import type { QueryCtx } from '../_generated/server';
import { isoDateOf } from './dates';
import type { Doc } from '../_generated/dataModel';
import { mapInBatches } from './concurrency';
import { normalizeName } from './names';
import { hasSession } from './roster';
import { athleteGenderLabel } from './normalize';
import { accumulateBests, bestsSince, namedBests, toApiLiftingResult, ZERO_BESTS, type ApiLiftingResult, type NamedBests, type YearBests } from './results';
import { compareBytes, compareCollated } from './sort';
import { isMeetTimeZone } from './validation';

// Per-meet answers. Queries serve them from the meet's views when fresh and
// compute them here otherwise; the view builders compute them here too.

export type ApiMeet = {
  id: string;
  name: string;
  federation: string;
  status: string;
  start_date: string;
  end_date: string;
  time_zone: string;
  venue_name: string;
  venue_street: string;
  venue_city: string;
  venue_state: string;
  venue_zip: string;
  venue_map_pdf_url: string | null;
  venue_map_apple_url: string | null;
};

export function toApiMeet(meet: Doc<'meets'>): ApiMeet {
  return {
    id: meet._id,
    name: meet.name,
    federation: meet.federation ?? '',
    status: meet.status,
    start_date: meet.startDate,
    end_date: meet.endDate,
    time_zone: meet.timeZone,
    venue_name: meet.venueName,
    venue_street: meet.venueStreet,
    venue_city: meet.venueCity,
    venue_state: meet.venueState,
    venue_zip: meet.venueZip,
    venue_map_pdf_url: meet.venueMapPdfUrl ?? null,
    venue_map_apple_url: meet.venueMapAppleUrl ?? null,
  };
}

export const MEET_ROWS_READ_PER_NAME = 2;

export async function meetsNamed(ctx: QueryCtx, name: string, limit = MEET_ROWS_READ_PER_NAME): Promise<Doc<'meets'>[]> {
  return ctx.db
    .query('meets')
    .withIndex('by_name', (q) => q.eq('name', name))
    .take(limit);
}

export function oldestMeetNamed(name: string, rows: readonly Doc<'meets'>[]): Doc<'meets'> | null {
  if (rows.length > 1) console.warn(`meets: more than one meet named ${JSON.stringify(name)}; using the oldest`);
  return oldestMeet(rows);
}

export async function meetByName(ctx: QueryCtx, name: string): Promise<Doc<'meets'> | null> {
  return oldestMeetNamed(name, await meetsNamed(ctx, name));
}

/** The first-created of `rows`, or null. Index order already ties by creation time; this does not rely on it. */
export function oldestMeet<T extends { _creationTime: number }>(rows: readonly T[]): T | null {
  return rows.reduce<T | null>((oldest, row) => (oldest === null || row._creationTime < oldest._creationTime ? row : oldest), null);
}

export function isPlaceholderMeet(meet: { timeZone: string; venueName: string; venueCity: string }): boolean {
  return !isMeetTimeZone(meet.timeZone) && [meet.venueName, meet.venueCity].every((field) => field.trim().length === 1);
}

/** Disambiguated names tried for one meet before a write gives up. */
export const MAX_DISAMBIGUATED_NAMES = 10;

/**
 * A name a meet may be stored under when another meet already has its
 * display name ("2027 Masters Nationals (USAMW)", then "... (USAMW 2)" if a
 * meet holds that too): names identify meets in every table and in saved
 * sessions, so a second meet must never take an existing one's name, and a
 * stored name never changes. The meet keeps the source's name in
 * `sourceName`, so a meet the source really calls "Open (USAMW)" is never
 * taken for a disambiguated "Open".
 */
export function disambiguatedMeetName(name: string, federation: string, attempt = 1): string {
  return attempt === 1 ? `${name} (${federation})` : `${name} (${federation} ${attempt})`;
}

/**
 * One `Intl.DateTimeFormat` per zone, shared across a function's meets:
 * building one costs more than everything else a meets pass does.
 */
export type ZoneFormatters = Map<string, Intl.DateTimeFormat | null>;

export function meetLocalDate(instant: number, timeZone: string, formatters: ZoneFormatters = new Map()): string {
  const formatter = zoneFormatter(timeZone, formatters);
  if (!formatter) return isoDateOf(instant);
  const parts = formatter.formatToParts(instant);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * The `YYYY-MM-DD` formatter for `timeZone`, built once per `formatters`:
 * null for a blank zone or one this runtime cannot read.
 */
export function zoneFormatter(timeZone: string, formatters: ZoneFormatters): Intl.DateTimeFormat | null {
  if (!formatters.has(timeZone)) {
    let formatter: Intl.DateTimeFormat | null;
    try {
      formatter = timeZone.trim()
        ? new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
        : null;
    } catch {
      formatter = null;
    }
    formatters.set(timeZone, formatter);
  }
  return formatters.get(timeZone) ?? null;
}

/** Postgres `date + INTERVAL 'n months'`: same day, clamped to the month's end. */
export function addMonths(date: string, months: number): string {
  const [year = Number.NaN, month = Number.NaN, day = Number.NaN] = date.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return isoDateOf(target.getTime());
}

export type ApiScheduleRow = {
  date: string;
  meet: string;
  platform: string;
  session_id: number;
  start_time: string;
  weigh_in_time: string;
  weight_class: string;
};

async function scheduleDocs(ctx: QueryCtx, meet: string): Promise<Doc<'session_schedule'>[]> {
  return await readAll(
    ctx.db
      .query('session_schedule')
      .withIndex('by_meet', (q) => q.eq('meet', meet)),
    MEET_SESSIONS_MAX,
    'sessions of one meet',
  );
}

function toApiScheduleRow(row: Doc<'session_schedule'>): ApiScheduleRow {
  return {
    date: row.date,
    meet: row.meet,
    platform: row.platform,
    session_id: row.sessionId,
    start_time: row.startTime,
    weigh_in_time: row.weighInTime,
    weight_class: row.weightClass,
  };
}

/** `GET /meets/schedule`: ordered by date, session, platform. */
export async function computeScheduleRows(ctx: QueryCtx, meet: string): Promise<ApiScheduleRow[]> {
  return (await scheduleDocs(ctx, meet))
    .map(toApiScheduleRow)
    .sort((a, b) => compareBytes(a.date, b.date) || a.session_id - b.session_id || compareBytes(a.platform, b.platform));
}

export type PackageScheduleDay = {
  date: string;
  sessions: {
    session_id: number;
    start_time: string;
    weigh_in_time: string;
    /**
     * Each platform's own times: platforms of one session can start at
     * different times. The session's `start_time` / `weigh_in_time` are its
     * first platform's, kept for older clients.
     */
    platforms: { platform: string; weight_class: string; start_time: string; weigh_in_time: string }[];
  }[];
};

/** The package's schedule: rows grouped by day, then session, in SQL text order. */
export function packageSchedule(rows: readonly ApiScheduleRow[]): PackageScheduleDay[] {
  const ordered = [...rows].sort(
    (a, b) =>
      compareCollated(a.date, b.date) || a.session_id - b.session_id || compareCollated(a.platform, b.platform),
  );
  const days: PackageScheduleDay[] = [];
  for (const row of ordered) {
    let day = days.find((d) => d.date === row.date);
    if (!day) {
      day = { date: row.date, sessions: [] };
      days.push(day);
    }
    let session = day.sessions.find((s) => s.session_id === row.session_id);
    if (!session) {
      session = { session_id: row.session_id, start_time: row.start_time, weigh_in_time: row.weigh_in_time, platforms: [] };
      day.sessions.push(session);
    }
    session.platforms.push({
      platform: row.platform,
      weight_class: row.weight_class,
      start_time: row.start_time,
      weigh_in_time: row.weigh_in_time,
    });
  }
  return days;
}

/**
 * One athlete joined with one matching schedule row, in the package's shape.
 * `j` numbers the matches of one athlete (0 for the first, or for an athlete
 * with none): SQL joins repeat an athlete per matching row, and the plain
 * roster keeps only `j === 0`. `session.date === null` means no schedule row
 * matched (a left-join miss).
 */
export type RosterItem = {
  member_id: string;
  name: string;
  age: number;
  club: string;
  wso: string | null;
  gender: string;
  weight_class: string;
  entry_total: number;
  adaptive: boolean;
  session: {
    session_number: number;
    session_platform: string;
    date: string | null;
    start_time: string | null;
    weigh_in_time: string | null;
  } | null;
  j: number;
};

export async function rosterDocs(ctx: QueryCtx, meet: string): Promise<Doc<'athletes'>[]> {
  return await readAll(
    ctx.db
      .query('athletes')
      .withIndex('by_meet', (q) => q.eq('meet', meet)),
    MEET_ROSTER_MAX,
    'athletes of one meet',
  );
}

/** Every roster athlete's name as stored (the names a package's year bests are for). */
export async function rosterNames(ctx: QueryCtx, meet: string): Promise<string[]> {
  return (await rosterDocs(ctx, meet)).map((athlete) => athlete.name);
}

function scheduleKey(sessionId: number, platform: string): string {
  return `${sessionId}\u0000${platform}`;
}

/** `athletes LEFT JOIN session_schedule ON (session, platform)`, by name in SQL text order. */
export function joinRoster(athletes: Doc<'athletes'>[], schedule: readonly ApiScheduleRow[]): RosterItem[] {
  const bySession = new Map<string, ApiScheduleRow[]>();
  for (const row of schedule) {
    const key = scheduleKey(row.session_id, row.platform);
    const list = bySession.get(key);
    if (list) list.push(row);
    else bySession.set(key, [row]);
  }
  const items: RosterItem[] = [];
  for (const athlete of [...athletes].sort((a, b) => compareCollated(a.name, b.name))) {
    const placed = hasSession(athlete);
    const matches = placed ? (bySession.get(scheduleKey(athlete.sessionNumber!, athlete.sessionPlatform!)) ?? []) : [];
    const joined = matches.length === 0 ? [undefined] : matches;
    joined.forEach((s, j) => {
      items.push({
        member_id: athlete.memberId,
        name: athlete.name,
        age: athlete.age,
        club: athlete.club,
        wso: athlete.wso ?? null,
        gender: athleteGenderLabel(athlete.gender),
        weight_class: athlete.weightClass,
        entry_total: athlete.entryTotal,
        adaptive: athlete.adaptive,
        session: placed
          ? {
              session_number: athlete.sessionNumber!,
              session_platform: athlete.sessionPlatform!,
              date: s?.date ?? null,
              start_time: s?.start_time ?? null,
              weigh_in_time: s?.weigh_in_time ?? null,
            }
          : null,
        j,
      });
    });
  }
  return items;
}

export async function computeRoster(ctx: QueryCtx, meet: string, schedule?: readonly ApiScheduleRow[]): Promise<RosterItem[]> {
  const [athletes, rows] = await Promise.all([
    rosterDocs(ctx, meet),
    schedule ? Promise.resolve(schedule) : computeScheduleRows(ctx, meet),
  ]);
  return joinRoster(athletes, rows);
}

/** A roster item as the package sends it (without the join ordinal). */
export function packageAthlete({ j: _j, ...athlete }: RosterItem) {
  return athlete;
}

/** `GET /meets/athletes`: the plain roster (one row per athlete), by name in byte order. */
export function plainRoster(items: readonly RosterItem[], meet: string) {
  return items
    .filter((item) => item.j === 0)
    .sort((a, b) => compareBytes(a.name, b.name))
    .map((item) => ({
      member_id: item.member_id,
      adaptive: item.adaptive,
      age: item.age,
      club: item.club,
      entry_total: item.entry_total,
      gender: item.gender,
      meet,
      name: item.name,
      session_number: item.session?.session_number ?? null,
      session_platform: item.session?.session_platform ?? null,
      weight_class: item.weight_class,
      wso: item.wso,
    }));
}

/**
 * `GET /meets/athletes-sessions`. Narrowed by session and/or platform
 * (case-folded) it is an inner join, so athletes without a matching schedule
 * row drop out; unfiltered it is the left join.
 */
export function athletesWithSessions(items: readonly RosterItem[], sessionNumber?: number, platform?: string): SessionRow[] {
  const rows = items.map(sessionRow);
  return sessionNumber === undefined && platform === undefined ? rows : narrowSessions(rows, sessionNumber, platform);
}

function sessionRow(item: RosterItem) {
  return {
    member_id: item.member_id,
    name: item.name,
    age: item.age,
    club: item.club,
    wso: item.wso,
    gender: item.gender,
    weight_class: item.weight_class,
    entry_total: item.entry_total,
    adaptive: item.adaptive,
    session_number: item.session?.session_number ?? null,
    session_platform: item.session?.session_platform ?? null,
    date: item.session?.date ?? null,
    start_time: item.session?.start_time ?? null,
    weigh_in_time: item.session?.weigh_in_time ?? null,
  };
}

/** One row of `/meets/athletes-sessions`. */
export type SessionRow = ReturnType<typeof sessionRow>;

export const isSessionRow = (item: unknown): item is SessionRow =>
  isRecord(item) && typeof item.name === 'string' && 'date' in item && 'session_number' in item && 'session_platform' in item;

/**
 * The inner-join narrowing of the (left-joined) start list: rows of a
 * scheduled session (a matching schedule row, so a date) in `sessionNumber`
 * and on `platform` (case-folded), each when given. The query narrows a
 * stored view with it, and `athletesWithSessions` a computed list.
 */
export function narrowSessions(rows: readonly SessionRow[], sessionNumber?: number, platform?: string): SessionRow[] {
  const platformKey = platform === undefined ? undefined : normalizeName(platform);
  return rows.filter(
    (row) =>
      row.date !== null &&
      row.session_number !== null &&
      row.session_platform !== null &&
      (sessionNumber === undefined || row.session_number === sessionNumber) &&
      (platformKey === undefined || normalizeName(row.session_platform) === platformKey),
  );
}

export type MeetRowTable = 'lifting_results' | 'athletes';

export async function nextMeetRow(ctx: QueryCtx, table: MeetRowTable, after: string | null) {
  if (table === 'lifting_results') {
    return await ctx.db
      .query('lifting_results')
      .withIndex('by_meet', (q) => (after === null ? q : q.gt('meet', after)))
      .first();
  }
  return await ctx.db
    .query('athletes')
    .withIndex('by_meet', (q) => (after === null ? q : q.gt('meet', after)))
    .first();
}

export async function meetHasRows(ctx: QueryCtx, table: MeetRowTable, meet: string): Promise<boolean> {
  if (table === 'lifting_results') {
    return (
      (await ctx.db
        .query('lifting_results')
        .withIndex('by_meet', (q) => q.eq('meet', meet))
        .first()) !== null
    );
  }
  return (
    (await ctx.db
      .query('athletes')
      .withIndex('by_meet', (q) => q.eq('meet', meet))
      .first()) !== null
  );
}

export function linkedResultTitles(ctx: QueryCtx, meet: string) {
  return ctx.db.query('meet_result_titles').withIndex('by_meet', (q) => q.eq('meet', meet));
}

export function resultTitlesOf(meet: string, linked: readonly { title: string }[]): string[] {
  return [meet, ...linked.map((row) => row.title).filter((title) => title !== meet)];
}

export async function meetResultTitles(ctx: QueryCtx, meet: string): Promise<string[]> {
  return resultTitlesOf(meet, await readAll(linkedResultTitles(ctx, meet), MEET_RESULT_TITLES_MAX, 'results titles linked to one meet'));
}

/** A meet's results under its own name and every results title linked to it. */
export async function meetResultDocs(ctx: QueryCtx, meet: string): Promise<Doc<'lifting_results'>[]> {
  const titles = await meetResultTitles(ctx, meet);
  const groups = await Promise.all(
    titles.map((title) =>
      readAll(
        ctx.db
          .query('lifting_results')
          .withIndex('by_meet', (q) => q.eq('meet', title)),
        MEET_RESULTS_MAX,
        'results of one meet',
      ),
    ),
  );
  return groups.flat();
}

export function byNameThenNewest(a: { name: string; date: string }, b: { name: string; date: string }): number {
  return compareCollated(a.name, b.name) || compareBytes(b.date, a.date);
}

export async function computeMeetResults(ctx: QueryCtx, meet: string): Promise<ApiLiftingResult[]> {
  return (await meetResultDocs(ctx, meet)).sort(byNameThenNewest).map(toApiLiftingResult);
}

/**
 * One result reduced to what year bests need: `[date, snatch, cj, total]`,
 * the lifts being the best of the recorded best and every attempt.
 */
export type TimelinePoint = [string, number, number, number];

/** An athlete's points since the horizon, keyed by folded name. */
export type Timeline = [string, TimelinePoint[]];

/**
 * The timelines view: the roster's distinct spellings (the keys of the year
 * bests answer), then one timeline per folded name.
 */
export type TimelinesView = [['names', string[]], ...Timeline[]];

const isTimelinePoint = (point: unknown): point is TimelinePoint =>
  Array.isArray(point) && point.length === 4 && typeof point[0] === 'string' && typeof point[1] === 'number' && typeof point[2] === 'number' && typeof point[3] === 'number';

const isTimeline = isPairOf(isString, isListOf(isTimelinePoint));

export function readTimelinesView(items: readonly unknown[]): { names: string[]; timelines: Timeline[] } {
  const [first, ...rest] = items;
  if (!isPairOf(isString, isStringList)(first) || first[0] !== 'names' || !isListOf(isTimeline)(rest)) throw new Error('the timelines view is not stored in the shape it is read in');
  return { names: first[1], timelines: rest };
}

function timelinePoint(row: Doc<'lifting_results'>): TimelinePoint {
  const bests = accumulateBests(ZERO_BESTS, row);
  return [row.date, bests.best_snatch, bests.best_cj, bests.best_total];
}

/**
 * Reads in flight at once: a national meet's roster runs past a thousand
 * athletes, above the concurrent reads one Convex function may have open.
 */
export const TIMELINE_READ_BATCH = 250;

export async function computeTimelines(ctx: QueryCtx, names: readonly string[], horizon: string): Promise<Timeline[]> {
  const keys = Array.from(new Set(names.map(normalizeName))).sort(compareBytes);
  return mapInBatches(keys, TIMELINE_READ_BATCH, async (key): Promise<Timeline> => {
    const rows = await readAll(
      ctx.db
        .query('lifting_results')
        .withIndex('by_nameKey_and_date', (q) => q.eq('nameKey', key).gte('date', horizon)),
      ATHLETE_RESULTS_MAX,
      'results of one athlete',
    );
    return [key, rows.map(timelinePoint)];
  });
}

/**
 * Bests since `sinceDate` for each distinct spelling in `names`, in byte
 * order; athletes with no results in the window get zeros
 * (`year_bests_from_rows`). `timelines` must cover `sinceDate`.
 */
export function yearBestsFromTimelines(
  names: readonly string[],
  timelines: readonly Timeline[],
  sinceDate: string,
): NamedBests[] {
  const byKey = new Map<string, YearBests>();
  for (const [key, points] of timelines) {
    const bests = bestsSince(points, sinceDate);
    if (bests) byKey.set(key, bests);
  }
  return namedBests(names, byKey);
}

/**
 * The package up to (not including) its year bests and closing brace:
 * `{"meet":…,"schedule":…,"athletes":…,"meet_results":…`. Stored as one view
 * so a package is two reads (this and the timelines), and closed by the query
 * with `,"year_bests":[…]}` or `}`.
 */
export function packageStaticText(
  meet: ApiMeet,
  schedule: readonly ApiScheduleRow[],
  athletes: readonly unknown[],
  results: readonly ApiLiftingResult[],
): string {
  return (
    `{"meet":${JSON.stringify(meet)},"schedule":${JSON.stringify(packageSchedule(schedule))},` +
    `"athletes":${JSON.stringify(athletes)},"meet_results":${JSON.stringify(results)}`
  );
}

export * from './clubStats';
