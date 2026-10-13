import { v } from 'convex/values';
import { internalAction, internalMutation, internalQuery, type ActionCtx, type MutationCtx, type QueryCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import {
  athletesWithSessions,
  clubAthleteCounts,
  computeMeetResults,
  computeRoster,
  computeScheduleRows,
  computeStats,
  computeTimelines,
  meetByName,
  packageAthlete,
  packageStaticText,
  plainRoster,
  previousBests,
  statsPreviousBestKeys,
  statsViewItems,
  toApiMeet,
  type PreviousBest,
  type TimelinesView,
} from './lib/meetData';
import { HISTORY_READY, writeHistories } from './lib/history';
import { normalizeName } from './lib/names';
import {
  ADAPTIVE_RECORDS_SEASON_START,
  computeAdaptiveRecords,
  clubNamesPage,
  distinctCollated,
  computeIntlRankings,
  bestTotalPerAthlete,
  nationalRankingPage,
  type RankedTotal,
  computeQualifyingTotals,
  computeRecords,
  computeStandards,
  computeWsoList,
  computeWsoRows,
} from './lib/referenceData';
import { compareBytes, compareCollated } from './lib/sort';
import {
  adaptiveKey,
  ADAPTIVE_VIEW_ARGS,
  athleteChangeAffects,
  earliestSince,
  INTERNAL_VIEW_PREFIXES,
  MEET_INDEX_VIEW,
  MEET_PART_SOURCES,
  meetKey,
  meetSessionKey,
  meetSessionPrefix,
  meetViewsPrefix,
  natKey,
  REF_VIEWS,
  RESULT_NAMES_VIEW,
  SEARCH_SHARD_PREFIX,
  SEARCH_SHARD_SIZES_VIEW,
  LEGACY_SEARCH_SHARD_SIZES_VIEWS,
  searchShardKey,
  VIEW_SOURCES,
  viewDependencies,
  wsoKey,
} from './lib/viewKeys';
import {
  deleteHeaderAndChunks,
  deleteView,
  deleteViewsWithPrefix,
  jsonChunks,
  readViewJsonAnyAge,
  readViewTextAnyAge,
  snapshotVersions,
  textChunks,
  viewHeader,
  writeView,
  type SourceTable,
  type SourceVersion,
  viewKeysWithPrefix as keysWithPrefix,
} from './lib/views';
import { directoryNames, directoryText, nameBigrams, shardDirectory } from './lib/directory';

// Builders and refresh for the views in `lib/viewKeys.ts`. Every builder is a
// mutation that reads its source versions first and its rows second, in one
// transaction, so the stamp it writes is exactly the data it read.

/** Rows per page when an action walks `lifting_results`. */
const PAGE_SIZE = 8000;
/** Timelines keep this many years of results; year bests look back one. */
const TIMELINE_YEARS = 3;
/** Refresh runs this long after the first write of a burst. */
const REFRESH_DELAY_MS = 5000;
/**
 * More pending hints of the kinds that each cost a view build (a meet, a
 * ranking class, a table) than this and a refresh rebuilds everything
 * instead. Athlete and name hints are cheap (checked in batches), so a
 * national meet's two per new lifter do not count against it. A refresh
 * reads at most MAX_REFRESH_HINTS hints; past that it handles those and
 * queues another refresh at once for the rest (#215), rather than rebuild
 * everything for a backlog of cheap hints.
 */
const MAX_TARGETED_HINTS = 2000;
const MAX_REFRESH_HINTS = 3500;
const CHEAP_HINT_KINDS: ReadonlySet<string> = new Set(['athlete', 'name']);
/** A refresh that finds another running tries again after this. */
const REFRESH_BUSY_RETRY_MS = 30 * 1000;
/**
 * While a full rebuild is marked running, a refresh stays queued this far
 * ahead: it waits for the rebuild, and restarts it if its stages stopped.
 */
const REBUILD_WAIT_MS = 60 * 1000;
/**
 * A rebuild stage starts at least every 10 minutes (Convex stops an action
 * there); a rebuild silent for longer than this had a stage fail, and is
 * started again rather than waited on forever.
 */
const REBUILD_STALE_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

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
  return now.toISOString().slice(0, 10);
}

/**
 * Each roster athlete's results since the horizon (the view's `meta`), for
 * year bests; a query asking about an earlier window computes live instead.
 */
