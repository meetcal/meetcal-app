import { v } from 'convex/values';
import { query, type QueryCtx } from './_generated/server';
import { etagOf, revalidated, revalidatedText } from './lib/etag';
import {
  addMonths,
  athletesWithSessions,
  computeMeetResults,
  computeRoster,
  computeScheduleRows,
  computeTimelines,
  joinRoster,
  meetByName,
  meetLocalDate,
  packageAthlete,
  packageStaticText,
  plainRoster,
  toApiMeet,
  yearBestsFromTimelines,
  type ApiScheduleRow,
  type Timeline,
  type TimelinesView,
  type ZoneFormatters,
} from './lib/meetData';
import { normalizeName } from './lib/names';
import { compareBytes } from './lib/sort';
import { meetKey, meetSessionKey } from './lib/viewKeys';
import { readFreshView } from './lib/views';
import { apiError, requireIsoDate, requireNonEmpty } from './lib/validation';

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

export const list = query({
  args: { now: v.number(), ifNoneMatch: v.optional(v.string()) },
  handler: async (ctx, { now: clientNow, ifNoneMatch }) => {
    const now = Math.abs(clientNow - Date.now()) > MAX_CLIENT_CLOCK_SKEW_MS ? Date.now() : clientNow;
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
      .filter((meet) => meet.startDate <= addMonths(meetLocalDate(now, meet.timeZone, formatters), UPCOMING_WINDOW_MONTHS))
      .sort((a, b) => compareBytes(a.startDate, b.startDate));
    return revalidated(meets.map(toApiMeet), ifNoneMatch);
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

type SessionRow = ReturnType<typeof athletesWithSessions>[number];

/** The inner-join narrowing of the unfiltered (left-joined) start list. */
function narrowSessions(rows: SessionRow[], sessionNumber?: number, platform?: string): SessionRow[] {
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
 * year after `historyCutoffDate` (as `year_bests`, see `NamedBests`).
 *
 * From views, the package is concatenated from the sections' stored text and
 * its tag is derived from theirs, so a client holding the current package is
 * answered after reading the meet row and the view headers alone. Without a
 * fresh view for every section it is computed live (`livePackageJson`) and
 * the tag is the hash of the whole text.
 */
export const packageForMeet = query({
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
    const bestsSince = wantBests && historyCutoffDate !== undefined ? addMonths(historyCutoffDate, 12) : undefined;

    const [staticView, timelinesView] = await Promise.all([
      readFreshView(ctx, meetKey(meet, 'package_static')),
      bestsSince === undefined ? Promise.resolve(null) : readFreshView<TimelinesView[number]>(ctx, meetKey(meet, 'timelines')),
    ]);
    const timelinesUsable =
      timelinesView !== null && timelinesView.meta !== undefined && bestsSince !== undefined && timelinesView.meta <= bestsSince;

    // A fresh static view implies the meet row exists (the view embeds it).
    if (staticView && (bestsSince === undefined || timelinesUsable)) {
      const tag = etagOf(
        JSON.stringify([
          staticView.etag,
          bestsSince === undefined ? null : [timelinesView!.etag, bestsSince],
          [...sections].sort(),
        ]),
      );
      return await revalidatedText(
        tag,
        async () => {
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
          return closePackage(staticText, yearBests);
        },
        ifNoneMatch,
      );
    }

    const meetRow = await meetByName(ctx, meet);
    if (!meetRow) throw apiError(404, 'meet not found');
    const apiMeet = toApiMeet(meetRow);
    const json = await livePackageJson(ctx, meet, apiMeet, bestsSince, wantBests);
    return await revalidatedText(etagOf(json), async () => json, ifNoneMatch);
  },
});

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
