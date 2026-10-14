import { v } from 'convex/values';
import { premiumQuery } from './lib/access';
import { query, type QueryCtx } from './_generated/server';
import { etagOf, revalidated, revalidatedText, type Revalidated } from './lib/etag';
import {
  addMonths,
  athletesWithSessions,
  computeMeetResults,
  computeRoster,
  computeScheduleRows,
  computeTimelines,
  joinRoster,
  meetByName,
  meetResultDocs,
  meetResultTitles,
  meetLocalDate,
  narrowSessions,
  packageAthlete,
  packageStaticText,
  plainRoster,
  rosterNames,
  toApiMeet,
  yearBestsFromTimelines,
  type ApiScheduleRow,
  type SessionRow,
  type Timeline,
  type TimelinesView,
  type ZoneFormatters,
} from './lib/meetData';
import { normalizeName } from './lib/names';
import { compareBytes } from './lib/sort';
import { meetKey, meetSessionKey } from './lib/viewKeys';
import { readFreshView } from './lib/views';
import { apiError, isMeetTimeZone, requireIsoDate, requireNonEmpty } from './lib/validation';

// `GET /meets*`: each query answers the JSON of the Rust route of the same
// name in `meetcal-backend/app/src/routes/meets`, from the meet's views when
// they are fresh (`convex/views.ts`) and computed live otherwise. Large
// answers travel as JSON text (`{ json }`, or `{ etag, json }` when
// conditional); see `convex/lib/views.ts`.

const UPCOMING_WINDOW_MONTHS = 3;

/**
 * `GET /meets`: meets that are not completed and start within three months of
 * today in the meet's own time zone, soonest first.
 *
 * `now` comes from the client, rounded to the hour: a query that read the
 * clock itself would stay cached past the moment the window moves (Convex
 * re-runs a query when its data changes, never when time passes).
 */
/**
 * How far the client's `now` may be from the server's before it is ignored.
 * The app sends its hour, corrected by a server clock sample once it has one;
 * the first request of a process has none, and a device clock months off
 * would otherwise get a short or empty list (Rust always used its own clock).
 */
const MAX_CLIENT_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;

/**
 * The instant the upcoming window is measured from. `now` must be a whole
 * hour, as every client rounds it: it is the cache key, and a caller varying
 * it by the millisecond would otherwise miss the cache on every call. The
 * 400 costs no read. A `now` further than a day from the server's clock gives
 * way to the server's hour.
 */
export function upcomingWindowNow(clientNow: number, serverNow: number): number {
  if (!Number.isFinite(clientNow) || clientNow % HOUR_MS !== 0) {
    throw apiError(400, 'now must be a whole hour in milliseconds (rounded down)');
  }
  if (Math.abs(clientNow - serverNow) <= MAX_CLIENT_CLOCK_SKEW_MS) return clientNow;
  return Math.floor(serverNow / HOUR_MS) * HOUR_MS;
}

/**
 * A row that is no event: a test entry typed into a source, with its venue
 * written as one character ("q") and a time zone that is no IANA zone ("q",
 * "America_New_York"). The meet lists leave it out; a real meet whose zone
 * is unknown (blank) still has a venue, or a "TBD" one.
 */
export function isPlaceholderMeet(meet: { timeZone: string; venueName: string; venueCity: string }): boolean {
  return !isMeetTimeZone(meet.timeZone) && [meet.venueName, meet.venueCity].every((field) => field.trim().length === 1);
}

export const list = query({
  args: { now: v.number(), ifNoneMatch: v.optional(v.string()) },
  handler: async (ctx, { now: clientNow, ifNoneMatch }) => {
    const now = upcomingWindowNow(clientNow, Date.now());
    const [upcoming, ongoing] = await Promise.all(
      (['upcoming', 'ongoing'] as const).map((status) =>
        ctx.db
          .query('meets')
          .withIndex('by_status_and_start_date', (q) => q.eq('status', status))
          .collect(),
      ),
    );
    const formatters: ZoneFormatters = new Map();
    const meets = [...upcoming, ...ongoing]
      .filter((meet) => !isPlaceholderMeet(meet) && meet.startDate <= addMonths(meetLocalDate(now, meet.timeZone, formatters), UPCOMING_WINDOW_MONTHS))
      .sort((a, b) => compareBytes(a.startDate, b.startDate));
    return revalidated(meets.map(toApiMeet), ifNoneMatch);
  },
});