export const buildMeetTimelines = internalMutation({
  args: { meet: v.string() },
  handler: async (ctx, { meet }) => {
    const sources = await snapshotVersions(ctx, VIEW_SOURCES.meetTimelines);
    const roster = await ctx.db
      .query('athletes')
      .withIndex('by_meet', (q) => q.eq('meet', meet))
      .collect();
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
    const roster = await ctx.db
      .query('athletes')
      .withIndex('by_meet', (q) => q.eq('meet', meet))
      .collect();
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

async function buildStats(ctx: ActionCtx, meet: string): Promise<void> {
  const { sources, wanted } = await ctx.runQuery(internal.views.statsBuildPlan, { meet });
  const known: PreviousBest[] = [];
  for (let i = 0; i < wanted.length; i += STATS_PREVIOUS_BEST_BATCH) {
    known.push(...(await ctx.runQuery(internal.views.statsPreviousBests, { wanted: wanted.slice(i, i + STATS_PREVIOUS_BEST_BATCH) })));
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
    await writeComputed(ctx, REF_VIEWS.records, VIEW_SOURCES.records, () => computeRecords(ctx));
    await writeComputed(ctx, REF_VIEWS.standards, VIEW_SOURCES.standards, () => computeStandards(ctx));
    await writeComputed(ctx, REF_VIEWS.qualifying_totals, VIEW_SOURCES.qualifying_totals, () =>
      computeQualifyingTotals(ctx),
    );
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
    await writeView(ctx, REF_VIEWS.clubs, jsonChunks(distinctCollated(clubs)), sources);
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
  handler: async (ctx): Promise<string> => JSON.stringify(distinctCollated((await readClubs(ctx)).clubs)),
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

/** Replaces the search directory (never version checked, see `lib/directory.ts`). */
export const storeResultNames = internalMutation({
  args: { chunks: v.array(v.string()) },
  handler: async (ctx, { chunks }) => {
    await writeView(ctx, RESULT_NAMES_VIEW, chunks, [], { text: true });
  },
});

/**
 * Brings the search directory up to date for names a write touched (the
 * `name` hints carry the old name of a deleted or replaced row as well as the
 * new one): a name that still has a result is added, one with none left is
 * removed, so suggestions never offer a name that finds nothing.
 */
export const syncResultNames = internalMutation({
  args: { names: v.array(v.string()) },
  handler: async (ctx, { names }) => {
    const directory = new Set(directoryNames((await readViewTextAnyAge(ctx, RESULT_NAMES_VIEW)) ?? ''));
    const added: string[] = [];
    const removed: string[] = [];
    for (const name of new Set(names)) {
      const hasResult =
        (await ctx.db
          .query('lifting_results')
          .withIndex('by_nameKey_and_date', (q) => q.eq('nameKey', normalizeName(name)))
          .filter((q) => q.eq(q.field('name'), name))
          .first()) !== null;
      if (hasResult && !directory.has(name)) {
        directory.add(name);
        added.push(name);
      } else if (!hasResult && directory.delete(name)) {
        removed.push(name);
      }
    }
    if (added.length + removed.length === 0) return { added, removed };
    await writeView(ctx, RESULT_NAMES_VIEW, textChunks(directoryText([...directory].sort(compareCollated))), [], { text: true });
    // The shards are patched by later mutations; recording the change here,
    // in the directory's transaction, means a failure in between cannot lose it.
    for (const [names, present] of [
      [added, true],
      [removed, false],
    ] as const) {
      for (const name of names) {
        const pending = await ctx.db
          .query('search_shard_pending')
          .withIndex('by_name', (q) => q.eq('name', name))
          .unique();
        if (pending) await ctx.db.patch(pending._id, { present });
        else await ctx.db.insert('search_shard_pending', { name, present });
      }
    }
    return { added, removed };
  },
});

// The directory's two-letter shards (`lib/directory.ts`).

/** Writes whole shards, as the full rebuild computes them. */
export const storeSearchShards = internalMutation({
  args: { shards: v.array(v.object({ bigram: v.string(), text: v.string() })) },
  handler: async (ctx, { shards }) => {
    for (const { bigram, text } of shards) await writeView(ctx, searchShardKey(bigram), textChunks(text), [], { text: true });
  },
});

/** Replaces the shard size table (`[[bigram, names], …]`), which queries use to pick their rarest shard. */
export const storeSearchShardSizes = internalMutation({
  args: { sizes: v.array(v.object({ bigram: v.string(), count: v.number() })) },
  handler: async (ctx, { sizes }) => {
    await writeView(ctx, SEARCH_SHARD_SIZES_VIEW, jsonChunks(sizes.map(({ bigram, count }) => [bigram, count])), []);
    for (const key of LEGACY_SEARCH_SHARD_SIZES_VIEWS) await deleteView(ctx, key);
  },
});

/** Deletes shards whose sequence no name has any more. */
export const deleteSearchShards = internalMutation({
  args: { keys: v.array(v.string()) },
  handler: async (ctx, { keys }) => {
    for (const key of keys) {
      if (key.startsWith(SEARCH_SHARD_PREFIX)) await deleteViewsWithPrefix(ctx, key);
    }
  },
});

/**
 * Adds and removes names in the shards of `bigrams` (the refresh's name
 * changes), keeping directory order, and records each shard's new size in the
 * size table in the same transaction, so two overlapping refreshes cannot
 * leave an older count behind. An empty shard is deleted.
 */
export const patchSearchShards = internalMutation({
  args: { bigrams: v.array(v.string()), added: v.array(v.string()), removed: v.array(v.string()) },
  handler: async (ctx, { bigrams, added, removed }) => {
    const sizes: { bigram: string; count: number }[] = [];
    for (const bigram of bigrams) {
      const key = searchShardKey(bigram);
      const names = new Set(directoryNames((await readViewTextAnyAge(ctx, key)) ?? ''));
      const before = names.size;
      let changed = false;
      for (const name of added) {
        if (nameBigrams(name).has(bigram) && !names.has(name)) {
          names.add(name);
          changed = true;
        }
      }
      for (const name of removed) {
        if (nameBigrams(name).has(bigram) && names.delete(name)) changed = true;
      }
      if (changed || before === 0) {
        if (names.size === 0) await deleteViewsWithPrefix(ctx, key);
        else await writeView(ctx, key, textChunks(directoryText([...names].sort(compareCollated))), [], { text: true });
      }
      sizes.push({ bigram, count: names.size });
    }
    await mergeShardSizes(ctx, sizes);
    return sizes;
  },
});

/** Merges sizes into the shard size table (a size of 0 drops the entry). */
async function mergeShardSizes(ctx: MutationCtx, sizes: readonly { bigram: string; count: number }[]): Promise<void> {
  // No table (a new fold, not yet built in full): queries read the whole
  // directory until a full build, and a table started here would list only
  // the patched shards, so every other one would read as empty.
  const stored = await readViewJsonAnyAge(ctx, SEARCH_SHARD_SIZES_VIEW);
  if (stored === null) return;
  const table = new Map<string, number>(JSON.parse(stored) as [string, number][]);
  let changed = false;
  for (const { bigram, count } of sizes) {
    if (count > 0 && table.get(bigram) !== count) {
      table.set(bigram, count);
      changed = true;
    } else if (count === 0 && table.delete(bigram)) {
      changed = true;
    }
  }
  if (changed) await writeView(ctx, SEARCH_SHARD_SIZES_VIEW, jsonChunks([...table]), []);
}

/** Shard text per mutation: well inside a function's argument and write limits. */
const SHARD_BATCH_CHARS = 1_500_000;

/** Rewrites every shard from a sorted directory, then the size table, then drops shards gone from it. */
async function rebuildSearchShards(ctx: ActionCtx, sortedNames: readonly string[]): Promise<void> {
  const shards = shardDirectory(sortedNames);
  let batch: { bigram: string; text: string }[] = [];
  let batchChars = 0;
  for (const [bigram, names] of shards) {
    const text = directoryText(names);
    if (batch.length > 0 && batchChars + text.length > SHARD_BATCH_CHARS) {
      await ctx.runMutation(internal.views.storeSearchShards, { shards: batch });
      batch = [];
      batchChars = 0;
    }
    batch.push({ bigram, text });
    batchChars += text.length;
  }
  if (batch.length > 0) await ctx.runMutation(internal.views.storeSearchShards, { shards: batch });
  await ctx.runMutation(internal.views.storeSearchShardSizes, {
    sizes: [...shards].map(([bigram, names]) => ({ bigram, count: names.length })),
  });
  const current = new Set([...shards.keys()].map(searchShardKey));
  const stale = (await ctx.runQuery(internal.views.viewKeysWithPrefix, { prefix: SEARCH_SHARD_PREFIX })).filter((key: string) => !current.has(key));
  for (let i = 0; i < stale.length; i += 200) await ctx.runMutation(internal.views.deleteSearchShards, { keys: stale.slice(i, i + 200) });
}

/**
 * Builds the shards from the stored directory (after a deploy that
 * introduced them, without a full rebuild):
 *
 *   npx convex run views:buildSearchShards
 */
export const buildSearchShards = internalAction({
  args: {},
  handler: async (ctx): Promise<number> => {
    const text: string | null = await ctx.runQuery(internal.views.textViewAnyAge, { key: RESULT_NAMES_VIEW });
    const names = directoryNames(text ?? '');
    await rebuildSearchShards(ctx, names);
    return names.length;
  },
});

/**
 * The pending shard changes (oldest first), a page at a time. Each name's
 * presence is read from the directory now rather than taken from the row: the
 * shards follow the directory, and a full rebuild rewrites the directory
 * without touching these rows, so a row's own flag can be out of date.
 */
export const pendingShardChanges = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('search_shard_pending').take(500);
    if (rows.length === 0) return [];
    const directory = new Set(directoryNames((await readViewTextAnyAge(ctx, RESULT_NAMES_VIEW)) ?? ''));
    return rows.map(({ _id, name }) => ({ id: _id, name, present: directory.has(name) }));
  },
});

/** Deletes pending changes the shards now hold: those whose name the directory still has (or lacks) as applied. */
export const clearPendingShardChanges = internalMutation({
  args: { applied: v.array(v.object({ id: v.id('search_shard_pending'), present: v.boolean() })) },
  handler: async (ctx, { applied }) => {
    const directory = new Set(directoryNames((await readViewTextAnyAge(ctx, RESULT_NAMES_VIEW)) ?? ''));
    for (const { id, present } of applied) {
      const row = await ctx.db.get(id);
      if (row && directory.has(row.name) === present) await ctx.db.delete(id);
    }
  },
});

/**
 * Brings the shards of every pending name (`search_shard_pending`) in line
 * with the directory, a few shards per mutation, then clears what it applied.
 * Re-applying is harmless (set updates), so a refresh that fails part way
 * leaves the changes for the next one.
 */
async function applyPendingShardChanges(ctx: ActionCtx): Promise<void> {
  for (;;) {
    const pending: { id: Id<'search_shard_pending'>; name: string; present: boolean }[] = await ctx.runQuery(internal.views.pendingShardChanges, {});
    if (pending.length === 0) return;
    const added = pending.filter((p) => p.present).map((p) => p.name);
    const removed = pending.filter((p) => !p.present).map((p) => p.name);
    const bigrams = new Set<string>();
    for (const { name } of pending) for (const bigram of nameBigrams(name)) bigrams.add(bigram);
    const list = [...bigrams];
    for (let i = 0; i < list.length; i += 20) {
      await ctx.runMutation(internal.views.patchSearchShards, { bigrams: list.slice(i, i + 20), added, removed });
    }
    await ctx.runMutation(internal.views.clearPendingShardChanges, { applied: pending.map(({ id, present }) => ({ id, present })) });
    if (pending.length < 500) return;
  }
}

// ---------------------------------------------------------------------------
// Full rebuild
// ---------------------------------------------------------------------------

export const scanResultsPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query('lifting_results').paginate({ cursor, numItems: PAGE_SIZE });
    const names = new Set<string>();
    const classes = new Set<string>();
    for (const row of page.page) {
      names.add(row.name);
      if (row.federation !== undefined && row.age !== undefined) classes.add(JSON.stringify([row.federation, row.age]));
    }
    return { names: [...names], classes: [...classes], cursor: page.continueCursor, isDone: page.isDone };
  },
});

