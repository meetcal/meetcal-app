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
  computeStatsRows,
  computeTimelines,
  meetByName,
  packageAthlete,
  packageStaticText,
  plainRoster,
  previousBests,
  statsPreviousBestKeys,
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
  MEET_PART_SOURCES,
  MEET_VIEW_PARTS,
  meetKey,
  meetSessionKey,
  meetSessionPrefix,
  natKey,
  REF_VIEWS,
  RESULT_NAMES_VIEW,
  SEARCH_SHARD_PREFIX,
  SEARCH_SHARD_SIZES_VIEW,
  searchShardKey,
  VIEW_SOURCES,
  wsoKey,
} from './lib/viewKeys';
import {
  deleteViewsWithPrefix,
  jsonChunks,
  readViewJsonAnyAge,
  readViewTextAnyAge,
  snapshotVersions,
  SOURCE_TABLES,
  textChunks,
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
 * national meet's two per new lifter do not count against it; all hints
 * together are capped at MAX_REFRESH_HINTS, which a refresh reads and deletes
 * one by one.
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
    for (const row of page.rows) {
      if ((best.get(row.name)?.total ?? -Infinity) < row.total) best.set(row.name, row);
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
    // exists leaves no view behind to be restamped.
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
 * Every result's club-stats row, and each club's distinct athlete count: one
 * item, `{ rows, club_counts }`, so one meet serves every club's summary.
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
    const rows = await computeStatsRows(ctx, meet, undefined, known ?? []);
    const roster = await ctx.db
      .query('athletes')
      .withIndex('by_meet', (q) => q.eq('meet', meet))
      .collect();
    await writeView(ctx, meetKey(meet, 'stats'), jsonChunks([{ rows, club_counts: clubAthleteCounts(roster) }]), stamp);
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
    await ctx.runMutation(internal.views.storeClubs, { clubs, sources });
    return null;
  },
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

/** Adds names to the search directory without a full scan. */
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
  const table = new Map<string, number>(JSON.parse((await readViewJsonAnyAge(ctx, SEARCH_SHARD_SIZES_VIEW)) ?? '[]') as [string, number][]);
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

export const meetNames = internalQuery({
  args: {},
  handler: async (ctx) => {
    const names = new Set((await ctx.db.query('meets').collect()).map((m) => m.name));
    // Rosters can arrive before their meet row; their start lists still
    // resolve. One read per roster's meet (a skip along the index), not one
    // per roster row: rosters are never deleted.
    let last: string | null = null;
    for (;;) {
      const after: string | null = last;
      const athlete = await ctx.db
        .query('athletes')
        .withIndex('by_meet', (q) => (after === null ? q : q.gt('meet', after)))
        .first();
      if (!athlete) break;
      names.add(athlete.meet);
      last = athlete.meet;
    }
    return [...names];
  },
});

/**
 * Deletes every view of these meets. For meets with results but no meet row
 * or roster: their views are not rebuilt, and one left behind would be
 * restamped as fresh by the refresh while its results changed.
 */
export const deleteMeetViews = internalMutation({
  args: { meets: v.array(v.string()) },
  handler: async (ctx, { meets }) => {
    let deleted = 0;
    for (const meet of meets) deleted += await deleteViewsWithPrefix(ctx, `meet|${meet}|`);
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

type Hint = { id: string; kind: string; key: string; seq: number };
type RefreshBegin = {
  hints: Hint[];
  overflow: boolean;
  versions: SourceVersion[];
  baseline: SourceVersion[] | null;
  rebuilding: boolean;
  rebuildHeartbeat: number | null;
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

/**
 * Starts a refresh: clears the "scheduled" flag (so writes from here on
 * schedule another run), and returns the pending hints, the versions now
 * (`versions`, what untouched views are restamped to) and the versions of the
 * last completed refresh (`baseline`: every write since then left a hint).
 *
 * With `lease`, the refresh also takes the refresh lease, so two never run
 * at once (they would redo the same builds and conflict on the same views).
 * If another holds it, this one is `busy`: it schedules itself again after
 * REFRESH_BUSY_RETRY_MS and returns without the hints.
 */
export const beginRefresh = internalMutation({
  // `retry: false`: a caller that retries itself when busy (rebuildAll), so
  // no refresh is queued for it.
  args: { lease: v.optional(v.boolean()), retry: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<RefreshBegin> => {
    const state = await refreshState(ctx);
    const now = Date.now();
    const held = state?.refreshLease !== undefined && now - state.refreshLease < REFRESH_LEASE_MS;
    if (args.lease && held) {
      if (args.retry !== false) {
        await ctx.scheduler.runAfter(REFRESH_BUSY_RETRY_MS, internal.views.refresh, {});
        if (state) await ctx.db.patch(state._id, { scheduled: true });
      }
      return { hints: [], overflow: false, versions: [], baseline: null, rebuilding: false, rebuildHeartbeat: null, lease: null, busy: true };
    }
    const lease = args.lease ? now : null;
    if (state) await ctx.db.patch(state._id, { scheduled: false, ...(lease !== null ? { refreshLease: lease } : {}) });
    else if (lease !== null) await ctx.db.insert('view_state', { name: 'refresh', scheduled: false, baseline: [], refreshLease: lease });
    const all = await ctx.db.query('view_hints').take(MAX_REFRESH_HINTS + 1);
    const rows = all.slice(0, MAX_REFRESH_HINTS);
    const costly = rows.filter((h) => !CHEAP_HINT_KINDS.has(h.kind)).length;
    const versions = await snapshotVersions(ctx, SOURCE_TABLES);
    return {
      hints: rows.map((h) => ({ id: h._id, kind: h.kind, key: h.key, seq: h.seq ?? 0 })),
      overflow: all.length > MAX_REFRESH_HINTS || costly > MAX_TARGETED_HINTS,
      versions,
      baseline: state && state.baseline.length > 0 ? state.baseline : null,
      rebuilding: state?.rebuilding ?? false,
      rebuildHeartbeat: state?.rebuildHeartbeat ?? null,
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

export const viewKeys = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query('views').collect()).map((h) => h.key),
});

/** Meets checked per query when a refresh looks for rosters listing written athletes. */
const MEETS_PER_KEY_CHECK = 100;

/**
 * Of `meets`, those whose roster (the `keys` view) lists any of `keys`. One
 * query per batch of meets, not one per meet: every refresh after a result
 * write asks this of every meet, and the list only grows.
 */
export const meetsListingAny = internalQuery({
  args: { meets: v.array(v.string()), keys: v.array(v.string()) },
  handler: async (ctx, { meets, keys }) => {
    const wanted = new Set(keys);
    const listed = await Promise.all(
      meets.map(async (meet) => {
        const roster = JSON.parse((await readViewJsonAnyAge(ctx, meetKey(meet, 'keys'))) ?? '[]') as string[];
        return roster.some((key) => wanted.has(key)) ? meet : null;
      }),
    );
    return listed.filter((meet): meet is string => meet !== null);
  },
});

/**
 * Ends a refresh: deletes the hints it handled (those not written again
 * since it read them: a newer write's hint stays for the next refresh), and (when `restamp`) moves
 * every view that was neither rebuilt nor affected, and whose stamp is not
 * older than the baseline, up to `versions`. Records `versions` as the new
 * baseline.
 *
 * Why restamping is safe: every write after the baseline left a hint, the
 * refresh rebuilt every view those hints can affect, so a view stamped at or
 * after the baseline and not rebuilt reflects all writes up to `versions`.
 * Writes after `versions` leave hints for the next refresh.
 */
export const finishRefresh = internalMutation({
  args: {
    hints: v.array(v.object({ id: v.string(), seq: v.number() })),
    versions: v.array(v.object({ table: v.string(), version: v.number() })),
    rebuilt: v.array(v.string()),
    restamp: v.boolean(),
  },
  handler: async (ctx, { hints, versions, rebuilt, restamp }) => {
    // Everything here is one scan per table (headers, hints), never one read
    // per item: a refresh after a large write handles thousands of hints and
    // views, and a function may make at most 4,096 reads.
    const state = await refreshState(ctx);
    let restamped = 0;
    if (restamp && state && state.baseline.length > 0) {
      const baseline = new Map(state.baseline.map((s) => [s.table, s.version]));
      const next = new Map(versions.map((s) => [s.table, s.version]));
      const skip = new Set(rebuilt);
      for (const header of await ctx.db.query('views').collect()) {
        if (skip.has(header.key) || !header.sources || header.sources.length === 0) continue;
        if (!header.sources.every((s) => s.version >= (baseline.get(s.table) ?? 0))) continue;
        const stamped = header.sources.map((s) => ({ table: s.table, version: Math.max(s.version, next.get(s.table) ?? s.version) }));
        if (stamped.some((s, i) => s.version !== header.sources![i].version)) {
          await ctx.db.patch(header._id, { sources: stamped });
          restamped += 1;
        }
      }
    }
    // One read per handled hint (at most MAX_REFRESH_HINTS), never a scan
    // of the table, which a large backlog could push past a function's limits.
    for (const { id, seq } of hints) {
      const hintId = ctx.db.normalizeId('view_hints', id);
      const hint = hintId ? await ctx.db.get(hintId) : null;
      if (hint && (hint.seq ?? 0) === seq) await ctx.db.delete(hint._id);
    }
    if (state) await ctx.db.patch(state._id, { baseline: versions });
    else await ctx.db.insert('view_state', { name: 'refresh', scheduled: false, baseline: versions });
    return restamped;
  },
});

// ---------------------------------------------------------------------------
// Full rebuild, in stages
// ---------------------------------------------------------------------------

/** Each stage action stops after this long and schedules its continuation. */
const STAGE_BUDGET_MS = 3 * 60 * 1000;
const REBUILD_CLASSES_VIEW = 'rebuild|classes';
const SCAN_NAMES_VIEW = 'rebuild|scan-names';
const SCAN_CLASSES_VIEW = 'rebuild|scan-classes';

const sourceVersion = v.object({ table: v.string(), version: v.number() });
const rebuildStageArgs = {
  stage: v.union(v.literal('scan'), v.literal('histories'), v.literal('prune'), v.literal('nat'), v.literal('meets'), v.literal('reference')),
  offset: v.number(),
  // The `prune` stage's position: the last summary key it checked.
  after: v.optional(v.string()),
  // The `scan` stage's position: the page cursor it stopped at. Names and
  // classes seen before it are kept in the scratch views below.
  cursor: v.optional(v.string()),
  hints: v.array(v.object({ id: v.string(), seq: v.number() })),
  versions: v.array(sourceVersion),
  again: v.boolean(),
  // When the rebuild began: every hint last updated before then is covered.
  // Optional only for stages scheduled before this field existed.
  startedAt: v.optional(v.number()),
};

/** Hints deleted per mutation when a rebuild clears the backlog it covered. */
const HINT_DELETE_BATCH = 1000;

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

/** Stores a text view outside the refresh machinery (the scan's progress). */
export const storeScratchText = internalMutation({
  args: { key: v.string(), chunks: v.array(v.string()) },
  handler: async (ctx, { key, chunks }) => {
    await writeView(ctx, key, chunks, [], { text: true });
  },
});

export const storeTextView = internalMutation({
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

/** Marks a rebuild running (and beats its heartbeat) or finished. Each stage calls it with `true` as it starts. */
export const setRebuilding = internalMutation({
  args: { rebuilding: v.boolean(), restarted: v.optional(v.boolean()) },
  handler: async (ctx, { rebuilding, restarted }) => {
    const state = await refreshState(ctx);
    const fields = {
      rebuilding,
      rebuildHeartbeat: rebuilding ? Date.now() : undefined,
      // Counted while a rebuild keeps stopping; cleared when one finishes.
      ...(restarted ? { rebuildRestarts: (state?.rebuildRestarts ?? 0) + 1 } : rebuilding ? {} : { rebuildRestarts: undefined }),
    };
    if (state) await ctx.db.patch(state._id, fields);
    else await ctx.db.insert('view_state', { name: 'refresh', scheduled: false, baseline: [], ...fields });
  },
});

/**
 * One stage of a full rebuild: `scan` (search directory and ranking classes),
 * `histories`, `prune` (histories of names left with no results), `nat`,
 * `meets`, `reference`. Each works for at most
 * `STAGE_BUDGET_MS` and schedules its own continuation or the next stage, so
 * no action comes near the runtime limit; the last stage records the
 * versions read at the start as the refresh baseline and consumes the hints
 * pending then.
 */
export const rebuildStage = internalAction({
  args: rebuildStageArgs,
  handler: async (ctx, args): Promise<string> => {
    const startedAt = Date.now();
    const overBudget = () => Date.now() - startedAt > STAGE_BUDGET_MS;
    await ctx.runMutation(internal.views.setRebuilding, { rebuilding: true });
    const next = async (stage: typeof args.stage, offset: number, position: { after?: string; cursor?: string } = {}) => {
      await ctx.scheduler.runAfter(0, internal.views.rebuildStage, { ...args, stage, offset, after: position.after, cursor: position.cursor });
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
            await ctx.runMutation(internal.views.storeTextView, { key: SCAN_CLASSES_VIEW, chunks: jsonChunks([...classes]) });
            return await next('scan', 0, { cursor });
          }
        }
        const sortedNames = [...names].sort(compareCollated);
        await ctx.runMutation(internal.views.storeResultNames, { chunks: textChunks(directoryText(sortedNames)) });
        await rebuildSearchShards(ctx, sortedNames);
        await ctx.runMutation(internal.views.storeTextView, {
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
          await ctx.runAction(internal.views.buildNat, { federation, ageCategory });
        }
        return i < classes.length ? await next('nat', i) : await next('meets', 0);
      }
      case 'meets': {
        const meets: string[] = (await ctx.runQuery(internal.views.meetNames, {})).sort(compareBytes);
        let i = args.offset;
        for (; i < meets.length && !overBudget(); i += 1) await rebuildMeet(ctx, meets[i]);
        return i < meets.length ? await next('meets', i) : await next('reference', 0);
      }
      case 'reference': {
        await ctx.runMutation(internal.views.buildReferenceTables, {});
        await ctx.runAction(internal.views.buildClubs, {});
        await ctx.runMutation(internal.views.buildWso, {});
        await ctx.runMutation(internal.views.finishRefresh, {
          hints: args.hints,
          versions: args.versions,
          rebuilt: [],
          restamp: false,
        });
        // Also every hint updated before the rebuild began, not just the ones
        // it read: a backlog over MAX_REFRESH_HINTS would otherwise take one
        // full rebuild per MAX_REFRESH_HINTS hints to clear.
        if (args.startedAt !== undefined) {
          while ((await ctx.runMutation(internal.views.deleteHintsUpdatedBefore, { before: args.startedAt })) === HINT_DELETE_BATCH) {
            // next batch
          }
        }
        await ctx.runMutation(internal.views.setRebuilding, { rebuilding: false });
        // Now, not through the queued probe (up to REBUILD_WAIT_MS away): the
        // writes that arrived during the rebuild are applied at once. The
        // probe then finds nothing left to do.
        if (args.again) await ctx.scheduler.runAfter(0, internal.views.refresh, {});
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

async function startRebuild(ctx: ActionCtx, begin: RefreshBegin, again: boolean, restarted = false): Promise<void> {
  const startedAt = Date.now() - REBUILD_HINT_MARGIN_MS;
  await ctx.runMutation(internal.views.setRebuilding, { rebuilding: true, restarted });
  // The probe that notices if a stage fails (see `refresh`).
  await ctx.runMutation(internal.views.queueRefresh, { delayMs: REBUILD_WAIT_MS });
  await ctx.scheduler.runAfter(0, internal.views.rebuildStage, {
    stage: 'scan',
    offset: 0,
    hints: begin.hints.map(({ id, seq }) => ({ id, seq })),
    versions: begin.versions,
    again,
    startedAt,
  });
}

/**
 * Rebuilds every view and history document, in stages (`rebuildStage`); run
 * after a bulk load. Returns once the first stage is scheduled; ordinary
 * writes are handled by `refresh`.
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
      await startRebuild(ctx, begin, false);
      return 'scheduled';
    } finally {
      if (begin.lease !== null) await ctx.runMutation(internal.views.releaseRefresh, { lease: begin.lease });
    }
  },
});

/**
 * Rebuilds the views the pending writes can have changed and restamps the
 * rest.
 *
 * Hint kinds (written by `ingest.recordWrite`):
 * - `nat` `fed|age`: a result in that ranking class changed.
 * - `meet` name: a roster, schedule or result row of that meet changed.
 * - `athlete` folded name: that athlete's results changed (their bests, PR
 *   baseline and timeline, in every meet whose roster lists them).
 * - `table` name: a reference table, or `athletes` (the club list), changed.
 * - `adaptive`: an adaptive result changed.
 * - `name` raw name: a result row carries this name (search directory).
 */
export const refresh = internalAction({
  args: {},
  handler: async (ctx): Promise<Record<string, number>> => await runRefresh(ctx),
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
    return { oldestHintAt: oldest.length ? Math.min(...oldest) : null, rebuildRestarts: state?.rebuildRestarts ?? 0 };
  },
});

/**
 * The hourly `views-refresh` job (`cronJobs.ts`): runs a refresh whether or
 * not one is scheduled, so views catch up even when a refresh failed or was
 * lost with nothing written since, then fails (and so emails an alert) when
 * writes have been waiting for hours or the full rebuild keeps stopping.
 */
export const refreshJob = internalAction({
  args: {},
  handler: async (ctx): Promise<Record<string, number>> => {
    const result = await runRefresh(ctx);
    const health: { oldestHintAt: number | null; rebuildRestarts: number } = await ctx.runQuery(internal.views.refreshHealth, {});
    const problems: string[] = [];
    if (health.oldestHintAt !== null && Date.now() - health.oldestHintAt > HINT_BACKLOG_ALERT_MS) {
      problems.push(`a write has waited ${Math.round((Date.now() - health.oldestHintAt) / 60_000)} minutes for its views to refresh`);
    }
    if (health.rebuildRestarts >= REBUILD_RESTART_ALERT) {
      problems.push(`the full rebuild has stopped and been restarted ${health.rebuildRestarts} times`);
    }
    if (problems.length) throw new Error(`views are behind: ${problems.join('; ')} (see the Convex logs for views:refresh and views:rebuildStage)`);
    return result;
  },
});

async function runRefresh(ctx: ActionCtx): Promise<Record<string, number>> {
  const begin: RefreshBegin = await ctx.runMutation(internal.views.beginRefresh, { lease: true });
  if (begin.busy) return { busy: 1 };
  try {
    return await refreshWith(ctx, begin);
  } finally {
    if (begin.lease !== null) await ctx.runMutation(internal.views.releaseRefresh, { lease: begin.lease });
  }
}

async function refreshWith(ctx: ActionCtx, begin: RefreshBegin): Promise<Record<string, number>> {
  const moved =
    begin.baseline === null ||
    begin.versions.some((v) => v.version !== (begin.baseline!.find((b) => b.table === v.table)?.version ?? 0));
  // Checked before the no-change return: a rebuild whose stage failed
  // must be restarted even when nothing else was written.
  const rebuildAlive = begin.rebuildHeartbeat !== null && Date.now() - begin.rebuildHeartbeat < REBUILD_STALE_MS;
  if (begin.rebuilding && rebuildAlive) {
    // Keeps checking until the rebuild ends (and refreshes after it).
    await ctx.runMutation(internal.views.queueRefresh, { delayMs: REBUILD_WAIT_MS });
    return { waiting: 1 };
  }
  if (begin.rebuilding) {
    console.error(`views: the full rebuild stopped (last stage began ${begin.rebuildHeartbeat === null ? 'never' : new Date(begin.rebuildHeartbeat).toISOString()}); starting it again`);
    await startRebuild(ctx, begin, true, true);
    return { restarted: 1 };
  }
  if (begin.hints.length === 0 && !moved) return { hints: 0 };
  if (begin.overflow || begin.baseline === null) {
    // Too many changes to target (or no baseline yet): rebuild everything,
    // then refresh again for whatever arrived meanwhile.
    await startRebuild(ctx, begin, true);
    return { full: 1 };
  }

  const byKind = (kind: string) => [...new Set(begin.hints.filter((h) => h.kind === kind).map((h) => h.key))];
  const rebuilt: string[] = [];

  for (const entry of byKind('nat')) {
    const [federation, ageCategory] = JSON.parse(entry) as [string, string];
    await ctx.runAction(internal.views.buildNat, { federation, ageCategory });
    rebuilt.push(natKey(federation, ageCategory));
  }

  const athleteKeys = new Set(byKind('athlete'));
  const hintedMeets = byKind('meet');
  const knownMeets: string[] = hintedMeets.length > 0 || athleteKeys.size > 0 ? await ctx.runQuery(internal.views.meetNames, {}) : [];
  // A meet with results but neither a meet row nor a roster (most of what the
  // nightly results sync writes) has nothing for its views to hold; building
  // them would only leave six empty views per such meet, every one restamped
  // on every refresh. Its answers are computed live instead.
  const known = new Set(knownMeets);
  const meetsFull = new Set(hintedMeets.filter((meet) => known.has(meet)));
  const unlisted = hintedMeets.filter((meet) => !known.has(meet));
  for (let i = 0; i < unlisted.length; i += 50) {
    await ctx.runMutation(internal.views.deleteMeetViews, { meets: unlisted.slice(i, i + 50) });
  }
  const meetsHistory = new Set<string>();
  if (athleteKeys.size > 0) {
    const meets = knownMeets.filter((meet) => !meetsFull.has(meet));
    const keys = [...athleteKeys];
    for (let i = 0; i < meets.length; i += MEETS_PER_KEY_CHECK) {
      const listing: string[] = await ctx.runQuery(internal.views.meetsListingAny, { meets: meets.slice(i, i + MEETS_PER_KEY_CHECK), keys });
      for (const meet of listing) meetsHistory.add(meet);
    }
  }
  for (const meet of meetsFull) {
    await rebuildMeet(ctx, meet);
    for (const part of MEET_VIEW_PARTS) rebuilt.push(meetKey(meet, part));
    const sessionKeys: string[] = await ctx.runQuery(internal.views.viewKeysWithPrefix, { prefix: meetSessionPrefix(meet) });
    rebuilt.push(...sessionKeys);
  }
  for (const meet of meetsHistory) {
    await ctx.runMutation(internal.views.buildMeetTimelines, { meet });
    await buildStats(ctx, meet);
    rebuilt.push(meetKey(meet, 'timelines'), meetKey(meet, 'stats'));
  }

  const tables = new Set(byKind('table'));
  const refTables = ['records', 'standards', 'qualifying_totals', 'intl_rankings'];
  if (refTables.some((t) => tables.has(t)) || byKind('adaptive').length > 0) {
    await ctx.runMutation(internal.views.buildReferenceTables, {});
    rebuilt.push(REF_VIEWS.records, REF_VIEWS.standards, REF_VIEWS.qualifying_totals, REF_VIEWS.intl_rankings);
    for (const { gender, excludeFederation } of ADAPTIVE_VIEW_ARGS) {
      rebuilt.push(adaptiveKey(gender, excludeFederation, ADAPTIVE_RECORDS_SEASON_START));
    }
  }
  if (tables.has('athletes')) {
    await ctx.runAction(internal.views.buildClubs, {});
    rebuilt.push(REF_VIEWS.clubs);
  }
  if (tables.has('wso_records')) {
    await ctx.runMutation(internal.views.buildWso, {});
    const keys: string[] = await ctx.runQuery(internal.views.viewKeys, {});
    rebuilt.push(...keys.filter((k) => k === REF_VIEWS.wso_list || k.startsWith('wso|')));
  }

  const names = byKind('name');
  // Each name costs a lookup or two; 500 a batch stays well inside a
  // mutation's read limit.
  for (let i = 0; i < names.length; i += 500) {
    await ctx.runMutation(internal.views.syncResultNames, { names: names.slice(i, i + 500) });
  }
  await applyPendingShardChanges(ctx);

  const restamped: number = await ctx.runMutation(internal.views.finishRefresh, {
    hints: begin.hints.map(({ id, seq }) => ({ id, seq })),
    versions: begin.versions,
    rebuilt,
    restamp: true,
  });
  return { hints: begin.hints.length, rebuilt: rebuilt.length, restamped };
}