/** `GET /meets/completed`: completed meets, newest first (test entries left out, `isPlaceholderMeet`). */
export const completed = query({
  args: { ifNoneMatch: v.optional(v.string()) },
  handler: async (ctx, { ifNoneMatch }) => {
    const meets = await ctx.db
      .query('meets')
      .withIndex('by_status_and_start_date', (q) => q.eq('status', 'completed'))
      .order('desc')
      .collect();
    return revalidated(meets.filter((meet) => !isPlaceholderMeet(meet)).map(toApiMeet), ifNoneMatch);
  },
});

/** Meet names per `meets:namesPage` call, unless the caller asks for fewer. */
export const MEET_NAMES_PAGE_SIZE = 500;
/** The most meets `meets:attendance` counts in one call. */
export const MAX_ATTENDANCE_MEETS = 8;

/**
 * Every distinct meet name in the results (`source: 'results'`) or the registrations
 * (`'registrations'`), in name order after `after` and before `before` (when given), a page at a
 * time: one read per meet, skipping along the meet index, so the whole history is listable however
 * many rows it holds. Pass back `next` until it is null. Callers can list several name ranges at
 * once. Results meets carry one of their dates. Answers `{ json, next }`, the meets as JSON text
 * (`[{ meet, date }]`).
 */
export const namesPage = query({
  args: {
    source: v.union(v.literal('results'), v.literal('registrations')),
    after: v.union(v.string(), v.null()),
    before: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { source, after, before, limit }) => {
    const pageSize = limit ?? MEET_NAMES_PAGE_SIZE;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MEET_NAMES_PAGE_SIZE) {
      throw apiError(400, `limit must be a whole number from 1 to ${MEET_NAMES_PAGE_SIZE}`);
    }
    const meets: { meet: string; date: string | null }[] = [];
    let last = after;
    while (meets.length < pageSize) {
      const from = last;
      const row =
        source === 'results'
          ? await ctx.db
              .query('lifting_results')
              .withIndex('by_meet', (q) => (from === null ? q : q.gt('meet', from)))
              .first()
          : await ctx.db
              .query('athletes')
              .withIndex('by_meet', (q) => (from === null ? q : q.gt('meet', from)))
              .first();
      if (!row || (before !== undefined && row.meet >= before)) {
        return { json: JSON.stringify(meets), next: null };
      }
      meets.push({ meet: row.meet, date: 'date' in row ? row.date : null });
      last = row.meet;
    }
    return { json: JSON.stringify(meets), next: last };
  },
});

/**
 * How many took part in each of `meets` (at most eight): lifters with results, and entries
 * registered (a meet can have its roster before its results), with the results' dates and the
 * meet's own dates and status when MeetCal tracks it.
 */
export const attendance = query({
  args: { meets: v.array(v.string()) },
  handler: async (ctx, { meets }) => {
    if (meets.length > MAX_ATTENDANCE_MEETS) {
      throw apiError(400, `meets exceeds the ${MAX_ATTENDANCE_MEETS}-meet limit`);
    }
    const rows = [];
    for (const meet of meets) {
      const [results, titles, registrations, meetRow] = await Promise.all([
        // Its linked results titles too (a combined national event, #362).
        meetResultDocs(ctx, meet),
        meetResultTitles(ctx, meet),
        ctx.db
          .query('athletes')
          .withIndex('by_meet', (q) => q.eq('meet', meet))
          .collect(),
        meetByName(ctx, meet),
      ]);
      const dates = results.map((r) => r.date).sort(compareBytes);
      rows.push({
        meet,
        lifters: new Set(results.map((r) => normalizeName(r.name))).size,
        registrations: new Set(registrations.map((r) => r.memberId || normalizeName(r.name))).size,
        first_date: dates[0] ?? null,
        last_date: dates[dates.length - 1] ?? null,
        start_date: meetRow?.startDate ?? null,
        end_date: meetRow?.endDate ?? null,
        status: meetRow?.status ?? null,
        // The linked results titles counted here, so a caller that also
        // asks for them by name does not count their lifters twice.
        results_titles: titles.slice(1),
      });
    }
    return { json: JSON.stringify(rows) };
  },
});

/** `GET /meets/details`; a missing meet is the Rust API's 404. */
export const details = query({
  args: { meet: v.string(), ifNoneMatch: v.optional(v.string()) },
  handler: async (ctx, { meet, ifNoneMatch }) => {
    requireNonEmpty('meet', meet);
    const row = await meetByName(ctx, meet);
    if (!row) throw apiError(404, 'meet not found');
    return revalidated(toApiMeet(row), ifNoneMatch);
  },
});