// The meet index (`MEET_INDEX_VIEW`): every meet that has views, kept so a
// refresh never rediscovers it from the tables.

/** Distinct roster meets per `rosterMeetsPage` query, one index seek each. */
const ROSTER_MEETS_PER_PAGE = 500;

/**
 * The next roster meets after `after`: one read per meet (a skip along the
 * index), not one per roster row, since rosters are never deleted.
 */
export const rosterMeetsPage = internalQuery({
  args: { after: v.union(v.string(), v.null()) },
  handler: async (ctx, { after }): Promise<{ meets: string[]; after: string | null }> => {
    const meets: string[] = [];
    let last = after;
    for (let i = 0; i < ROSTER_MEETS_PER_PAGE; i += 1) {
      const lower = last;
      const athlete = await ctx.db
        .query('athletes')
        .withIndex('by_meet', (q) => (lower === null ? q : q.gt('meet', lower)))
        .first();
      if (!athlete) return { meets, after: null };
      meets.push(athlete.meet);
      last = athlete.meet;
    }
    return { meets, after: last };
  },
});

/** Every meet row's name, as JSON text (the list may pass Convex's array limit). */
export const meetRowNames = internalQuery({
  args: {},
  handler: async (ctx): Promise<string> => JSON.stringify((await ctx.db.query('meets').collect()).map((m) => m.name)),
});

/**
 * Every meet with a meet row or a roster, sorted, read from the tables.
 * Rosters can arrive before their meet row; their start lists still resolve.
 */
async function discoverMeets(ctx: ActionCtx): Promise<string[]> {
  const names = new Set(JSON.parse(await ctx.runQuery(internal.views.meetRowNames, {})) as string[]);
  let after: string | null = null;
  do {
    const page: { meets: string[]; after: string | null } = await ctx.runQuery(internal.views.rosterMeetsPage, { after });
    for (const meet of page.meets) names.add(meet);
    after = page.after;
  } while (after !== null);
  return [...names].sort(compareBytes);
}

export const storeMeetIndex = internalMutation({
  args: { chunks: v.array(v.string()) },
  handler: async (ctx, { chunks }) => {
    await writeView(ctx, MEET_INDEX_VIEW, chunks, []);
  },
});

/** Adds and removes meets in the index; never creates it (a partial index would hide meets). */
export const patchMeetIndex = internalMutation({
  args: { add: v.array(v.string()), remove: v.array(v.string()) },
  handler: async (ctx, { add, remove }) => {
    const text = await readViewJsonAnyAge(ctx, MEET_INDEX_VIEW);
    if (text === null) return;
    const meets = new Set(JSON.parse(text) as string[]);
    for (const meet of add) meets.add(meet);
    for (const meet of remove) meets.delete(meet);
    await writeView(ctx, MEET_INDEX_VIEW, jsonChunks([...meets].sort(compareBytes)), []);
  },
});

/** The meet index, built from the tables the first time it is needed. */
async function loadMeetIndex(ctx: ActionCtx): Promise<string[]> {
  const text: string | null = await ctx.runQuery(internal.views.jsonViewAnyAge, { key: MEET_INDEX_VIEW });
  if (text !== null) return JSON.parse(text) as string[];
  const meets = await discoverMeets(ctx);
  await ctx.runMutation(internal.views.storeMeetIndex, { chunks: jsonChunks(meets) });
  return meets;
}

/** Meets checked per `meetsWithViews` query (two index seeks each at most). */
const MEETS_PER_EXISTENCE_CHECK = 200;

/** Of `meets`, those with a meet row or a roster: the ones that have views. */
export const meetsWithViews = internalQuery({
  args: { meets: v.array(v.string()) },
  handler: async (ctx, { meets }) => {
    const found = await Promise.all(
      meets.map(async (meet) => {
        const row = await ctx.db
          .query('meets')
          .withIndex('by_name', (q) => q.eq('name', meet))
          .first();
        if (row) return meet;
        const athlete = await ctx.db
          .query('athletes')
          .withIndex('by_meet', (q) => q.eq('meet', meet))
          .first();
        return athlete ? meet : null;
      }),
    );
    return found.filter((meet): meet is string => meet !== null);
  },
});

/**
 * Deletes every view of these meets. For meets with results but no meet row
 * or roster: their views are not rebuilt, and one left behind would be served
 * as fresh once the meet's hint was gone, while its results changed.
 */
export const deleteMeetViews = internalMutation({
  args: { meets: v.array(v.string()) },
  handler: async (ctx, { meets }) => {
    let deleted = 0;
    for (const meet of meets) deleted += await deleteViewsWithPrefix(ctx, meetViewsPrefix(meet));
    return deleted;
  },
});

export const viewKeysWithPrefix = internalQuery({
  args: { prefix: v.string() },
  handler: async (ctx, { prefix }) => await keysWithPrefix(ctx, prefix),
});

/** Rewrites the history documents of `keys` (`lib/history.ts`). */
export const buildHistories = internalMutation({
  args: { keys: v.array(v.string()) },
  handler: async (ctx, { keys }) => await writeHistories(ctx, keys),
});

/** Summary keys checked per page by the rebuild's `prune` stage. */
const PRUNE_PAGE = 4000;

/** The next `limit` summary keys after `after`, in key order. */
export const summaryKeysAfter = internalQuery({
  args: { after: v.string(), limit: v.number() },
  handler: async (ctx, { after, limit }) =>
    (
      await ctx.db
        .query('athlete_summary')
        .withIndex('by_nameKey', (q) => q.gt('nameKey', after))
        .take(limit)
    ).map((row) => row.nameKey),
});

/** Marks the history documents complete, so readers stop computing live. */
export const markHistoriesReady = internalMutation({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query('data_versions')
      .withIndex('by_table', (q) => q.eq('table', HISTORY_READY))
      .unique();
    if (row) await ctx.db.patch(row._id, { version: 1 });
    else await ctx.db.insert('data_versions', { table: HISTORY_READY, version: 1 });
  },
});

/** Keys per `buildHistories` call: an athlete averages a handful of results. */
const HISTORY_BATCH = 250;

async function rebuildMeet(ctx: ActionCtx, meet: string): Promise<void> {
  await ctx.runMutation(internal.views.buildMeet, { meet });
  await ctx.runMutation(internal.views.buildMeetTimelines, { meet });
  await buildStats(ctx, meet);
}

// ---------------------------------------------------------------------------
// Refresh after writes
// ---------------------------------------------------------------------------

type Hint = { id: string; kind: string; key: string; seq: number; since?: string };

const REBUILD_STAGES = ['scan', 'histories', 'prune', 'nat', 'meets', 'reference', 'sweep'] as const;
type RebuildStage = (typeof REBUILD_STAGES)[number];

/** Where a rebuild stage started: what a rebuild that stopped resumes from. */
type RebuildPosition = {
  stage: RebuildStage;
  offset: number;
  after?: string;
  cursor?: string;
  startedAt: number;
  again: boolean;
};

type RefreshBegin = {
  hints: Hint[];
  overflow: boolean;
  /** More hints are pending than this refresh read (MAX_REFRESH_HINTS). */
  more?: boolean;
  /** The creation time of the last hint read, where the next page starts. */
  lastRead?: number | null;
  rebuilding: boolean;
  rebuildHeartbeat: number | null;
  rebuildPosition: RebuildPosition | null;
  /** This refresh's lease, or null when another refresh holds it (or none was asked for). */
  lease: number | null;
  busy: boolean;
};

/**
 * A refresh holds the lease for at most this long: longer than an action can
 * run, so a refresh that died without releasing it is taken over after this.
 */
const REFRESH_LEASE_MS = 11 * 60 * 1000;

async function refreshState(ctx: QueryCtx) {
  return await ctx.db
    .query('view_state')
    .withIndex('by_name', (q) => q.eq('name', 'refresh'))
    .unique();
}

