import { v } from 'convex/values';
import { query, type QueryCtx } from './_generated/server';
import { revalidated, revalidatedText, type Revalidated } from './lib/etag';
import { clubAthleteCount, clubStats, computeStatsRows, type StatsRow } from './lib/meetData';
import {
  ADAPTIVE_RECORDS_SEASON_START,
  computeAdaptiveRecords,
  computeClubs,
  computeIntlRankings,
  computeNationalRankings,
  computeNationalRankingsForYear,
  computeQualifyingTotals,
  computeRecords,
  computeStandards,
  computeWsoList,
  computeWsoRows,
  filterWsoRows,
  wsoAgeGroups as ageGroupsOf,
  type WsoRecordRow,
} from './lib/referenceData';
import { compareCollated } from './lib/sort';
import { adaptiveKey, ADAPTIVE_VIEW_ARGS, meetKey, natKey, REF_VIEWS, wsoKey } from './lib/viewKeys';
import { readFreshView } from './lib/views';
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

/** `GET /data/nat-rankings`: each athlete's best total in the class, heaviest first. */
export const nationalRankings = query({
  args: { federation: v.string(), ageCategory: v.string(), ifNoneMatch },
  handler: async (ctx, args) =>
    await viewOrLive(ctx, natKey(args.federation, args.ageCategory), args.ifNoneMatch, () =>
      computeNationalRankings(ctx, args.federation, args.ageCategory),
    ),
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
  handler: async (ctx, args) => await viewOrLive(ctx, REF_VIEWS.clubs, args.ifNoneMatch, () => computeClubs(ctx)),
});

/** `GET /clubs/athletes`: a club's entries across meets, names descending. */
export const clubAthletes = query({
  args: { club: v.string() },
  handler: async (ctx, args) => {
    requireNonEmpty('club', args.club);
    const rows = await ctx.db
      .query('athletes')
      .withIndex('by_club', (q) => q.eq('club', args.club))
      .collect();
    return rows
      .sort((a, b) => compareCollated(b.name, a.name))
      .map((r) => ({
        name: r.name,
        meet: r.meet,
        club: r.club,
        gender: r.gender,
        weight_class: r.weightClass,
        entry_total: r.entryTotal,
        member_id: r.memberId,
      }));
  },
});

/**
 * `GET /wsos/athletes`: a WSO's registrations across meets, names descending.
 * An athlete's WSO is the one they registered under at each meet, since
 * affiliation can change between meets. Answers `{ json }`: a large WSO has
 * thousands of registrations.
 */
export const wsoAthletes = query({
  args: { wso: v.string() },
  handler: async (ctx, args) => {
    requireNonEmpty('wso', args.wso);
    const rows = await ctx.db
      .query('athletes')
      .withIndex('by_wso', (q) => q.eq('wso', args.wso))
      .collect();
    const athletes = rows
      .sort((a, b) => compareCollated(b.name, a.name))
      .map((r) => ({
        name: r.name,
        meet: r.meet,
        club: r.club,
        wso: args.wso,
        gender: r.gender,
        weight_class: r.weightClass,
        entry_total: r.entryTotal,
        member_id: r.memberId,
      }));
    return { json: JSON.stringify(athletes) };
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
    const statsView = await readFreshView<{ rows: StatsRow[]; club_counts: [string, number][] }>(
      ctx,
      meetKey(meet, 'stats'),
    );
    if (statsView) {
      const [{ rows, club_counts }] = await statsView.items();
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