/** `GET /meets/schedule`: ordered by date, session, platform. */
export const schedule = query({
  args: { meet: v.string(), ifNoneMatch: v.optional(v.string()) },
  handler: async (ctx, { meet, ifNoneMatch }) => {
    requireNonEmpty('meet', meet);
    const view = await readFreshView<ApiScheduleRow>(ctx, meetKey(meet, 'schedule'));
    if (view) return await revalidatedText(view.etag, view.json, ifNoneMatch);
    return revalidated(await computeScheduleRows(ctx, meet), ifNoneMatch);
  },
});

/** `GET /meets/athletes`: the roster, by name. Answers `{ json }`. */
export const athletes = query({
  args: { meet: v.string() },
  handler: async (ctx, { meet }) => {
    requireNonEmpty('meet', meet);
    const view = await readFreshView(ctx, meetKey(meet, 'athletes'));
    if (view) return { json: await view.json() };
    return { json: await liveAthletesJson(ctx, meet) };
  },
});

export async function liveAthletesJson(ctx: QueryCtx, meet: string): Promise<string> {
  return JSON.stringify(plainRoster(await computeRoster(ctx, meet), meet));
}

/**
 * `GET /meets/athletes-sessions`: athletes with their session's date and
 * times. Narrowed by session and/or platform (case-folded), the join is an
 * inner one; unfiltered it is a left join, so unscheduled athletes stay.
 * Answers `{ json }`.
 */
export const athletesSessions = query({
  args: {
    meet: v.string(),
    sessionNumber: v.optional(v.number()),
    platform: v.optional(v.string()),
  },
  handler: async (ctx, { meet, sessionNumber, platform }) => {
    requireNonEmpty('meet', meet);
    const narrowed = sessionNumber !== undefined || platform !== undefined;
    if (sessionNumber !== undefined) {
      // One session: its own view is a few dozen rows. A session without
      // athletes has no view, and falls through to narrowing the whole list.
      const sessionView = await readFreshView<SessionRow>(ctx, meetSessionKey(meet, sessionNumber));
      if (sessionView) {
        if (platform === undefined) return { json: await sessionView.json() };
        return { json: JSON.stringify(narrowSessions(await sessionView.items(), sessionNumber, platform)) };
      }
    }
    const view = await readFreshView<SessionRow>(ctx, meetKey(meet, 'sessions'));
    if (view) {
      if (!narrowed) return { json: await view.json() };
      return { json: JSON.stringify(narrowSessions(await view.items(), sessionNumber, platform)) };
    }
    return { json: await liveSessionsJson(ctx, meet, sessionNumber, platform) };
  },
});

export async function liveSessionsJson(
  ctx: QueryCtx,
  meet: string,
  sessionNumber: number | undefined,
  platform: string | undefined,
): Promise<string> {
  if (sessionNumber === undefined) {
    return JSON.stringify(athletesWithSessions(await computeRoster(ctx, meet), undefined, platform));
  }
  // Narrowed to one session: read that session's athletes only.
  const [sessionAthletes, scheduleRows] = await Promise.all([
    ctx.db
      .query('athletes')
      .withIndex('by_meet_and_session', (q) => q.eq('meet', meet).eq('sessionNumber', sessionNumber))
      .collect(),
    computeScheduleRows(ctx, meet),
  ]);
  return JSON.stringify(athletesWithSessions(joinRoster(sessionAthletes, scheduleRows), sessionNumber, platform));
}

// ---------------------------------------------------------------------------
// `GET /meets/package`
// ---------------------------------------------------------------------------


/** Closes a `packageStaticText` with the year bests section when asked for. */
function closePackage(staticText: string, yearBests: unknown | undefined): string {
  return yearBests === undefined ? `${staticText}}` : `${staticText},"year_bests":${JSON.stringify(yearBests)}}`;
}

/**
 * `GET /meets/package`: meet, schedule, roster (with each athlete's session
 * times), the meet's results, and optionally each athlete's bests over the
 * year after `historyCutoffDate` (as `year_bests`, see `NamedBests`). Asking
 * for `year_bests` (the default) without `historyCutoffDate` is a 400; pass
 * `include: []` for the package without them.
 *
 * From views, the package is concatenated from the sections' stored text.
 * Without a fresh view for every section it is computed live
 * (`livePackageJson`). Either way the tag is the hash of the whole text, so
 * a client's tag survives the views going stale and being rebuilt.
 */