/** Schedules a refresh unless one is already waiting (called by every write). */
export async function scheduleRefresh(ctx: MutationCtx, delayMs: number = REFRESH_DELAY_MS): Promise<void> {
  const state = await refreshState(ctx);
  if (state?.scheduled) return;
  await ctx.scheduler.runAfter(delayMs, internal.views.refresh, {});
  if (state) await ctx.db.patch(state._id, { scheduled: true });
  else await ctx.db.insert('view_state', { name: 'refresh', scheduled: true, baseline: [] });
}

function storedPosition(position: { stage: string; offset: number; after?: string; cursor?: string; startedAt?: number; again: boolean } | undefined): RebuildPosition | null {
  if (!position || position.startedAt === undefined) return null;
  const stage = REBUILD_STAGES.find((s) => s === position.stage);
  return stage === undefined ? null : { ...position, stage, startedAt: position.startedAt };
}

/**
 * Starts a refresh: clears the "scheduled" flag (so writes from here on
 * schedule another run), and returns the pending hints and the state of the
 * full rebuild.
 *
 * With `lease`, the refresh also takes the refresh lease, so two never run
 * at once (they would redo the same builds and conflict on the same views).
 * If another holds it, this one is `busy`: it schedules itself again after
 * REFRESH_BUSY_RETRY_MS and returns without the hints.
 */
export const beginRefresh = internalMutation({
  // `retry: false`: a caller that retries itself when busy (rebuildAll), so
  // no refresh is queued for it.
  args: { lease: v.optional(v.boolean()), retry: v.optional(v.boolean()), after: v.optional(v.number()) },
  handler: async (ctx, args): Promise<RefreshBegin> => {
    const state = await refreshState(ctx);
    const now = Date.now();
    const held = state?.refreshLease !== undefined && now - state.refreshLease < REFRESH_LEASE_MS;
    if (args.lease && held) {
      if (args.retry !== false) {
        await ctx.scheduler.runAfter(REFRESH_BUSY_RETRY_MS, internal.views.refresh, {});
        if (state) await ctx.db.patch(state._id, { scheduled: true });
      }
      return { hints: [], overflow: false, rebuilding: false, rebuildHeartbeat: null, rebuildPosition: null, lease: null, busy: true };
    }
    const lease = args.lease ? now : null;
    if (state) await ctx.db.patch(state._id, { scheduled: false, ...(lease !== null ? { refreshLease: lease } : {}) });
    else if (lease !== null) await ctx.db.insert('view_state', { name: 'refresh', scheduled: false, baseline: [], refreshLease: lease });
    const after = args.after;
    const all =
      after === undefined
        ? await ctx.db.query('view_hints').take(MAX_REFRESH_HINTS + 1)
        : await ctx.db
            .query('view_hints')
            .withIndex('by_creation_time', (q) => q.gt('_creationTime', after))
            .take(MAX_REFRESH_HINTS + 1);
    const rows = all.slice(0, MAX_REFRESH_HINTS);
    // A rebuild's failed targets are retried here, never by another rebuild:
    // a build that fails everywhere would otherwise loop full rebuilds.
    const costly = rows.filter((h) => !CHEAP_HINT_KINDS.has(h.kind) && !h.retry).length;
    return {
      hints: rows.map((h) => ({ id: h._id, kind: h.kind, key: h.key, seq: h.seq ?? 0, since: h.since })),
      overflow: costly > MAX_TARGETED_HINTS,
      more: all.length > MAX_REFRESH_HINTS,
      lastRead: rows.length > 0 ? rows[rows.length - 1]._creationTime : null,
      rebuilding: state?.rebuilding ?? false,
      rebuildHeartbeat: state?.rebuildHeartbeat ?? null,
      rebuildPosition: storedPosition(state?.rebuildPosition),
      lease,
      busy: false,
    };
  },
});

/** Releases the refresh lease, if it is still this refresh's. */
export const releaseRefresh = internalMutation({
  args: { lease: v.number() },
  handler: async (ctx, { lease }) => {
    const state = await refreshState(ctx);
    if (state?.refreshLease === lease) await ctx.db.patch(state._id, { refreshLease: undefined });
  },
});

/** Meets checked per query when a refresh looks for rosters listing written athletes. */
const MEETS_PER_KEY_CHECK = 100;

/** A meet whose roster lists some written athletes, and its stats view's `meta`. */
type RosterListing = { meet: string; keys: string[]; statsMeta: string | null };

/**
 * Of `meets`, those whose roster (the `keys` view) lists any of `keys`, with
 * the keys listed. One query per batch of meets, not one per meet.
 */
export const meetsListingAny = internalQuery({
  args: { meets: v.array(v.string()), keys: v.array(v.string()) },
  handler: async (ctx, { meets, keys }): Promise<RosterListing[]> => {
    const wanted = new Set(keys);
    const listed = await Promise.all(
      meets.map(async (meet) => {
        const roster = JSON.parse((await readViewJsonAnyAge(ctx, meetKey(meet, 'keys'))) ?? '[]') as string[];
        const matched = roster.filter((key) => wanted.has(key));
        if (matched.length === 0) return null;
        const stats = await viewHeader(ctx, meetKey(meet, 'stats'));
        return { meet, keys: matched, statsMeta: stats?.meta ?? null };
      }),
    );
    return listed.filter((listing): listing is RosterListing => listing !== null);
  },
});

/** Hints deleted (or requeued) per mutation. */
const HINT_DELETE_BATCH = 1000;

/**
 * Deletes the hints a refresh handled, each only if no write named it again
 * since the refresh read it (a newer write's hint stays for the next one).
 * One read per hint, never a scan of the table.
 */
export const deleteHints = internalMutation({
  args: { hints: v.array(v.object({ id: v.string(), seq: v.number() })) },
  handler: async (ctx, { hints }) => {
    let deleted = 0;
    for (const { id, seq } of hints) {
      const hintId = ctx.db.normalizeId('view_hints', id);
      const hint = hintId ? await ctx.db.get(hintId) : null;
      if (hint && (hint.seq ?? 0) === seq) {
        await ctx.db.delete(hint._id);
        deleted += 1;
      }
    }
    return deleted;
  },
});

/**
 * Leaves (or renews) hints for views a full rebuild failed to build, so they
 * stay stale, survive the rebuild's sweeps, and the next (targeted) refresh
 * retries them; counted in `rebuildFailures`, which the hourly job alerts on.
 */
export const requeueHints = internalMutation({
  args: { hints: v.array(v.object({ kind: v.string(), key: v.string() })) },
  handler: async (ctx, { hints }) => {
    const updatedAt = Date.now();
    for (const { kind, key } of hints) {
      const existing = await ctx.db
        .query('view_hints')
        .withIndex('by_kind_key', (q) => q.eq('kind', kind).eq('key', key))
        .first();
      if (existing) await ctx.db.patch(existing._id, { seq: (existing.seq ?? 0) + 1, updatedAt, retry: true });
      else await ctx.db.insert('view_hints', { kind, key, seq: 0, updatedAt, retry: true });
    }
    const state = await refreshState(ctx);
    if (state) await ctx.db.patch(state._id, { rebuildFailures: (state.rebuildFailures ?? 0) + 1 });
  },
});

/** Clears the rebuild failure count once a refresh has rebuilt everything pending without a failure. */
export const clearRebuildFailures = internalMutation({
  args: {},
  handler: async (ctx) => {
    const state = await refreshState(ctx);
    if (state?.rebuildFailures !== undefined) await ctx.db.patch(state._id, { rebuildFailures: undefined });
  },
});

async function deleteHandled(ctx: ActionCtx, hints: readonly Hint[]): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < hints.length; i += HINT_DELETE_BATCH) {
    const batch = hints.slice(i, i + HINT_DELETE_BATCH).map(({ id, seq }) => ({ id, seq }));
    deleted += await ctx.runMutation(internal.views.deleteHints, { hints: batch });
  }
  return deleted;
}

// ---------------------------------------------------------------------------
// Full rebuild, in stages
// ---------------------------------------------------------------------------

