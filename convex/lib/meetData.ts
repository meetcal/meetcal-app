import type { QueryCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { normalizeName } from './names';
import {
  accumulateBests,
  toApiLiftingResult,
  ZERO_BESTS,
  type ApiLiftingResult,
  type NamedBests,
  type YearBests,
} from './results';
import { compareBytes, compareCollated } from './sort';

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

export async function meetByName(ctx: QueryCtx, name: string): Promise<Doc<'meets'> | null> {
  return await ctx.db
    .query('meets')
    .withIndex('by_name', (q) => q.eq('name', name))
    .first();
}

/** Postgres `date + INTERVAL 'n months'`: same day, clamped to the month's end. */
export function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

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
  return await ctx.db
    .query('session_schedule')
    .withIndex('by_meet', (q) => q.eq('meet', meet))
    .collect();
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
    platforms: { platform: string; weight_class: string }[];
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
    session.platforms.push({ platform: row.platform, weight_class: row.weight_class });
  }
  return days;
}

// ---------------------------------------------------------------------------
// Roster (athletes joined with their session's schedule row)
// ---------------------------------------------------------------------------

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

async function rosterDocs(ctx: QueryCtx, meet: string): Promise<Doc<'athletes'>[]> {
  return await ctx.db
    .query('athletes')
    .withIndex('by_meet', (q) => q.eq('meet', meet))
    .collect();
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
    const hasSession = athlete.sessionNumber !== undefined && athlete.sessionPlatform !== undefined;
    const matches = hasSession ? (bySession.get(scheduleKey(athlete.sessionNumber!, athlete.sessionPlatform!)) ?? []) : [];
    const joined = matches.length === 0 ? [undefined] : matches;
    joined.forEach((s, j) => {
      items.push({
        member_id: athlete.memberId,
        name: athlete.name,
        age: athlete.age,
        club: athlete.club,
        wso: athlete.wso ?? null,
        gender: athlete.gender,
        weight_class: athlete.weightClass,
        entry_total: athlete.entryTotal,
        adaptive: athlete.adaptive,
        session: hasSession
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
export function athletesWithSessions(items: readonly RosterItem[], sessionNumber?: number, platform?: string) {
  const platformKey = platform === undefined ? undefined : normalizeName(platform);
  const filtered = sessionNumber !== undefined || platformKey !== undefined;
  const rows = [];
  for (const item of items) {
    if (filtered) {
      if (!item.session || item.session.date === null) continue;
      if (sessionNumber !== undefined && item.session.session_number !== sessionNumber) continue;
      if (platformKey !== undefined && normalizeName(item.session.session_platform) !== platformKey) continue;
    }
    rows.push({
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
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Results, bests
// ---------------------------------------------------------------------------

async function meetResultDocs(ctx: QueryCtx, meet: string): Promise<Doc<'lifting_results'>[]> {
  return await ctx.db
    .query('lifting_results')
    .withIndex('by_meet', (q) => q.eq('meet', meet))
    .collect();
}

/** The package's `meet_results`: by name (SQL text order), newest first within a name. */
export async function computeMeetResults(ctx: QueryCtx, meet: string): Promise<ApiLiftingResult[]> {
  return (await meetResultDocs(ctx, meet))
    .sort((a, b) => compareCollated(a.name, b.name) || compareBytes(b.date, a.date))
    .map(toApiLiftingResult);
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

function timelinePoint(row: Doc<'lifting_results'>): TimelinePoint {
  const bests = accumulateBests(ZERO_BESTS, row);
  return [row.date, bests.best_snatch, bests.best_cj, bests.best_total];
}

/** Each distinct folded name's results since `horizon`, as points. */
export async function computeTimelines(ctx: QueryCtx, names: readonly string[], horizon: string): Promise<Timeline[]> {
  const keys = Array.from(new Set(names.map(normalizeName))).sort(compareBytes);
  return await Promise.all(
    keys.map(async (key): Promise<Timeline> => {
      const rows = await ctx.db
        .query('lifting_results')
        .withIndex('by_nameKey_and_date', (q) => q.eq('nameKey', key).gte('date', horizon))
        .collect();
      return [key, rows.map(timelinePoint)];
    }),
  );
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
    let bests: YearBests | null = null;
    for (const [date, snatch, cj, total] of points) {
      if (date < sinceDate) continue;
      const b: YearBests = bests ?? ZERO_BESTS;
      bests = {
        best_snatch: Math.max(b.best_snatch, snatch),
        best_cj: Math.max(b.best_cj, cj),
        best_total: Math.max(b.best_total, total),
      };
    }
    if (bests) byKey.set(key, bests);
  }
  return Array.from(new Set(names))
    .sort(compareBytes)
    .map((name) => ({ name, ...(byKey.get(normalizeName(name)) ?? ZERO_BESTS) }));
}

// ---------------------------------------------------------------------------
// Club meet stats
// ---------------------------------------------------------------------------

/**
 * One athlete's result at a meet with everything a club summary needs:
 * their roster entry (DISTINCT ON the folded name), their best row at the
 * meet, placings within gender / roster weight class / age label, and their
 * best non-BWL total before the meet.
 */
export type StatsRow = {
  key: string;
  name: string;
  club: string;
  weight_class: string;
  body_weight: number;
  attempts: [number, number, number, number, number, number];
  snatch_best: number;
  cj_best: number;
  total: number;
  placings: [number, number, number];
  previous_best: number | null;
};

/** SQL `RANK()`: one more than the number of strictly better values. */
function rankOf(value: number, group: number[]): number {
  let better = 0;
  for (const other of group) if (other > value) better += 1;
  return better + 1;
}

/**
 * Stats rows for the meet, previous bests filled in only for athletes of
 * `onlyClub` when given (the live path for one club), for everyone otherwise
 * (the view, shared by every club).
 */
export async function computeStatsRows(ctx: QueryCtx, meet: string, onlyClub?: string): Promise<StatsRow[]> {
  const [athletes, results] = await Promise.all([rosterDocs(ctx, meet), meetResultDocs(ctx, meet)]);

  // DISTINCT ON (key) ORDER BY key, name, weight_class, club
  const roster = new Map<string, Doc<'athletes'>>();
  for (const athlete of [...athletes].sort(
    (a, b) =>
      compareCollated(a.name, b.name) || compareCollated(a.weightClass, b.weightClass) || compareCollated(a.club, b.club),
  )) {
    const key = normalizeName(athlete.name);
    if (!roster.has(key)) roster.set(key, athlete);
  }

  // DISTINCT ON (key) ORDER BY key, total DESC, date DESC, id DESC
  const best = new Map<string, Doc<'lifting_results'>>();
  for (const row of results) {
    const key = normalizeName(row.name);
    const current = best.get(key);
    const total = row.total ?? 0;
    const currentTotal = current?.total ?? 0;
    if (
      !current ||
      total > currentTotal ||
      (total === currentTotal &&
        (row.date > current.date || (row.date === current.date && row._creationTime > current._creationTime)))
    ) {
      best.set(key, row);
    }
  }

  const joined: { key: string; row: Doc<'lifting_results'>; athlete: Doc<'athletes'>; group: string }[] = [];
  for (const [key, row] of best) {
    const athlete = roster.get(key);
    if (athlete) joined.push({ key, row, athlete, group: `${athlete.gender}\u0000${athlete.weightClass}\u0000${row.age ?? ''}` });
  }
  const groups = new Map<string, { snatch: number[]; cj: number[]; total: number[] }>();
  for (const { row, group } of joined) {
    const g = groups.get(group) ?? { snatch: [], cj: [], total: [] };
    g.snatch.push(row.snatchBest ?? 0);
    g.cj.push(row.cjBest ?? 0);
    g.total.push(row.total ?? 0);
    groups.set(group, g);
  }

  const wanted = onlyClub === undefined ? joined : joined.filter(({ athlete }) => athlete.club === onlyClub);
  return await Promise.all(
    wanted.map(async ({ key, row, athlete, group }): Promise<StatsRow> => {
      const previous = await ctx.db
        .query('lifting_results')
        .withIndex('by_nameKey_and_date', (q) => q.eq('nameKey', key).lt('date', row.date))
        .collect();
      let previousBest: number | null = null;
      for (const p of previous) {
        if (p.federation === 'BWL' || p.total === undefined) continue;
        previousBest = previousBest === null ? p.total : Math.max(previousBest, p.total);
      }
      const g = groups.get(group)!;
      return {
        key,
        name: row.name,
        club: athlete.club,
        weight_class: athlete.weightClass,
        body_weight: row.bodyWeight ?? 0,
        attempts: [row.snatch1 ?? 0, row.snatch2 ?? 0, row.snatch3 ?? 0, row.cj1 ?? 0, row.cj2 ?? 0, row.cj3 ?? 0],
        snatch_best: row.snatchBest ?? 0,
        cj_best: row.cjBest ?? 0,
        total: row.total ?? 0,
        placings: [rankOf(row.snatchBest ?? 0, g.snatch), rankOf(row.cjBest ?? 0, g.cj), rankOf(row.total ?? 0, g.total)],
        previous_best: previousBest,
      };
    }),
  );
}

function medalFor(placing: number): string | null {
  return placing === 1 ? 'gold' : placing === 2 ? 'silver' : placing === 3 ? 'bronze' : null;
}

function makeRatePercent(attempts: number[]): number {
  const declared = attempts.filter((a) => a !== 0).length;
  if (declared === 0) return 0;
  const made = attempts.filter((a) => a > 0).length;
  return Math.round((made / declared) * 100);
}

/** `GET /clubs/meet-stats` from the meet's stats rows and the club's roster count. */
export function clubStats(rows: readonly StatsRow[], club: string, totalAthletes: number) {
  const clubRows = rows.filter((r) => r.club === club).sort((a, b) => compareCollated(a.name, b.name));
  let gold = 0;
  let silver = 0;
  let bronze = 0;
  const snatchAttempts: number[] = [];
  const cjAttempts: number[] = [];
  const athleteResults = clubRows.map((r) => {
    for (const placing of r.placings) {
      if (placing === 1) gold += 1;
      else if (placing === 2) silver += 1;
      else if (placing === 3) bronze += 1;
    }
    snatchAttempts.push(...r.attempts.slice(0, 3));
    cjAttempts.push(...r.attempts.slice(3));
    const [snatchPlacing, cjPlacing, totalPlacing] = r.placings;
    return {
      name: r.name,
      weight_class: r.weight_class,
      snatch_best: r.snatch_best,
      cj_best: r.cj_best,
      total: r.total,
      body_weight: r.body_weight,
      medal: medalFor(totalPlacing),
      snatch_medal: medalFor(snatchPlacing),
      cj_medal: medalFor(cjPlacing),
      total_medal: medalFor(totalPlacing),
      is_pr: r.previous_best !== null && r.total > r.previous_best,
      perfect_lifts: r.attempts.every((a) => a > 0),
    };
  });
  return {
    total_athletes: totalAthletes,
    gold_medals: gold,
    silver_medals: silver,
    bronze_medals: bronze,
    total_prs: athleteResults.filter((r) => r.is_pr).length,
    perfect_6_for_6: athleteResults.filter((r) => r.perfect_lifts).length,
    total_weight_lifted: athleteResults.reduce((sum, r) => sum + r.total, 0),
    snatch_make_rate: makeRatePercent(snatchAttempts),
    cj_make_rate: makeRatePercent(cjAttempts),
    combined_make_rate: makeRatePercent([...snatchAttempts, ...cjAttempts]),
    athlete_results: athleteResults,
  };
}

/** `COUNT(DISTINCT folded name)` of the club's entries at the meet. */
export function clubAthleteCount(roster: readonly { name: string; club: string }[], club: string): number {
  return new Set(roster.filter((a) => a.club === club).map((a) => normalizeName(a.name))).size;
}

/** Each club's `COUNT(DISTINCT folded name)` at the meet, as `[club, count]` pairs. */
export function clubAthleteCounts(roster: readonly { name: string; club: string }[]): [string, number][] {
  const byClub = new Map<string, Set<string>>();
  for (const athlete of roster) {
    const keys = byClub.get(athlete.club) ?? new Set<string>();
    keys.add(normalizeName(athlete.name));
    byClub.set(athlete.club, keys);
  }
  return [...byClub.entries()].map(([club, keys]): [string, number] => [club, keys.size]).sort((a, b) => compareBytes(a[0], b[0]));
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
