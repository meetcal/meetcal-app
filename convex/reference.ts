import { v } from 'convex/values';
import { query, type QueryCtx } from './_generated/server';
import { revalidated, revalidatedText, type Revalidated } from './lib/etag';
import type { Doc } from './_generated/dataModel';
import { clubAthleteCount, clubStats, computeStatsRows, readStatsViewItems } from './lib/meetData';
import {
  ADAPTIVE_RECORDS_SEASON_START,
  clubNamesPage,
  computeAdaptiveRecords,
  computeIntlRankings,
  computeNationalRankingsForYear,
  computeQualifyingTotals,
  computeRecords,
  computeStandards,
  computeWsoList,
  computeWsoRows,
  distinctCollated,
  filterWsoRows,
  nationalRankingPage,
  wsoAgeGroups as ageGroupsOf,
  type WsoRecordRow,
} from './lib/referenceData';
import { compareCollated } from './lib/sort';
import { adaptiveKey, ADAPTIVE_VIEW_ARGS, meetKey, natKey, REF_VIEWS, wsoKey } from './lib/viewKeys';
import { readFreshView, readViewAnyAge } from './lib/views';
import { apiError, requireNonEmpty } from './lib/validation';

// Reference data and clubs: each query answers the JSON of the Rust route of
// the same name in `meetcal-backend/app/src/routes/{comp_data,clubs}`, from a
// view when it is fresh (`convex/views.ts`) and computed live otherwise.

const ifNoneMatch = v.optional(v.string());

/** The view's text as the answer, or `compute()` when there is no fresh view. */
async function viewOrLive(
  ctx: QueryCtx,
  key: string,
  ifNoneMatch: string | undefined,
  compute: () => Promise<unknown>,
): Promise<Revalidated> {
  const view = await readFreshView(ctx, key);
  if (view) return await revalidatedText(view.etag, view.json, ifNoneMatch);
  return revalidated(await compute(), ifNoneMatch);
}

/** `GET /data/records` */
export const records = query({
  args: { ifNoneMatch },
  handler: async (ctx, args) => await viewOrLive(ctx, REF_VIEWS.records, args.ifNoneMatch, () => computeRecords(ctx)),
});

/** `GET /data/standards` */
export const standards = query({
  args: { ifNoneMatch },
  handler: async (ctx, args) => await viewOrLive(ctx, REF_VIEWS.standards, args.ifNoneMatch, () => computeStandards(ctx)),
});

/** `GET /data/qualifying-totals` */
export const qualifyingTotals = query({
  args: { ifNoneMatch },
  handler: async (ctx, args) =>
    await viewOrLive(ctx, REF_VIEWS.qualifying_totals, args.ifNoneMatch, () => computeQualifyingTotals(ctx)),
});

/** `GET /data/intl-rankings` */
export const intlRankings = query({
  args: { ifNoneMatch },
  handler: async (ctx, args) =>
    await viewOrLive(ctx, REF_VIEWS.intl_rankings, args.ifNoneMatch, () => computeIntlRankings(ctx)),
});

/**
 * The view's text whatever its age; without one, `compute()` when it fits
 * one query (null when it does not). For answers whose live computation can
 * be more than one query may read: the last complete build, at most a
 * refresh behind, beats an error.
 */
async function viewAnyAgeOrBounded(
  ctx: QueryCtx,
  key: string,
  ifNoneMatch: string | undefined,
  compute: () => Promise<unknown | null>,
): Promise<Revalidated> {
  const view = await readViewAnyAge(ctx, key);
  if (view) return await revalidatedText(view.etag, view.json, ifNoneMatch);
  const answer = await compute();
  // Only a large answer the refresh has not built yet (seconds after its
  // first rows were written).
  if (answer === null) throw apiError(503, 'this list is being built; try again in a minute');
  return revalidated(answer, ifNoneMatch);
}

/** `GET /data/nat-rankings`: each athlete's best total in the class, heaviest first. */
export const nationalRankings = query({
  args: { federation: v.string(), ageCategory: v.string(), ifNoneMatch },
  handler: async (ctx, args) =>
    await viewAnyAgeOrBounded(ctx, natKey(args.federation, args.ageCategory), args.ifNoneMatch, async () => {
      // A class with no view has no results, or is new: one page answers it.
      const page = await nationalRankingPage(ctx, args.federation, args.ageCategory, null);
      return page.isDone ? page.rows : null;
    }),
});

/** `GET /data/nat-rankings-year`: `nationalRankings` within one calendar year, with dates. */
export const nationalRankingsByYear = query({
  args: { federation: v.string(), ageCategory: v.string(), year: v.string(), ifNoneMatch },
  handler: async (ctx, args) => {
    if (!/^\d{4}$/.test(args.year)) throw apiError(400, 'year must be a four-digit year');
    const rankings = await computeNationalRankingsForYear(ctx, args.federation, args.ageCategory, args.year);
    return revalidated(rankings, args.ifNoneMatch);
  },
});