/** Each stage action, and each refresh, stops after this long and schedules its continuation. */
const STAGE_BUDGET_MS = 3 * 60 * 1000;
const REBUILD_CLASSES_VIEW = 'rebuild|classes';
const SCAN_NAMES_VIEW = 'rebuild|scan-names';
const SCAN_CLASSES_VIEW = 'rebuild|scan-classes';

const sourceVersion = v.object({ table: v.string(), version: v.number() });
const rebuildStageArgs = {
  stage: v.union(...REBUILD_STAGES.map((stage) => v.literal(stage))),
  offset: v.number(),
  // The `prune` and `sweep` stages' position: the last key they checked.
  after: v.optional(v.string()),
  // The `scan` stage's position: the page cursor it stopped at. Names and
  // classes seen before it are kept in the scratch views below.
  cursor: v.optional(v.string()),
  // What a refresh read when it started the rebuild, from when the rebuild
  // consumed exactly those hints; only stages scheduled before then carry them.
  hints: v.optional(v.array(v.object({ id: v.string(), seq: v.number() }))),
  versions: v.optional(v.array(sourceVersion)),
  again: v.boolean(),
  // When the rebuild began: every hint last updated before then is covered,
  // and every view built before then that it did not rebuild is an orphan.
  // Optional only for stages scheduled before this field existed.
  startedAt: v.optional(v.number()),
};

/** Deletes up to a batch of hints last updated before `before`; returns how many. */
export const deleteHintsUpdatedBefore = internalMutation({
  args: { before: v.number() },
  handler: async (ctx, { before }) => {
    const stale = await ctx.db
      .query('view_hints')
      .withIndex('by_updatedAt', (q) => q.gte('updatedAt', 0).lt('updatedAt', before))
      .take(HINT_DELETE_BATCH);
    for (const hint of stale) await ctx.db.delete(hint._id);
    return stale.length;
  },
});

/** View headers checked per `sweepViewsPage` mutation. */
const SWEEP_PAGE = 200;
/**
 * Chunks (up to 700 KB each) one `sweepViewsPage` deletes before it stops:
 * deleting reads them, and a transaction may read at most 16 MiB.
 */
const SWEEP_CHUNK_BUDGET = 8;

/**
 * Whether a write (or a failed build, see `requeueHints`) named something
 * `key` reads at or after `since`.
 */
async function changedSince(ctx: QueryCtx, key: string, since: number): Promise<boolean> {
  for (const { kind, key: hintKey } of viewDependencies(key)?.hints ?? []) {
    const hint = await ctx.db
      .query('view_hints')
      .withIndex('by_kind_key', (q) => q.eq('kind', kind).eq('key', hintKey))
      .first();
    if (hint && (hint.updatedAt ?? 0) >= since) return true;
  }
  return false;
}

/**
 * The rebuild's last pass: deletes the views after `after` that it did not
 * rebuild (built before `before`) and that no later write names, so a deleted
 * meet, ranking class or WSO, or a key of a retired layout, is not left
 * behind to be served as fresh. The refresh machinery's own views are kept.
 */
export const sweepViewsPage = internalMutation({
  args: { after: v.string(), before: v.number() },
  handler: async (ctx, { after, before }) => {
    const headers = await ctx.db
      .query('views')
      .withIndex('by_key', (q) => q.gt('key', after))
      .take(SWEEP_PAGE);
    let deleted = 0;
    let chunks = 0;
    for (const [i, header] of headers.entries()) {
      // Always at least one, so the sweep moves on past any view.
      if (deleted > 0 && chunks + header.chunk_count > SWEEP_CHUNK_BUDGET) return { after: headers[i - 1].key, deleted };
      if (header.built_at >= before || INTERNAL_VIEW_PREFIXES.some((prefix) => header.key.startsWith(prefix))) continue;
      if (await changedSince(ctx, header.key, before)) continue;
      await deleteHeaderAndChunks(ctx, header);
      deleted += 1;
      chunks += header.chunk_count;
    }
    return { after: headers.length < SWEEP_PAGE ? null : headers[headers.length - 1].key, deleted };
  },
});

/** Stores a text view outside the refresh machinery (the scan's progress). */
export const storeScratchText = internalMutation({
  args: { key: v.string(), chunks: v.array(v.string()) },
  handler: async (ctx, { key, chunks }) => {
    await writeView(ctx, key, chunks, [], { text: true });
  },
});

/** Stores a JSON view outside the refresh machinery (the scan's progress, the rebuild's classes). */
export const storeScratchJson = internalMutation({
  args: { key: v.string(), chunks: v.array(v.string()) },
  handler: async (ctx, { key, chunks }) => {
    await writeView(ctx, key, chunks, []);
  },
});

export const jsonViewAnyAge = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => await readViewJsonAnyAge(ctx, key),
});

export const textViewAnyAge = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => await readViewTextAnyAge(ctx, key),
});

/** Queues a refresh `delayMs` ahead unless one is already waiting. */
export const queueRefresh = internalMutation({
  args: { delayMs: v.number() },
  handler: async (ctx, { delayMs }) => {
    await scheduleRefresh(ctx, delayMs);
  },
});

const rebuildPosition = v.object({
  stage: v.string(),
  offset: v.number(),
  after: v.optional(v.string()),
  cursor: v.optional(v.string()),
  startedAt: v.optional(v.number()),
  again: v.boolean(),
});

/**
 * Marks a rebuild running (and beats its heartbeat, recording where the
 * stage starting now begins) or finished. Each stage calls it with `true` as
 * it starts.
 */
export const setRebuilding = internalMutation({
  args: { rebuilding: v.boolean(), restarted: v.optional(v.boolean()), fresh: v.optional(v.boolean()), position: v.optional(rebuildPosition) },
  handler: async (ctx, { rebuilding, restarted, fresh, position }) => {
    const state = await refreshState(ctx);
    const fields = {
      rebuilding,
      rebuildHeartbeat: rebuilding ? Date.now() : undefined,
      // Counted while a rebuild keeps stopping; cleared when one finishes.
      ...(restarted ? { rebuildRestarts: (state?.rebuildRestarts ?? 0) + 1 } : rebuilding ? {} : { rebuildRestarts: undefined }),
      // A new rebuild (not a resumed one) counts its own failed builds.
      ...(fresh ? { rebuildFailures: undefined } : {}),
      ...(position ? { rebuildPosition: position } : rebuilding ? {} : { rebuildPosition: undefined }),
    };
    if (state) await ctx.db.patch(state._id, fields);
    else await ctx.db.insert('view_state', { name: 'refresh', scheduled: false, baseline: [], ...fields });
  },
});

/**
 * Runs one of a rebuild's builds. A build that throws (a malformed row, a
 * meet past a read limit) is logged and left a hint, so its views stay stale
 * and a later refresh retries it, rather than stopping the whole rebuild.
 */
async function rebuildTarget(ctx: ActionCtx, label: string, hints: { kind: string; key: string }[], build: () => Promise<unknown>): Promise<void> {
  try {
    await build();
  } catch (error) {
    console.error(`views: the full rebuild could not build ${label}; left pending for the refresh`, error);
    await ctx.runMutation(internal.views.requeueHints, { hints });
  }
}

const REFERENCE_TABLE_HINTS = ['records', 'standards', 'qualifying_totals', 'intl_rankings'].map((key) => ({ kind: 'table', key }));

/**
 * One stage of a full rebuild: `scan` (search directory and ranking classes),
 * `histories`, `prune` (histories of names left with no results), `nat`,
 * `meets`, `reference`, `sweep` (views of what no longer exists). Each works
 * for at most `STAGE_BUDGET_MS` and schedules its own continuation or the
 * next stage, so no action comes near the runtime limit. Each records where
 * it started, so a rebuild whose stage failed resumes there. The last stage
 * consumes every hint updated before the rebuild began.
 */
