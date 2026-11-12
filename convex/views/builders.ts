import { isoDateOf } from '../lib/dates';
import { MEET_ROSTER_MAX, readAll } from '../lib/boundedRead';
import { chunks } from '../lib/concurrency';
import { v } from 'convex/values';
import { internalAction, internalMutation, internalQuery, type ActionCtx, type MutationCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { athletesWithSessions, clubAthleteCounts, computeMeetResults, computeRoster, computeScheduleRows, computeStats, computeTimelines, meetByName, packageAthlete, packageStaticText, plainRoster, previousBests, statsPreviousBestKeys, statsViewItems, toApiMeet, type PreviousBest, type TimelinesView } from '../lib/meetData';
import { normalizeName } from '../lib/names';
import { ADAPTIVE_RECORDS_SEASON_START, computeAdaptiveRecords, clubNamesPage, computeIntlRankings, bestTotalPerAthlete, nationalRankingPage, type RankedTotal, computeStandards, computeWsoList, computeWsoRows } from '../lib/referenceData';
import { writeQualifyingTotalsViews, writeRecordsViews } from '../lib/referenceViews';
import { compareBytes } from '../lib/sort';
import { adaptiveKey, ADAPTIVE_VIEW_ARGS, MEET_PART_SOURCES, meetKey, meetSessionKey, meetSessionPrefix, natKey, REF_VIEWS, VIEW_SOURCES, wsoKey } from '../lib/viewKeys';
import { deleteView, deleteViewsWithPrefix, jsonChunks, snapshotVersions, textChunks, writeView, type SourceTable, type SourceVersion, viewKeysWithPrefix as keysWithPrefix } from '../lib/views';
import { clubLabels, clubSpellingGroups } from '../lib/clubs';

/** Timelines keep this many years of results; year bests look back one. */
const TIMELINE_YEARS = 3;

const natArgs = { federation: v.string(), ageCategory: v.string() };

const sourceVersions = v.array(v.object({ table: v.string(), version: v.number() }));

const rankedTotals = v.array(v.object({ name: v.string(), total: v.number() }));

export const natPage = internalQuery({
  args: { ...natArgs, cursor: v.union(v.string(), v.null()) },
  returns: v.object({ rows: rankedTotals, cursor: v.string(), isDone: v.boolean(), sources: sourceVersions }),
  handler: async (ctx, { federation, ageCategory, cursor }) => {
    const sources = await snapshotVersions(ctx, VIEW_SOURCES.nat);
    return { ...(await nationalRankingPage(ctx, federation, ageCategory, cursor)), sources };
  },
});

async function readNat(ctx: ActionCtx, args: { federation: string; ageCategory: string }): Promise<{ rows: RankedTotal[]; sources: SourceVersion[] }> {
  const best = new Map<string, RankedTotal>();
  let cursor: string | null = null;
  let sources: SourceVersion[] | null = null;
  for (;;) {
    const page: { rows: RankedTotal[]; cursor: string; isDone: boolean; sources: SourceVersion[] } =
      await ctx.runQuery(internal.views.natPage, { ...args, cursor });
    sources ??= page.sources;
    // One athlete under two spellings across pages is one ranking row (#217).
    for (const row of page.rows) {
      const key = normalizeName(row.name);
      if ((best.get(key)?.total ?? -Infinity) < row.total) best.set(key, row);
    }
    if (page.isDone) return { rows: bestTotalPerAthlete(best.values()), sources };
    cursor = page.cursor;
  }
}

/** Live reference computation for parity, paged independently of stored views. */
export const computeNat = internalAction({
  args: natArgs,
  returns: v.object({ chunks: v.array(v.string()), sources: sourceVersions }),
  handler: async (ctx, args): Promise<{ chunks: string[]; sources: SourceVersion[] }> => {
    const { rows, sources } = await readNat(ctx, args);
    return { chunks: jsonChunks(rows), sources };
  },
});

export const storeNat = internalMutation({
  args: { ...natArgs, chunks: v.array(v.string()), count: v.number(), sources: sourceVersions },
  returns: v.number(),
  handler: async (ctx, { federation, ageCategory, chunks, count, sources }) => {
    await writeView(ctx, natKey(federation, ageCategory), chunks, sources);
    return count;
  },
});

export const buildNat = internalAction({
  args: natArgs,
  returns: v.number(),
  handler: async (ctx, args): Promise<number> => {
    const { rows, sources } = await readNat(ctx, args);
    return await ctx.runMutation(internal.views.storeNat, { ...args, chunks: jsonChunks(rows), count: rows.length, sources });
  },
});

/** Schedule, start lists, package sections and roster keys of one meet. */
export const buildMeet = internalMutation({
  args: { meet: v.string() },
  handler: async (ctx, { meet }) => {
    const sources = await snapshotVersions(ctx, ['meets', 'athletes', 'session_schedule', 'lifting_results']);
    const pick = (part: keyof typeof MEET_PART_SOURCES) =>
      sources.filter((s) => (MEET_PART_SOURCES[part] as readonly string[]).includes(s.table));
    const schedule = await computeScheduleRows(ctx, meet);
    const roster = await computeRoster(ctx, meet, schedule);
    const results = await computeMeetResults(ctx, meet);
    const keys = Array.from(new Set(roster.map((a) => normalizeName(a.name)))).sort(compareBytes);
    await writeView(ctx, meetKey(meet, 'schedule'), jsonChunks(schedule), pick('schedule'));
    await writeView(ctx, meetKey(meet, 'sessions'), jsonChunks(athletesWithSessions(roster)), pick('sessions'));
    await writeView(ctx, meetKey(meet, 'athletes'), jsonChunks(plainRoster(roster, meet)), pick('athletes'));
    await writeView(ctx, meetKey(meet, 'keys'), jsonChunks(keys), pick('keys'));
    await writeView(ctx, meetKey(meet, 'results'), jsonChunks(results), pick('results'));
    const meetRow = await meetByName(ctx, meet);
    if (meetRow) {
      const staticText = packageStaticText(toApiMeet(meetRow), schedule, roster.map(packageAthlete), results);
      await writeView(ctx, meetKey(meet, 'package_static'), textChunks(staticText), pick('package_static'), { text: true });
    } else {
      // No meet row, no package (a 404): nothing to serve.
      await deleteViewsWithPrefix(ctx, meetKey(meet, 'package_static'));
    }
    // Per-session start lists: cleared first, so a session that no longer
    // exists leaves no view behind to be served.
    await deleteViewsWithPrefix(ctx, meetSessionPrefix(meet));
    const bySession = new Map<number, ReturnType<typeof athletesWithSessions>>();
    for (const row of athletesWithSessions(roster)) {
      if (row.session_number === null || row.date === null) continue;
      const list = bySession.get(row.session_number) ?? [];
      list.push(row);
      bySession.set(row.session_number, list);
    }
    for (const [sessionNumber, rows] of bySession) {
      await writeView(ctx, meetSessionKey(meet, sessionNumber), jsonChunks(rows), pick('sessions'));
    }
    return { athletes: roster.length, results: results.length, sessions: bySession.size };
  },
});

function yearsAgo(years: number): string {
  const now = new Date();
  now.setUTCFullYear(now.getUTCFullYear() - years);
  return isoDateOf(now.getTime());
}

/**
 * Each roster athlete's results since the horizon (the view's `meta`), for
 * year bests; a query asking about an earlier window computes live instead.
 */
export const buildMeetTimelines = internalMutation({
  args: { meet: v.string() },
  handler: async (ctx, { meet }) => {
    const sources = await snapshotVersions(ctx, VIEW_SOURCES.meetTimelines);
    const roster = await readAll(
      ctx.db
        .query('athletes')
        .withIndex('by_meet', (q) => q.eq('meet', meet)),
      MEET_ROSTER_MAX,
      'athletes of one meet',
    );
    const horizon = yearsAgo(TIMELINE_YEARS);
    const names = [...new Set(roster.map((a) => a.name))].sort(compareBytes);
    const timelines = await computeTimelines(ctx, names, horizon);
    const view: TimelinesView = [['names', names], ...timelines];
    await writeView(ctx, meetKey(meet, 'timelines'), jsonChunks(view), sources, { meta: horizon });
    return timelines.length;
  },
});

/**
 * Every result's club-stats row, and each club's distinct athlete count
 * (`statsViewItems`: the counts, then one item per row, so a national meet's
 * rows can span chunks), so one meet serves every club's summary. Its `meta`
 * is the latest finisher date, which tells a refresh which result changes
 * cannot reach it.
 *
 * Built by `buildStats`: each finisher's previous best reads their earlier
 * results, which for a national meet is more documents than one transaction
 * may read, so those are read in batches first (`statsPreviousBests`) and
 * this mutation only assembles and writes. `sources` is the snapshot taken
 * before the first of those reads, so data written meanwhile leaves the view
 * stale for the next refresh rather than silently mixed in.
 */
export const buildMeetStats = internalMutation({
  args: {
    meet: v.string(),
    sources: v.optional(v.array(v.object({ table: v.string(), version: v.number() }))),
    known: v.optional(v.array(v.object({ key: v.string(), before: v.string(), best: v.union(v.number(), v.null()) }))),
  },
  handler: async (ctx, { meet, sources, known }) => {
    const stamp = sources ?? (await snapshotVersions(ctx, VIEW_SOURCES.meetStats));
    const { rows, latest } = await computeStats(ctx, meet, undefined, known ?? []);
    const roster = await readAll(
      ctx.db
        .query('athletes')
        .withIndex('by_meet', (q) => q.eq('meet', meet)),
      MEET_ROSTER_MAX,
      'athletes of one meet',
    );
    await writeView(ctx, meetKey(meet, 'stats'), jsonChunks(statsViewItems(rows, clubAthleteCounts(roster))), stamp, { meta: latest });
    return rows.length;
  },
});

/** The stats view's source snapshot, then the previous bests it needs. */
export const statsBuildPlan = internalQuery({
  args: { meet: v.string() },
  handler: async (ctx, { meet }) => {
    const sources = await snapshotVersions(ctx, VIEW_SOURCES.meetStats);
    return { sources, wanted: await statsPreviousBestKeys(ctx, meet) };
  },
});

/** Previous bests of up to STATS_PREVIOUS_BEST_BATCH athletes. */
export const statsPreviousBests = internalQuery({
  args: { wanted: v.array(v.object({ key: v.string(), before: v.string() })) },
  handler: async (ctx, { wanted }) => await previousBests(ctx, wanted),
});

/**
 * Athletes per `statsPreviousBests` call. A veteran has a few dozen earlier
 * results and most finishers a handful, so a batch stays well under Convex's
 * per-transaction document read limit.
 */
const STATS_PREVIOUS_BEST_BATCH = 200;

export async function buildStats(ctx: ActionCtx, meet: string): Promise<void> {
  const { sources, wanted } = await ctx.runQuery(internal.views.statsBuildPlan, { meet });
  const known: PreviousBest[] = [];
  for (const batch of chunks(wanted, STATS_PREVIOUS_BEST_BATCH)) {
    known.push(...(await ctx.runQuery(internal.views.statsPreviousBests, { wanted: batch })));
  }
  await ctx.runMutation(internal.views.buildMeetStats, { meet, sources, known });
}

async function writeComputed(
  ctx: MutationCtx,
  key: string,
  tables: readonly SourceTable[],
  compute: () => Promise<unknown[]>,
): Promise<void> {
  const sources = await snapshotVersions(ctx, tables);
  await writeView(ctx, key, jsonChunks(await compute()), sources);
}

export const buildReferenceTables = internalMutation({
  args: {},
  handler: async (ctx) => {
    await writeRecordsViews(ctx);
    await writeComputed(ctx, REF_VIEWS.standards, VIEW_SOURCES.standards, () => computeStandards(ctx));
    await writeQualifyingTotalsViews(ctx);
    await writeComputed(ctx, REF_VIEWS.intl_rankings, VIEW_SOURCES.intl_rankings, () => computeIntlRankings(ctx));
    for (const { gender, excludeFederation } of ADAPTIVE_VIEW_ARGS) {
      await writeComputed(ctx, adaptiveKey(gender, excludeFederation, ADAPTIVE_RECORDS_SEASON_START), VIEW_SOURCES.adaptive, () =>
        computeAdaptiveRecords(ctx, gender, excludeFederation, ADAPTIVE_RECORDS_SEASON_START),
      );
    }
  },
});

export const clubsPage = internalQuery({
  args: { after: v.union(v.string(), v.null()) },
  returns: v.object({
    clubs: v.array(v.string()),
    after: v.union(v.string(), v.null()),
    sources: v.array(v.object({ table: v.string(), version: v.number() })),
  }),
  handler: async (ctx, { after }) => {
    const sources = await snapshotVersions(ctx, VIEW_SOURCES.clubs);
    return { ...(await clubNamesPage(ctx, after)), sources };
  },
});

export const storeClubs = internalMutation({
  args: { clubs: v.array(v.string()), sources: v.array(v.object({ table: v.string(), version: v.number() })) },
  returns: v.null(),
  handler: async (ctx, { clubs, sources }) => {
    // One label per club, and every spelling of each (#363).
    await writeView(ctx, REF_VIEWS.clubs, jsonChunks(clubLabels(clubs)), sources);
    await writeView(ctx, REF_VIEWS.club_spellings, jsonChunks(clubSpellingGroups(clubs)), sources);
    return null;
  },
});

/**
 * One index seek per distinct club exceeded the system-operation timeout in
 * a single mutation. Read bounded pages, then publish once all succeeded.
 * Keep the first page's version: a roster write during the scan must leave
 * this view stale so the next refresh rebuilds it.
 */
export const buildClubs = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    const { clubs, sources } = await readClubs(ctx);
    await ctx.runMutation(internal.views.storeClubs, { clubs, sources });
    return null;
  },
});