/** `GET /data/wso/` */
export const wsoList = query({
  args: { ifNoneMatch },
  handler: async (ctx, args) => await viewOrLive(ctx, REF_VIEWS.wso_list, args.ifNoneMatch, () => computeWsoList(ctx)),
});

/**
 * A WSO's records, from a fresh view or live. Answers derived from them are
 * tagged with the hash of their body on both paths, so a client's tag
 * survives the view going stale and being rebuilt.
 */
async function wsoRows(ctx: QueryCtx, wso: string): Promise<WsoRecordRow[]> {
  const view = await readFreshView<WsoRecordRow>(ctx, wsoKey(wso));
  return view ? await view.items() : await computeWsoRows(ctx, wso);
}

/** `GET /data/wso/age-groups` */
export const wsoAgeGroups = query({
  args: { wso: v.string(), ifNoneMatch },
  handler: async (ctx, args) => {
    requireNonEmpty('wso', args.wso);
    return revalidated(ageGroupsOf(await wsoRows(ctx, args.wso)), args.ifNoneMatch);
  },
});

/** `GET /data/wso/records`, optionally narrowed to one age category and/or gender. */
export const wsoRecords = query({
  args: {
    wso: v.string(),
    ageCategory: v.optional(v.string()),
    gender: v.optional(v.string()),
    ifNoneMatch,
  },
  handler: async (ctx, args) => {
    requireNonEmpty('wso', args.wso);
    const rows = await wsoRows(ctx, args.wso);
    return revalidated(filterWsoRows(rows, args.ageCategory, args.gender), args.ifNoneMatch);
  },
});

/** `GET /data/adaptive`: the season's best lifts per weight class. */
export const adaptiveRecords = query({
  args: {
    gender: v.string(),
    excludeFederation: v.string(),
    season: v.optional(v.string()),
    ifNoneMatch,
  },
  handler: async (ctx, args) => {
    const season = args.season ?? ADAPTIVE_RECORDS_SEASON_START;
    if (!/^\d{4}$/.test(season)) throw apiError(400, 'season must be a four-digit year');
    const compute = () => computeAdaptiveRecords(ctx, args.gender, args.excludeFederation, season);
    const viewed =
      season === ADAPTIVE_RECORDS_SEASON_START &&
      ADAPTIVE_VIEW_ARGS.some(
        (a) => a.gender === args.gender.toLowerCase() && a.excludeFederation === args.excludeFederation,
      );
    if (!viewed) return revalidated(await compute(), args.ifNoneMatch);
    return await viewOrLive(ctx, adaptiveKey(args.gender, args.excludeFederation, season), args.ifNoneMatch, compute);
  },
});

/** `GET /clubs`: distinct non-empty club names. */
export const clubs = query({
  args: { ifNoneMatch },
  handler: async (ctx, args) =>
    await viewAnyAgeOrBounded(ctx, REF_VIEWS.clubs, args.ifNoneMatch, async () => {
      const page = await clubNamesPage(ctx, null);
      return page.after === null ? distinctCollated(page.clubs) : null;
    }),
});

/** Registrations per page of `clubAthletes` / `wsoAthletes`. */
const ATHLETE_PAGE_SIZE = 2000;
/**
 * Registrations answered to a client that does not page (the app, site and
 * CLI before paging). `clubAthletes` answers an array, which holds at most
 * 8,192 elements: a larger answer failed before paging, so every club that
 * answered then still answers in full. `wsoAthletes` answers text, which has
 * no element limit; before paging it failed past the 32,000 documents one
 * query may read, and this keeps under that with room to spare.
 */
const UNPAGED_CLUB_ATHLETE_LIMIT = 8192;
const UNPAGED_WSO_ATHLETE_LIMIT = 30000;
/** Meets a too-large unpaged club answer keeps one entry of: one index range each, of the 4,096 a query may use. */
const UNPAGED_CLUB_MEET_LIMIT = 4000;

const athleteCursor = v.optional(v.union(v.string(), v.null()));

function clubAthleteRow(r: Doc<'athletes'>) {
  return {
    name: r.name,
    meet: r.meet,
    club: r.club,
    gender: r.gender,
    weight_class: r.weightClass,
    entry_total: r.entryTotal,
    member_id: r.memberId,
  };
}

const namesDescending = (a: Doc<'athletes'>, b: Doc<'athletes'>) => compareCollated(b.name, a.name);