export const rebuildStage = internalAction({
  args: rebuildStageArgs,
  handler: async (ctx, args): Promise<string> => {
    const startedAt = Date.now();
    const overBudget = () => Date.now() - startedAt > STAGE_BUDGET_MS;
    const position =
      args.startedAt === undefined
        ? undefined
        : { stage: args.stage, offset: args.offset, after: args.after, cursor: args.cursor, startedAt: args.startedAt, again: args.again };
    await ctx.runMutation(internal.views.setRebuilding, { rebuilding: true, position });
    const next = async (stage: RebuildStage, offset: number, at: { after?: string; cursor?: string } = {}) => {
      await ctx.scheduler.runAfter(0, internal.views.rebuildStage, { ...args, stage, offset, after: at.after, cursor: at.cursor });
      return `${args.stage} -> ${stage}@${offset}`;
    };

    switch (args.stage) {
      case 'scan': {
        // A scan too long for one stage continues in the next from its
        // cursor, carrying what it has seen in the scratch views; a first
        // stage (no cursor) starts clean whatever an abandoned scan left.
        const resumed = args.cursor !== undefined;
        const names = new Set<string>(
          resumed ? directoryNames((await ctx.runQuery(internal.views.textViewAnyAge, { key: SCAN_NAMES_VIEW })) ?? '') : [],
        );
        const classes = new Set<string>(
          resumed ? (JSON.parse((await ctx.runQuery(internal.views.jsonViewAnyAge, { key: SCAN_CLASSES_VIEW })) ?? '[]') as string[]) : [],
        );
        let cursor: string | null = args.cursor ?? null;
        for (;;) {
          const page: { names: string[]; classes: string[]; cursor: string; isDone: boolean } = await ctx.runQuery(
            internal.views.scanResultsPage,
            { cursor },
          );
          page.names.forEach((n) => names.add(n));
          page.classes.forEach((c) => classes.add(c));
          if (page.isDone) break;
          cursor = page.cursor;
          if (overBudget()) {
            await ctx.runMutation(internal.views.storeScratchText, { key: SCAN_NAMES_VIEW, chunks: textChunks(directoryText([...names].sort(compareCollated))) });
            await ctx.runMutation(internal.views.storeScratchJson, { key: SCAN_CLASSES_VIEW, chunks: jsonChunks([...classes]) });
            return await next('scan', 0, { cursor });
          }
        }
        const sortedNames = [...names].sort(compareCollated);
        await ctx.runMutation(internal.views.storeResultNames, { chunks: textChunks(directoryText(sortedNames)) });
        await rebuildSearchShards(ctx, sortedNames);
        await ctx.runMutation(internal.views.storeScratchJson, {
          key: REBUILD_CLASSES_VIEW,
          chunks: jsonChunks([...classes].sort()),
        });
        return await next('histories', 0);
      }
      case 'histories': {
        const text: string | null = await ctx.runQuery(internal.views.textViewAnyAge, { key: RESULT_NAMES_VIEW });
        const keys = [...new Set(directoryNames(text ?? '').map(normalizeName))].sort(compareBytes);
        let i = args.offset;
        for (; i < keys.length && !overBudget(); i += HISTORY_BATCH) {
          await ctx.runMutation(internal.views.buildHistories, { keys: keys.slice(i, i + HISTORY_BATCH) });
        }
        if (i < keys.length) return await next('histories', i);
        await ctx.runMutation(internal.views.markHistoriesReady, {});
        return await next('prune', 0);
      }
      case 'prune': {
        // History and summary documents of names no longer in the directory
        // (their results were deleted outside `ingest.ts`, e.g. a bulk
        // import): rewriting them from their (absent) results deletes them.
        // Summaries are the small half of each pair, so they are what is paged.
        const text: string | null = await ctx.runQuery(internal.views.textViewAnyAge, { key: RESULT_NAMES_VIEW });
        const current = new Set(directoryNames(text ?? '').map(normalizeName));
        let after = args.after ?? '';
        for (;;) {
          const keys: string[] = await ctx.runQuery(internal.views.summaryKeysAfter, { after, limit: PRUNE_PAGE });
          const orphans = keys.filter((key) => !current.has(key));
          for (let i = 0; i < orphans.length; i += HISTORY_BATCH) {
            await ctx.runMutation(internal.views.buildHistories, { keys: orphans.slice(i, i + HISTORY_BATCH) });
          }
          if (keys.length < PRUNE_PAGE) return await next('nat', 0);
          after = keys[keys.length - 1];
          if (overBudget()) return await next('prune', 0, { after });
        }
      }
      case 'nat': {
        const text: string | null = await ctx.runQuery(internal.views.jsonViewAnyAge, { key: REBUILD_CLASSES_VIEW });
        const classes = JSON.parse(text ?? '[]') as string[];
        let i = args.offset;
        for (; i < classes.length && !overBudget(); i += 1) {
          const [federation, ageCategory] = JSON.parse(classes[i]) as [string, string];
          await rebuildTarget(ctx, natKey(federation, ageCategory), [{ kind: 'nat', key: classes[i] }], () =>
            ctx.runAction(internal.views.buildNat, { federation, ageCategory }),
          );
        }
        return i < classes.length ? await next('nat', i) : await next('meets', 0);
      }
      case 'meets': {
        // The stage's first run rewrites the meet index from the tables; its
        // continuations walk that list.
        let meets: string[];
        if (args.offset === 0) {
          meets = await discoverMeets(ctx);
          await ctx.runMutation(internal.views.storeMeetIndex, { chunks: jsonChunks(meets) });
        } else {
          meets = await loadMeetIndex(ctx);
        }
        let i = args.offset;
        for (; i < meets.length && !overBudget(); i += 1) {
          const meet = meets[i];
          await rebuildTarget(ctx, `meet ${meet}`, [{ kind: 'meet', key: meet }], () => rebuildMeet(ctx, meet));
        }
        return i < meets.length ? await next('meets', i) : await next('reference', 0);
      }
      case 'reference': {
        await rebuildTarget(ctx, 'reference tables', [...REFERENCE_TABLE_HINTS, { kind: 'adaptive', key: '1' }], () =>
          ctx.runMutation(internal.views.buildReferenceTables, {}),
        );
        await rebuildTarget(ctx, 'club list', [{ kind: 'table', key: 'athletes' }], () => ctx.runAction(internal.views.buildClubs, {}));
        await rebuildTarget(ctx, 'WSO records', [{ kind: 'table', key: 'wso_records' }], () => ctx.runMutation(internal.views.buildWso, {}));
        return await next('sweep', 0);
      }
      case 'sweep': {
        if (args.startedAt !== undefined) {
          let after = args.after ?? '';
          for (;;) {
            const page: { after: string | null; deleted: number } = await ctx.runMutation(internal.views.sweepViewsPage, {
              after,
              before: args.startedAt,
            });
            if (page.after === null) break;
            after = page.after;
            if (overBudget()) return await next('sweep', 0, { after });
          }
          // Every hint updated before the rebuild began, not just those a
          // refresh read: a backlog over MAX_REFRESH_HINTS would otherwise
          // take one full rebuild per MAX_REFRESH_HINTS hints to clear.
          while ((await ctx.runMutation(internal.views.deleteHintsUpdatedBefore, { before: args.startedAt })) === HINT_DELETE_BATCH) {
            // next batch
          }
        } else if (args.hints) {
          // A rebuild started before the sweep existed: the hints it read.
          for (let i = 0; i < args.hints.length; i += HINT_DELETE_BATCH) {
            await ctx.runMutation(internal.views.deleteHints, { hints: args.hints.slice(i, i + HINT_DELETE_BATCH) });
          }
        }
        await ctx.runMutation(internal.views.setRebuilding, { rebuilding: false });
        // Now, not through the queued probe (up to REBUILD_WAIT_MS away): the
        // writes that arrived during the rebuild, and the builds it left
        // pending, are applied at once. With none, the refresh does nothing.
        await ctx.scheduler.runAfter(0, internal.views.refresh, {});
        return 'done';
      }
    }
  },
});

/**
 * The rebuild's hint sweep leaves hints from this long before it started: a
 * write whose mutation read the clock just before the rebuild began may commit
 * after the scan passed its rows. Hints left over only cost a targeted
 * refresh.
 */
const REBUILD_HINT_MARGIN_MS = 60 * 1000;

/**
 * Starts a rebuild, or resumes one at `from` (where its last stage started,
 * so a stage that failed does not send it back to the scan).
 */