async function readClubs(ctx: ActionCtx): Promise<{ clubs: string[]; sources: SourceVersion[] }> {
  const clubs: string[] = [];
  let sources: SourceVersion[] | null = null;
  let after: string | null = null;
  do {
    const page: { clubs: string[]; after: string | null; sources: SourceVersion[] } =
      await ctx.runQuery(internal.views.clubsPage, { after });
    sources ??= page.sources;
    clubs.push(...page.clubs);
    after = page.after;
  } while (after !== null);
  return { clubs, sources };
}

/** `GET /clubs` computed live, paged like the builder, for parity. JSON text: the list is unbounded. */
export const computeClubs = internalAction({
  args: {},
  returns: v.string(),
  handler: async (ctx): Promise<string> => JSON.stringify(clubLabels((await readClubs(ctx)).clubs)),
});

export const buildWso = internalMutation({
  args: {},
  handler: async (ctx) => {
    const sources = await snapshotVersions(ctx, VIEW_SOURCES.wso);
    const wsos = await computeWsoList(ctx);
    await writeView(ctx, REF_VIEWS.wso_list, jsonChunks(wsos), sources);
    for (const wso of wsos) {
      await writeView(ctx, wsoKey(wso), jsonChunks(await computeWsoRows(ctx, wso)), sources);
    }
    // A WSO gone from the table leaves no view to be served as fresh.
    const current = new Set(wsos.map(wsoKey));
    for (const key of await keysWithPrefix(ctx, 'wso|')) {
      if (!current.has(key)) await deleteView(ctx, key);
    }
    return wsos.length;
  },
});