/**
 * A club's registrations for a client that does not page: all of them when
 * they fit in UNPAGED_CLUB_ATHLETE_LIMIT. Past it, one entry of every meet the
 * club entered (the app lists a club's meets from this answer, so none goes
 * missing), then the most recently written for the rest.
 */
async function unpagedClubAthletes(ctx: QueryCtx, club: string): Promise<Doc<'athletes'>[]> {
  const recent = await ctx.db
    .query('athletes')
    .withIndex('by_club', (q) => q.eq('club', club))
    .order('desc')
    .take(UNPAGED_CLUB_ATHLETE_LIMIT + 1);
  if (recent.length <= UNPAGED_CLUB_ATHLETE_LIMIT) return recent;
  const kept = new Map<string, Doc<'athletes'>>();
  let last: string | null = null;
  for (let i = 0; i < UNPAGED_CLUB_MEET_LIMIT; i += 1) {
    const after: string | null = last;
    // One index seek per meet: the club's next meet after the last one seen.
    const row: Doc<'athletes'> | null = await ctx.db
      .query('athletes')
      .withIndex('by_club_and_meet', (q) => (after === null ? q.eq('club', club) : q.eq('club', club).gt('meet', after)))
      .first();
    if (!row) break;
    kept.set(row._id, row);
    last = row.meet;
  }
  for (const row of recent) {
    if (kept.size >= UNPAGED_CLUB_ATHLETE_LIMIT) break;
    kept.set(row._id, row);
  }
  return [...kept.values()];
}

/**
 * `GET /clubs/athletes`: a club's entries across meets, names descending.
 *
 * With `cursor` (null for the first page) it answers a page,
 * `{ json, cursor, isDone }`: call again with `cursor` until `isDone`. Each
 * page is in name order; pages are not merged, and a roster replaced while a
 * client pages can appear twice. Without it (clients that predate paging),
 * the plain array of `unpagedClubAthletes`.
 */
export const clubAthletes = query({
  args: { club: v.string(), cursor: athleteCursor },
  handler: async (ctx, args) => {
    requireNonEmpty('club', args.club);
    const rows = ctx.db.query('athletes').withIndex('by_club', (q) => q.eq('club', args.club));
    if (args.cursor !== undefined) {
      const page = await rows.paginate({ cursor: args.cursor, numItems: ATHLETE_PAGE_SIZE });
      const json = JSON.stringify(page.page.sort(namesDescending).map(clubAthleteRow));
      return { json, cursor: page.continueCursor, isDone: page.isDone };
    }
    return (await unpagedClubAthletes(ctx, args.club)).sort(namesDescending).map(clubAthleteRow);
  },
});

/**
 * `GET /wsos/athletes`: a WSO's registrations across meets, names descending.
 * An athlete's WSO is the one they registered under at each meet, since
 * affiliation can change between meets. Answers `{ json }`: a large WSO has
 * thousands of registrations. Paged with `cursor` as `clubAthletes` is.
 */
export const wsoAthletes = query({
  args: { wso: v.string(), cursor: athleteCursor },
  handler: async (ctx, args) => {
    requireNonEmpty('wso', args.wso);
    const row = (r: Doc<'athletes'>) => ({ ...clubAthleteRow(r), wso: args.wso });
    const rows = ctx.db.query('athletes').withIndex('by_wso', (q) => q.eq('wso', args.wso));
    if (args.cursor !== undefined) {
      const page = await rows.paginate({ cursor: args.cursor, numItems: ATHLETE_PAGE_SIZE });
      return { json: JSON.stringify(page.page.sort(namesDescending).map(row)), cursor: page.continueCursor, isDone: page.isDone };
    }
    const recent = await rows.order('desc').take(UNPAGED_WSO_ATHLETE_LIMIT);
    return { json: JSON.stringify(recent.sort(namesDescending).map(row)) };
  },
});

/**
 * `GET /clubs/meet-stats`: a club's medals, PRs and make rates at one meet,
 * from the meet's stats and roster views when fresh.
 */
export const clubMeetStats = query({
  args: { club: v.string(), meet: v.string() },
  handler: async (ctx, { club, meet }) => {
    requireNonEmpty('club', club);
    requireNonEmpty('meet', meet);
    const statsView = await readFreshView(ctx, meetKey(meet, 'stats'));
    if (statsView) {
      const { rows, club_counts } = readStatsViewItems(await statsView.items());
      return clubStats(rows, club, club_counts.find(([name]) => name === club)?.[1] ?? 0);
    }
    const [rows, roster] = await Promise.all([
      computeStatsRows(ctx, meet, club),
      ctx.db
        .query('athletes')
        .withIndex('by_club_and_meet', (q) => q.eq('club', club).eq('meet', meet))
        .collect(),
    ]);
    return clubStats(rows, club, clubAthleteCount(roster, club));
  },
});