async function startRebuild(ctx: ActionCtx, options: { again: boolean; restarted?: boolean; from?: RebuildPosition | null }): Promise<void> {
  await ctx.runMutation(internal.views.setRebuilding, { rebuilding: true, restarted: options.restarted, fresh: !options.from });
  // The probe that notices if a stage fails (see `refresh`).
  await ctx.runMutation(internal.views.queueRefresh, { delayMs: REBUILD_WAIT_MS });
  const from = options.from ?? null;
  const position = from
    ? { ...from, again: from.again || options.again }
    : { stage: 'scan' as const, offset: 0, again: options.again, startedAt: Date.now() - REBUILD_HINT_MARGIN_MS };
  await ctx.scheduler.runAfter(0, internal.views.rebuildStage, position);
}

/**
 * Rebuilds every view and history document, in stages (`rebuildStage`); run
 * after a bulk load or any write that skipped `ingest.ts`. Returns once the
 * first stage is scheduled; ordinary writes are handled by `refresh`.
 *
 *   npx convex run views:rebuildAll
 */
export const rebuildAll = internalAction({
  args: {},
  handler: async (ctx): Promise<string> => {
    // Under the refresh lease, so a refresh cannot start a rebuild of its own
    // at the same moment.
    const begin: RefreshBegin = await ctx.runMutation(internal.views.beginRefresh, { lease: true, retry: false });
    if (begin.busy) {
      // Started by a migration as often as by hand: never just dropped.
      await ctx.scheduler.runAfter(REFRESH_BUSY_RETRY_MS, internal.views.rebuildAll, {});
      return 'a refresh is running; the rebuild starts when it ends';
    }
    try {
      if (begin.rebuilding && begin.rebuildHeartbeat !== null && Date.now() - begin.rebuildHeartbeat < REBUILD_STALE_MS) {
        // A second chain would redo the same work alongside the first.
        return 'already running';
      }
      await startRebuild(ctx, { again: false });
      return 'scheduled';
    } finally {
      if (begin.lease !== null) await ctx.runMutation(internal.views.releaseRefresh, { lease: begin.lease });
    }
  },
});

/**
 * Rebuilds the views the pending writes can have changed (see `refreshTargets`).
 *
 * Hint kinds (written by `ingest.recordWrite`):
 * - `nat` `[fed, age]`: a result in that ranking class changed.
 * - `meet` name: a roster, schedule or result row of that meet changed.
 * - `athlete` folded name (and `since`, the earliest result date changed):
 *   that athlete's results changed (their bests, PR baseline and timeline, in
 *   every meet whose roster lists them).
 * - `table` name: a reference table, or `athletes` (the club list), changed.
 * - `adaptive`: an adaptive result changed.
 * - `name` raw name: a result row carries this name (search directory).
 */
export const refresh = internalAction({
  // `after`: read only hints written after this creation time (the last
  // one the previous page held), so a backlog is paged past hints whose
  // builds keep failing (#215). A scheduled refresh reads from the start.
  args: { after: v.optional(v.number()) },
  handler: async (ctx, { after }): Promise<Record<string, number>> => await runRefresh(ctx, after),
});

/** A refresh has failed to keep up once a write has waited this long. */
const HINT_BACKLOG_ALERT_MS = 2 * 60 * 60 * 1000;
/** A rebuild restarted this many times is failing, not unlucky. */
const REBUILD_RESTART_ALERT = 2;

/** The oldest pending write and how often the running rebuild was restarted. */
export const refreshHealth = internalQuery({
  args: {},
  handler: async (ctx) => {
    // Hints from before `updatedAt` existed have none; their creation stands in.
    const legacy = await ctx.db
      .query('view_hints')
      .withIndex('by_updatedAt', (q) => q.eq('updatedAt', undefined))
      .first();
    const dated = await ctx.db
      .query('view_hints')
      .withIndex('by_updatedAt', (q) => q.gte('updatedAt', 0))
      .first();
    const oldest = [legacy?._creationTime, dated?.updatedAt].filter((t): t is number => t !== undefined);
    const state = await refreshState(ctx);
    return {
      oldestHintAt: oldest.length ? Math.min(...oldest) : null,
      rebuildRestarts: state?.rebuildRestarts ?? 0,
      rebuildFailures: state?.rebuildFailures ?? 0,
    };
  },
});

/**
 * The hourly `views-refresh` job (`cronJobs.ts`): runs a refresh whether or
 * not one is scheduled, so views catch up even when a refresh failed or was
 * lost with nothing written since, then fails (and so emails an alert) when
 * one of its builds failed, writes have been waiting for hours, or the full
 * rebuild keeps stopping.
 */
export const refreshJob = internalAction({
  args: {},
  handler: async (ctx): Promise<Record<string, number>> => {
    const result = await runRefresh(ctx);
    // After a deploy that changed the shard fold (a new size table key), the
    // shards are built here on their own; search reads the whole directory
    // until then.
    if ((await ctx.runQuery(internal.views.jsonViewAnyAge, { key: SEARCH_SHARD_SIZES_VIEW })) === null) {
      result.searchShards = await ctx.runAction(internal.views.buildSearchShards, {});
    }
    const health: { oldestHintAt: number | null; rebuildRestarts: number; rebuildFailures: number } = await ctx.runQuery(
      internal.views.refreshHealth,
      {},
    );
    const problems: string[] = [];
    if ((result.failed ?? 0) > 0) {
      problems.push(`${result.failed} view build(s) failed and stay pending`);
    }
    if (health.oldestHintAt !== null && Date.now() - health.oldestHintAt > HINT_BACKLOG_ALERT_MS) {
      problems.push(`a write has waited ${Math.round((Date.now() - health.oldestHintAt) / 60_000)} minutes for its views to refresh`);
    }
    if (health.rebuildFailures > 0) {
      problems.push(`the last full rebuild could not build ${health.rebuildFailures} group(s) of views, and no refresh has rebuilt them since`);
    }
    if (health.rebuildRestarts >= REBUILD_RESTART_ALERT) {
      problems.push(`the full rebuild has stopped and been restarted ${health.rebuildRestarts} times`);
    }
    if (problems.length) throw new Error(`views are behind: ${problems.join('; ')} (see the Convex logs for views:refresh and views:rebuildStage)`);
    return result;
  },
});

async function runRefresh(ctx: ActionCtx, after?: number): Promise<Record<string, number>> {
  const begin: RefreshBegin = await ctx.runMutation(internal.views.beginRefresh, { lease: true, ...(after === undefined ? {} : { after }) });
  if (begin.busy) return { busy: 1 };
  try {
    return await refreshWith(ctx, begin);
  } finally {
    if (begin.lease !== null) await ctx.runMutation(internal.views.releaseRefresh, { lease: begin.lease });
  }
}

async function refreshWith(ctx: ActionCtx, begin: RefreshBegin): Promise<Record<string, number>> {
  // Checked before the no-change return: a rebuild whose stage failed
  // must be resumed even when nothing else was written.
  const rebuildAlive = begin.rebuildHeartbeat !== null && Date.now() - begin.rebuildHeartbeat < REBUILD_STALE_MS;
  if (begin.rebuilding && rebuildAlive) {
    // Keeps checking until the rebuild ends (and refreshes after it).
    await ctx.runMutation(internal.views.queueRefresh, { delayMs: REBUILD_WAIT_MS });
    return { waiting: 1 };
  }
  if (begin.rebuilding) {
    const from = begin.rebuildPosition;
    console.error(
      `views: the full rebuild stopped (last stage began ${begin.rebuildHeartbeat === null ? 'never' : new Date(begin.rebuildHeartbeat).toISOString()}); ` +
        (from ? `resuming it at ${from.stage}@${from.offset}${from.after !== undefined ? ` after ${from.after}` : ''}` : 'starting it again'),
    );
    await startRebuild(ctx, { again: true, restarted: true, from });
    return { restarted: 1 };
  }
  if (begin.hints.length === 0) return { hints: 0 };
  if (begin.overflow) {
    // Too many changes to target: rebuild everything, then refresh again for
    // whatever arrived meanwhile.
    await startRebuild(ctx, { again: true });
    return { full: 1 };
  }
  const result = await refreshTargets(ctx, begin.hints);
  // More hints than one refresh reads: the next page at once, from after the
  // last hint read, unless this one already queued itself (deferred). Paged
  // by creation time, so hints whose builds failed again (kept, and read
  // first by every refresh) cannot keep the rest from being reached; they
  // are retried by the next refresh from the start.
  if (begin.more && result.deferred === 0 && begin.lastRead != null) {
    await ctx.scheduler.runAfter(0, internal.views.refresh, { after: begin.lastRead });
    return { ...result, more: 1 };
  }
  return result;
}

