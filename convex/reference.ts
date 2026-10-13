import { v } from 'convex/values';
import { query, type QueryCtx } from './_generated/server';
import { revalidated, revalidatedText, type Revalidated } from './lib/etag';
import type { Doc } from './_generated/dataModel';
import { clubKey, clubLabels } from './lib/clubs';
import { clubAthleteCount, clubStats, computeStatsRows, meetByName, readStatsViewItems } from './lib/meetData';
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
  filterWsoRows,
  nationalRankingPage,
  requireAdaptiveGender,
  requireKnownRankingClass,
  wsoAgeGroups as ageGroupsOf,
  type WsoRecordRow,
} from './lib/referenceData';
import { athleteGenderLabel } from './lib/normalize';
import { compareCollated } from './lib/sort';
import { adaptiveKey, ADAPTIVE_VIEW_ARGS, meetKey, natKey, REF_VIEWS, wsoKey } from './lib/viewKeys';
import { readFreshView, readViewAnyAge, readViewJsonAnyAge } from './lib/views';
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

/**
 * `GET /data/nat-rankings`: each athlete's best total in the class, heaviest
 * first. An unknown federation or age category is a 404
 * (`requireKnownRankingClass`); a known class nobody has a total in is `[]`.
 */
export const nationalRankings = query({
  args: { federation: v.string(), ageCategory: v.string(), ifNoneMatch },
  handler: async (ctx, args) => {
    await requireKnownRankingClass(ctx, args.federation, args.ageCategory);
    return await viewAnyAgeOrBounded(ctx, natKey(args.federation, args.ageCategory), args.ifNoneMatch, async () => {
      // A class with no view has no results, or is new: one page answers it.
      const page = await nationalRankingPage(ctx, args.federation, args.ageCategory, null);
      return page.isDone ? page.rows : null;
    });
  },
});

/** `GET /data/nat-rankings-year`: `nationalRankings` within one calendar year, with dates. */
export const nationalRankingsByYear = query({
  args: { federation: v.string(), ageCategory: v.string(), year: v.string(), ifNoneMatch },
  handler: async (ctx, args) => {
    if (!/^\d{4}$/.test(args.year)) throw apiError(400, 'year must be a four-digit year');
    await requireKnownRankingClass(ctx, args.federation, args.ageCategory);
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

/** `GET /data/adaptive`: the season's best lifts per weight class. `gender` is `men` or `women`, any case. */
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
    const gender = requireAdaptiveGender(args.gender);
    const compute = () => computeAdaptiveRecords(ctx, gender, args.excludeFederation, season);
    const viewed =
      season === ADAPTIVE_RECORDS_SEASON_START &&
      ADAPTIVE_VIEW_ARGS.some((a) => a.gender === gender && a.excludeFederation === args.excludeFederation);
    if (!viewed) return revalidated(await compute(), args.ifNoneMatch);
    return await viewOrLive(ctx, adaptiveKey(gender, args.excludeFederation, season), args.ifNoneMatch, compute);
  },
});

/**
 * `GET /clubs`: one name per club, however many ways its registrants spelled
 * it (`clubLabels`, #363); the club answers below take any spelling.
 */
export const clubs = query({
  args: { ifNoneMatch },
  handler: async (ctx, args) =>
    await viewAnyAgeOrBounded(ctx, REF_VIEWS.clubs, args.ifNoneMatch, async () => {
      const page = await clubNamesPage(ctx, null);
      return page.after === null ? clubLabels(page.clubs) : null;
    }),
});

/**
 * Every stored spelling of `club` (`clubKey`), the one asked for first, from
 * the club spellings view whatever its age: a spelling first registered
 * since the last build is missing for seconds, and the one asked for is
 * always read.
 */
export async function clubSpellings(ctx: QueryCtx, club: string): Promise<string[]> {
  const text = await readViewJsonAnyAge(ctx, REF_VIEWS.club_spellings);
  const key = clubKey(club);
  const group = text === null ? undefined : (JSON.parse(text) as [string, string[]][]).find(([k]) => k === key)?.[1];
  return [club, ...(group ?? []).filter((spelling) => spelling !== club)];
}

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
    gender: athleteGenderLabel(r.gender),
    weight_class: r.weightClass,
    entry_total: r.entryTotal,
    member_id: r.memberId,
  };
}

/** The start date of each distinct meet of `rows`, one meet read each. */
async function meetDatesOf(ctx: QueryCtx, rows: readonly Doc<'athletes'>[]): Promise<Map<string, string | null>> {
  const meets = [...new Set(rows.map((r) => r.meet))];
  const dates = await Promise.all(meets.map(async (meet) => (await meetByName(ctx, meet))?.startDate ?? null));
  return new Map(meets.map((meet, i) => [meet, dates[i]]));
}