export const packageForMeet = premiumQuery('meets:packageForMeet', {
  args: {
    meet: v.string(),
    historyCutoffDate: v.optional(v.string()),
    include: v.optional(v.array(v.string())),
    ifNoneMatch: v.optional(v.string()),
  },
  handler: async (ctx, { meet, historyCutoffDate, include, ifNoneMatch }) => {
    requireNonEmpty('meet', meet);
    requireIsoDate('history_cutoff_date', historyCutoffDate);
    // Without `include`, the one section this port serves.
    const sections = new Set(include ?? ['year_bests']);
    for (const section of sections) {
      // The app asks for `year_bests` only; the attempt estimator and the
      // two-year history were never ported, so asking is a client bug.
      if (section !== 'year_bests') throw apiError(400, `include section '${section}' is not supported`);
    }

    const wantBests = sections.has('year_bests');
    // Without a cutoff there is no window to take bests over, and `[]` would
    // read as "nobody has bests".
    if (wantBests && historyCutoffDate === undefined) {
      throw apiError(400, 'history_cutoff_date is required for year_bests');
    }
    const bestsSince = wantBests && historyCutoffDate !== undefined ? addMonths(historyCutoffDate, 12) : undefined;

    const [staticView, timelinesView] = await Promise.all([
      readFreshView(ctx, meetKey(meet, 'package_static')),
      bestsSince === undefined ? Promise.resolve(null) : readFreshView<TimelinesView[number]>(ctx, meetKey(meet, 'timelines')),
    ]);
    const timelinesUsable =
      timelinesView !== null && timelinesView.meta !== undefined && bestsSince !== undefined && timelinesView.meta <= bestsSince;

    // A fresh static view implies the meet row exists (the view embeds it).
    // The tag is the hash of the text served, as on the live path below: a
    // tag derived from the views' own would change every time the views go
    // stale and come back, sending every client the unchanged package twice.
    if (staticView && (bestsSince === undefined || timelinesUsable)) {
      const [staticText, timelineItems] = await Promise.all([
        staticView.text(),
        bestsSince === undefined ? Promise.resolve(null) : timelinesView!.items(),
      ]);
      let yearBests: unknown;
      if (wantBests) {
        if (timelineItems === null || bestsSince === undefined) {
          yearBests = [];
        } else {
          const [[, names], ...timelines] = timelineItems as TimelinesView;
          yearBests = names.length > 0 ? yearBestsFromTimelines(names, timelines as Timeline[], bestsSince) : [];
        }
      }
      return textAnswer(closePackage(staticText, yearBests), ifNoneMatch);
    }

    // Only the year bests are stale (a roster athlete's results changed): the
    // static part still serves, and only the bests are computed (#216).
    if (staticView && bestsSince !== undefined) {
      const names = await rosterNames(ctx, meet);
      const [staticText, timelines] = await Promise.all([
        staticView.text(),
        names.length > 0 ? computeTimelines(ctx, names, bestsSince) : Promise.resolve([]),
      ]);
      const yearBests = names.length > 0 ? yearBestsFromTimelines(names, timelines, bestsSince) : [];
      return textAnswer(closePackage(staticText, yearBests), ifNoneMatch);
    }

    const meetRow = await meetByName(ctx, meet);
    if (!meetRow) throw apiError(404, 'meet not found');
    const apiMeet = toApiMeet(meetRow);
    const json = await livePackageJson(ctx, meet, apiMeet, bestsSince, wantBests);
    return textAnswer(json, ifNoneMatch);
  },
});

/** Answers `json`, tagged with its hash, or the tag alone when the client holds it. */
function textAnswer(json: string, ifNoneMatch: string | undefined): Promise<Revalidated> {
  return revalidatedText(etagOf(json), async () => json, ifNoneMatch);
}

/** The package computed from the tables, without any view. */
export async function livePackageJson(
  ctx: QueryCtx,
  meet: string,
  apiMeet: ReturnType<typeof toApiMeet>,
  bestsSince: string | undefined,
  wantBests: boolean,
): Promise<string> {
  const schedule = await computeScheduleRows(ctx, meet);
  const roster = await computeRoster(ctx, meet, schedule);
  let yearBests: unknown;
  if (wantBests) {
    const names = roster.map((a) => a.name);
    yearBests =
      bestsSince !== undefined && names.length > 0
        ? yearBestsFromTimelines(names, await computeTimelines(ctx, names, bestsSince), bestsSince)
        : [];
  }
  const staticText = packageStaticText(apiMeet, schedule, roster.map(packageAthlete), await computeMeetResults(ctx, meet));
  return closePackage(staticText, yearBests);
}
