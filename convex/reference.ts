import { v } from 'convex/values';
import { query, type QueryCtx } from './_generated/server';
import { etagOf, revalidated, revalidatedText, type Revalidated } from './lib/etag';
import { clubAthleteCount, clubStats, computeStatsRows, type StatsRow } from './lib/meetData';
import {
  ADAPTIVE_RECORDS_SEASON_START,
  computeAdaptiveRecords,
  computeClubs,
  computeIntlRankings,
  computeNationalRankings,
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

/** `GET /data/wso/` */
export const wsoList = query({
  args: { ifNoneMatch },
  handler: async (ctx, args) => await viewOrLive(ctx, REF_VIEWS.wso_list, args.ifNoneMatch, () => computeWsoList(ctx)),
});

/**
 * A WSO's records, and a tag for an answer derived from them: from a fresh
 * view the tag is derived from the view's (no hashing, and a matching client
 * never reads the rows); live, the caller hashes its body.
 */
async function wsoSource(ctx: QueryCtx, wso: string, derivation: string) {
  const view = await readFreshView<WsoRecordRow>(ctx, wsoKey(wso));
  if (view) return { tag: etagOf(`${view.etag}|${derivation}`), rows: view.items };
  return { tag: null, rows: () => computeWsoRows(ctx, wso) };
}

async function derivedAnswer(
  source: { tag: string | null; rows: () => Promise<WsoRecordRow[]> },
  derive: (rows: WsoRecordRow[]) => unknown,
  ifNoneMatch: string | undefined,
): Promise<Revalidated> {
  if (source.tag) {
    return await revalidatedText(source.tag, async () => JSON.stringify(derive(await source.rows())), ifNoneMatch);
  }
  return revalidated(derive(await source.rows()), ifNoneMatch);
}

/** `GET /data/wso/age-groups` */
export const wsoAgeGroups = query({
  args: { wso: v.string(), ifNoneMatch },
  handler: async (ctx, args) => {
    requireNonEmpty('wso', args.wso);
    return await derivedAnswer(await wsoSource(ctx, args.wso, 'age-groups'), ageGroupsOf, args.ifNoneMatch);
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
    const source = await wsoSource(ctx, args.wso, JSON.stringify(['records', args.ageCategory ?? null, args.gender ?? null]));
    return await derivedAnswer(source, (rows) => filterWsoRows(rows, args.ageCategory, args.gender), args.ifNoneMatch);
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