async function clubAthleteRows(ctx: QueryCtx, rows: Doc<'athletes'>[]) {
  const meetDates = await meetDatesOf(ctx, rows);
  // The meet's first day, for listing a club's meets newest first (#341);
  // null for a roster with no meet row.
  return rows.sort(namesDescending).map((r) => ({ ...clubAthleteRow(r), meet_date: meetDates.get(r.meet) ?? null }));
}

const namesDescending = (a: Doc<'athletes'>, b: Doc<'athletes'>) => compareCollated(b.name, a.name);

/**
 * A club's registrations for a client that does not page: all of them when
 * they fit in UNPAGED_CLUB_ATHLETE_LIMIT. Past it, one entry of every meet the
 * club entered (the app lists a club's meets from this answer, so none goes
 * missing), then the most recently written for the rest.
 */
async function unpagedClubAthletes(ctx: QueryCtx, spellings: readonly string[]): Promise<Doc<'athletes'>[]> {
  const rows: Doc<'athletes'>[] = [];
  for (const club of spellings) {
    if (rows.length >= UNPAGED_CLUB_ATHLETE_LIMIT) break;
    rows.push(...(await unpagedSpellingAthletes(ctx, club)).slice(0, UNPAGED_CLUB_ATHLETE_LIMIT - rows.length));
  }
  return rows;
}

async function unpagedSpellingAthletes(ctx: QueryCtx, club: string): Promise<Doc<'athletes'>[]> {
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
 * Where a paged `clubAthletes` is: the spelling it is reading (an index into
 * `clubSpellings`) and its cursor there. A cursor from before spellings were
 * read (a bare Convex cursor) is the first spelling's: the one asked for.
 */
function clubCursor(cursor: string | null): { spelling: number; cursor: string | null } {
  if (cursor === null) return { spelling: 0, cursor: null };
  try {
    const parsed: unknown = JSON.parse(cursor);
    if (Array.isArray(parsed) && parsed[0] === 'club' && Number.isInteger(parsed[1]) && (typeof parsed[2] === 'string' || parsed[2] === null)) {
      return { spelling: parsed[1] as number, cursor: parsed[2] as string | null };
    }
  } catch {
    // A bare Convex cursor.
  }
  return { spelling: 0, cursor };
}

/**
 * `GET /clubs/athletes`: a club's entries across meets, names descending,
 * under every spelling of the club (`clubSpellings`, #363), each with its
 * meet's date (`meet_date`).
 *
 * With `cursor` (null for the first page) it answers a page,
 * `{ json, cursor, isDone }`: call again with `cursor` until `isDone`. Each
 * page is in name order and holds one spelling's entries; pages are not
 * merged, and a roster replaced while a client pages can appear twice.
 * Without it (clients that predate paging), the plain array of
 * `unpagedClubAthletes`.
 */
export const clubAthletes = query({
  args: { club: v.string(), cursor: athleteCursor },
  handler: async (ctx, args) => {
    requireNonEmpty('club', args.club);
    const spellings = await clubSpellings(ctx, args.club);
    if (args.cursor !== undefined) {
      const at = clubCursor(args.cursor);
      const club = spellings[at.spelling];
      if (club === undefined) return { json: '[]', cursor: JSON.stringify(['club', at.spelling, null]), isDone: true };
      const page = await ctx.db
        .query('athletes')
        .withIndex('by_club', (q) => q.eq('club', club))
        .paginate({ cursor: at.cursor, numItems: ATHLETE_PAGE_SIZE });
      const json = JSON.stringify(await clubAthleteRows(ctx, page.page));
      const last = at.spelling + 1 >= spellings.length;
      if (page.isDone && !last) return { json, cursor: JSON.stringify(['club', at.spelling + 1, null]), isDone: false };
      return { json, cursor: JSON.stringify(['club', at.spelling, page.continueCursor]), isDone: page.isDone };
    }
    return await clubAthleteRows(ctx, await unpagedClubAthletes(ctx, spellings));
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
      // Counts are keyed by `clubKey`; a view built before that holds one per spelling.
      const key = clubKey(club);
      const count = club_counts.filter(([name]) => clubKey(name) === key).reduce((sum, [, n]) => sum + n, 0);
      return clubStats(rows, club, count);
    }
    const spellings = await clubSpellings(ctx, club);
    const [rows, ...rosters] = await Promise.all([
      computeStatsRows(ctx, meet, club),
      ...spellings.map((spelling) =>
        ctx.db
          .query('athletes')
          .withIndex('by_club_and_meet', (q) => q.eq('club', spelling).eq('meet', meet))
          .collect(),
      ),
    ]);
    return clubStats(rows, club, clubAthleteCount(rosters.flat(), club));
  },
});