const REFERENCE_TABLES: ReadonlySet<string> = new Set(['records', 'standards', 'qualifying_totals', 'intl_rankings']);

/**
 * Rebuilds what `hints` name, a group at a time (ranking classes, meets,
 * athletes' meets, reference tables, the search directory), deleting each
 * group's hints as soon as its builds succeed. A build that throws is logged
 * and keeps its hints: with freshness per key only the views it names stay
 * stale, and the next refresh retries it. Past STAGE_BUDGET_MS the remaining
 * groups keep their hints for a refresh queued at once, so no refresh nears
 * the action time limit.
 */
async function refreshTargets(ctx: ActionCtx, hints: readonly Hint[]): Promise<Record<string, number>> {
  const started = Date.now();
  const overBudget = () => Date.now() - started > STAGE_BUDGET_MS;
  let deferred = false;
  let rebuilt = 0;
  let handled = 0;
  const failed: string[] = [];
  const build = async (label: string, run: () => Promise<unknown>): Promise<boolean> => {
    try {
      await run();
      rebuilt += 1;
      return true;
    } catch (error) {
      console.error(`views: could not rebuild ${label}; its changes stay pending`, error);
      failed.push(label);
      return false;
    }
  };
  const done = async (covered: readonly Hint[]) => {
    handled += await deleteHandled(ctx, covered);
  };
  /** False, and the rest deferred, once the budget is spent. */
  const inBudget = () => {
    if (!deferred && overBudget()) deferred = true;
    return !deferred;
  };
  const ofKind = (kind: string) => hints.filter((h) => h.kind === kind);

  const natCovered: Hint[] = [];
  for (const hint of ofKind('nat')) {
    if (!inBudget()) break;
    const [federation, ageCategory] = JSON.parse(hint.key) as [string, string];
    if (await build(natKey(federation, ageCategory), () => ctx.runAction(internal.views.buildNat, { federation, ageCategory }))) {
      natCovered.push(hint);
    }
  }
  await done(natCovered);

  const meetHints = ofKind('meet');
  const athleteHints = ofKind('athlete');
  const index = meetHints.length + athleteHints.length > 0 && inBudget() ? await loadMeetIndex(ctx) : [];
  const failedMeets = new Set<string>();
  const hintedMeets = new Set(meetHints.map((h) => h.key));
  if (meetHints.length > 0 && inBudget()) {
    const hinted = [...hintedMeets].sort(compareBytes);
    const known = new Set<string>();
    for (let i = 0; i < hinted.length; i += MEETS_PER_EXISTENCE_CHECK) {
      const found: string[] = await ctx.runQuery(internal.views.meetsWithViews, { meets: hinted.slice(i, i + MEETS_PER_EXISTENCE_CHECK) });
      for (const meet of found) known.add(meet);
    }
    // A meet with results but neither a meet row nor a roster (most of what
    // the nightly results sync writes) has nothing for its views to hold;
    // its answers are computed live, and any views it had are dropped.
    const unlisted = hinted.filter((meet) => !known.has(meet));
    const indexed = new Set(index);
    const add = [...known].filter((meet) => !indexed.has(meet));
    const remove = unlisted.filter((meet) => indexed.has(meet));
    if (add.length + remove.length > 0) await ctx.runMutation(internal.views.patchMeetIndex, { add, remove });
    const covered = new Set<string>();
    for (let i = 0; i < unlisted.length; i += 50) {
      const batch = unlisted.slice(i, i + 50);
      if (await build(`views of ${batch.length} meet(s) with no row or roster`, () => ctx.runMutation(internal.views.deleteMeetViews, { meets: batch }))) {
        batch.forEach((meet) => covered.add(meet));
      }
    }
    for (const meet of hinted) {
      if (!known.has(meet)) continue;
      if (!inBudget()) break;
      if (await build(`meet ${meet}`, () => rebuildMeet(ctx, meet))) covered.add(meet);
      else failedMeets.add(meet);
    }
    await done(meetHints.filter((h) => covered.has(h.key)));
  }

  if (athleteHints.length > 0 && inBudget()) {
    const since = new Map<string, string | undefined>();
    for (const hint of athleteHints) since.set(hint.key, since.has(hint.key) ? earliestSince(since.get(hint.key), hint.since) : hint.since);
    const keys = [...since.keys()];
    const listings: RosterListing[] = [];
    for (let i = 0; i < index.length && inBudget(); i += MEETS_PER_KEY_CHECK) {
      listings.push(...(await ctx.runQuery(internal.views.meetsListingAny, { meets: index.slice(i, i + MEETS_PER_KEY_CHECK), keys })));
    }
    if (!deferred) {
      // Athletes listed by a meet whose views were not rebuilt keep their hints.
      const blocked = new Set<string>();
      for (const listing of listings) {
        if (hintedMeets.has(listing.meet)) {
          // Rebuilt in full above, or left pending there.
          if (failedMeets.has(listing.meet) || deferred) listing.keys.forEach((key) => blocked.add(key));
          continue;
        }
        if (!inBudget()) {
          listing.keys.forEach((key) => blocked.add(key));
          continue;
        }
        // Stats change only for results dated before the meet's finishers'
        // (`athleteChangeAffects`); timelines for any.
        const stats = listing.keys.some((key) => athleteChangeAffects('stats', since.get(key), listing.statsMeta ?? undefined));
        const ok = await build(`${stats ? 'timelines and stats' : 'timelines'} of ${listing.meet}`, async () => {
          await ctx.runMutation(internal.views.buildMeetTimelines, { meet: listing.meet });
          if (stats) await buildStats(ctx, listing.meet);
        });
        if (!ok) listing.keys.forEach((key) => blocked.add(key));
      }
      await done(athleteHints.filter((h) => !blocked.has(h.key)));
    }
  }

  const tableHints = ofKind('table');
  const referenceHints = [...tableHints.filter((h) => REFERENCE_TABLES.has(h.key)), ...ofKind('adaptive')];
  if (referenceHints.length > 0 && inBudget()) {
    if (await build('reference tables', () => ctx.runMutation(internal.views.buildReferenceTables, {}))) await done(referenceHints);
  }
  const clubHints = tableHints.filter((h) => h.key === 'athletes');
  if (clubHints.length > 0 && inBudget()) {
    if (await build('club list', () => ctx.runAction(internal.views.buildClubs, {}))) await done(clubHints);
  }
  const wsoHints = tableHints.filter((h) => h.key === 'wso_records');
  if (wsoHints.length > 0 && inBudget()) {
    if (await build('WSO records', () => ctx.runMutation(internal.views.buildWso, {}))) await done(wsoHints);
  }

  const nameHints = ofKind('name');
  if (nameHints.length > 0 && inBudget()) {
    const names = [...new Set(nameHints.map((h) => h.key))];
    const ok = await build('search directory', async () => {
      // Each name costs a lookup or two; 500 a batch stays well inside a
      // mutation's read limit.
      for (let i = 0; i < names.length; i += 500) {
        await ctx.runMutation(internal.views.syncResultNames, { names: names.slice(i, i + 500) });
      }
      await applyPendingShardChanges(ctx);
    });
    if (ok) await done(nameHints);
  }

  // Hints nothing reads (a table no view is built from, a retired kind).
  const readKinds = new Set(['nat', 'meet', 'athlete', 'adaptive', 'name']);
  const builtTables = new Set([...REFERENCE_TABLES, 'athletes', 'wso_records']);
  await done(hints.filter((h) => (h.kind === 'table' ? !builtTables.has(h.key) : !readKinds.has(h.kind))));

  if (deferred) await ctx.runMutation(internal.views.queueRefresh, { delayMs: REFRESH_DELAY_MS });
  else if (failed.length === 0) await ctx.runMutation(internal.views.clearRebuildFailures, {});
  return { hints: hints.length, handled, rebuilt, failed: failed.length, deferred: deferred ? 1 : 0 };
}
