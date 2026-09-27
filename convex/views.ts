import { v } from 'convex/values';
import { internalAction, internalMutation, internalQuery, type ActionCtx, type MutationCtx, type QueryCtx } from './_generated/server';
import { internal } from './_generated/api';
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
  toApiMeet,
  type TimelinesView,
} from './lib/meetData';
import { HISTORY_READY, writeHistories } from './lib/history';
import { normalizeName } from './lib/names';
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
  VIEW_SOURCES,
  wsoKey,
} from './lib/viewKeys';
import {
  deleteViewsWithPrefix,
  jsonChunks,
  readViewTextAnyAge,
  snapshotVersions,
  SOURCE_TABLES,
  textChunks,
  writeView,
  type SourceTable,
  type SourceVersion,
  viewKeysWithPrefix as keysWithPrefix,
} from './lib/views';
import { directoryNames, directoryText } from './lib/directory';

// Builders and refresh for the views in `lib/viewKeys.ts`. Every builder is a
// mutation that reads its source versions first and its rows second, in one
// transaction, so the stamp it writes is exactly the data it read.

/** Rows per page when an action walks `lifting_results`. */
const PAGE_SIZE = 8000;
/** Timelines keep this many years of results; year bests look back one. */
const TIMELINE_YEARS = 3;
/** Refresh runs this long after the first write of a burst. */
const REFRESH_DELAY_MS = 5000;
/** More pending hints than this and a refresh rebuilds everything. */
const MAX_TARGETED_HINTS = 2000;
/** A refresh that finds a full rebuild running tries again after this. */
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

export const buildNat = internalMutation({
  args: { federation: v.string(), ageCategory: v.string() },
  handler: async (ctx, { federation, ageCategory }) => {
    const sources = await snapshotVersions(ctx, VIEW_SOURCES.nat);
    const rows = await computeNationalRankings(ctx, federation, ageCategory);
    await writeView(ctx, natKey(federation, ageCategory), jsonChunks(rows), sources);
    return rows.length;
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
 */
export const buildMeetStats = internalMutation({
  args: { meet: v.string() },
  handler: async (ctx, { meet }) => {
    const sources = await snapshotVersions(ctx, VIEW_SOURCES.meetStats);
    const rows = await computeStatsRows(ctx, meet);
    const roster = await ctx.db
      .query('athletes')
      .withIndex('by_meet', (q) => q.eq('meet', meet))
      .collect();
    await writeView(ctx, meetKey(meet, 'stats'), jsonChunks([{ rows, club_counts: clubAthleteCounts(roster) }]), sources);
    return rows.length;
  },
});

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

export const buildClubs = internalMutation({
  args: {},
  handler: async (ctx) => {
    await writeComputed(ctx, REF_VIEWS.clubs, VIEW_SOURCES.clubs, () => computeClubs(ctx));
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
    let added = 0;
    let removed = 0;
    for (const name of new Set(names)) {
      const hasResult =
        (await ctx.db
          .query('lifting_results')
          .withIndex('by_nameKey_and_date', (q) => q.eq('nameKey', normalizeName(name)))
          .filter((q) => q.eq(q.field('name'), name))
          .first()) !== null;
      if (hasResult && !directory.has(name)) {
        directory.add(name);
        added += 1;
      } else if (!hasResult && directory.delete(name)) {
        removed += 1;
      }
    }
    if (added + removed === 0) return { added, removed };
    await writeView(ctx, RESULT_NAMES_VIEW, textChunks(directoryText([...directory].sort(compareCollated))), [], { text: true });
    return { added, removed };
  },
});

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
    // Rosters can arrive before their meet row; their start lists still resolve.
    for (const athlete of await ctx.db.query('athletes').collect()) names.add(athlete.meet);
    return [...names];
  },
});

/** Rebuilds only the search directory (a full scan of `lifting_results`). */
export const rebuildDirectory = internalAction({
  args: {},
  handler: async (ctx): Promise<number> => {
    const names = new Set<string>();
    let cursor: string | null = null;
    for (;;) {
      const page: { names: string[]; cursor: string; isDone: boolean } = await ctx.runQuery(internal.views.scanResultsPage, {
        cursor,
      });
      page.names.forEach((n) => names.add(n));
      if (page.isDone) break;
      cursor = page.cursor;
    }
    await ctx.runMutation(internal.views.storeResultNames, {
      chunks: textChunks(directoryText([...names].sort(compareCollated))),
    });
    return names.size;
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
  await ctx.runMutation(internal.views.buildMeetStats, { meet });
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
};

async function refreshState(ctx: QueryCtx) {
  return await ctx.db
    .query('view_state')
    .withIndex('by_name', (q) => q.eq('name', 'refresh'))
    .unique();
}

/** Schedules a refresh unless one is already waiting (called by every write). */
export async function scheduleRefresh(ctx: MutationCtx): Promise<void> {
  const state = await refreshState(ctx);
  if (state?.scheduled) return;
  await ctx.scheduler.runAfter(REFRESH_DELAY_MS, internal.views.refresh, {});
  if (state) await ctx.db.patch(state._id, { scheduled: true });
  else await ctx.db.insert('view_state', { name: 'refresh', scheduled: true, baseline: [] });
}

/**
 * Starts a refresh: clears the "scheduled" flag (so writes from here on
 * schedule another run), and returns the pending hints, the versions now
 * (`versions`, what untouched views are restamped to) and the versions of the
 * last completed refresh (`baseline`: every write since then left a hint).
 */
export const beginRefresh = internalMutation({
  args: {},
  handler: async (ctx): Promise<RefreshBegin> => {
    const state = await refreshState(ctx);
    if (state) await ctx.db.patch(state._id, { scheduled: false });
    const rows = await ctx.db.query('view_hints').take(MAX_TARGETED_HINTS + 1);
    const versions = await snapshotVersions(ctx, SOURCE_TABLES);
    return {
      hints: rows.slice(0, MAX_TARGETED_HINTS).map((h) => ({ id: h._id, kind: h.kind, key: h.key, seq: h.seq ?? 0 })),
      overflow: rows.length > MAX_TARGETED_HINTS,
      versions,
      baseline: state && state.baseline.length > 0 ? state.baseline : null,
      rebuilding: state?.rebuilding ?? false,
      rebuildHeartbeat: state?.rebuildHeartbeat ?? null,
    };
  },
});

export const viewKeys = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query('views').collect()).map((h) => h.key),
});

export const meetKeysView = internalQuery({
  args: { meet: v.string() },
  handler: async (ctx, { meet }) => JSON.parse((await readViewTextAnyAge(ctx, meetKey(meet, 'keys'))) ?? '[]') as string[],
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
    const handled = new Map(hints.map((h) => [h.id, h.seq]));
    for (const hint of await ctx.db.query('view_hints').collect()) {
      if (handled.get(hint._id) === (hint.seq ?? 0)) await ctx.db.delete(hint._id);
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

const sourceVersion = v.object({ table: v.string(), version: v.number() });
const rebuildStageArgs = {
  stage: v.union(v.literal('scan'), v.literal('histories'), v.literal('nat'), v.literal('meets'), v.literal('reference')),
  offset: v.number(),
  hints: v.array(v.object({ id: v.string(), seq: v.number() })),
  versions: v.array(sourceVersion),
  again: v.boolean(),
};

export const storeTextView = internalMutation({
  args: { key: v.string(), chunks: v.array(v.string()) },
  handler: async (ctx, { key, chunks }) => {
    await writeView(ctx, key, chunks, []);
  },
});

export const textViewAnyAge = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => await readViewTextAnyAge(ctx, key),
});

/** Marks a rebuild running (and beats its heartbeat) or finished. Each stage calls it with `true` as it starts. */
export const setRebuilding = internalMutation({
  args: { rebuilding: v.boolean() },
  handler: async (ctx, { rebuilding }) => {
    const state = await refreshState(ctx);
    const fields = { rebuilding, rebuildHeartbeat: rebuilding ? Date.now() : undefined };
    if (state) await ctx.db.patch(state._id, fields);
    else await ctx.db.insert('view_state', { name: 'refresh', scheduled: false, baseline: [], ...fields });
  },
});

/**
 * One stage of a full rebuild: `scan` (search directory and ranking classes),
 * `histories`, `nat`, `meets`, `reference`. Each works for at most
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
    const next = async (stage: typeof args.stage, offset: number) => {
      await ctx.scheduler.runAfter(0, internal.views.rebuildStage, { ...args, stage, offset });
      return `${args.stage} -> ${stage}@${offset}`;
    };

    switch (args.stage) {
      case 'scan': {
        const names = new Set<string>();
        const classes = new Set<string>();
        let cursor: string | null = null;
        for (;;) {
          const page: { names: string[]; classes: string[]; cursor: string; isDone: boolean } = await ctx.runQuery(
            internal.views.scanResultsPage,
            { cursor },
          );
          page.names.forEach((n) => names.add(n));
          page.classes.forEach((c) => classes.add(c));
          if (page.isDone) break;
          cursor = page.cursor;
        }
        await ctx.runMutation(internal.views.storeResultNames, {
          chunks: textChunks(directoryText([...names].sort(compareCollated))),
        });
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
        return await next('nat', 0);
      }
      case 'nat': {
        const text: string | null = await ctx.runQuery(internal.views.textViewAnyAge, { key: REBUILD_CLASSES_VIEW });
        const classes = JSON.parse(text ?? '[]') as string[];
        let i = args.offset;
        for (; i < classes.length && !overBudget(); i += 1) {
          const [federation, ageCategory] = JSON.parse(classes[i]) as [string, string];
          await ctx.runMutation(internal.views.buildNat, { federation, ageCategory });
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
        await ctx.runMutation(internal.views.buildClubs, {});
        await ctx.runMutation(internal.views.buildWso, {});
        await ctx.runMutation(internal.views.finishRefresh, {
          hints: args.hints,
          versions: args.versions,
          rebuilt: [],
          restamp: false,
        });
        await ctx.runMutation(internal.views.setRebuilding, { rebuilding: false });
        if (args.again) await ctx.scheduler.runAfter(0, internal.views.refresh, {});
        return 'done';
      }
    }
  },
});

async function startRebuild(ctx: ActionCtx, begin: RefreshBegin, again: boolean): Promise<void> {
  await ctx.runMutation(internal.views.setRebuilding, { rebuilding: true });
  await ctx.scheduler.runAfter(0, internal.views.rebuildStage, {
    stage: 'scan',
    offset: 0,
    hints: begin.hints.map(({ id, seq }) => ({ id, seq })),
    versions: begin.versions,
    again,
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
    const begin: RefreshBegin = await ctx.runMutation(internal.views.beginRefresh, {});
    await startRebuild(ctx, begin, false);
    return 'scheduled';
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
  handler: async (ctx): Promise<Record<string, number>> => {
    const begin: RefreshBegin = await ctx.runMutation(internal.views.beginRefresh, {});
    const moved =
      begin.baseline === null ||
      begin.versions.some((v) => v.version !== (begin.baseline!.find((b) => b.table === v.table)?.version ?? 0));
    if (begin.hints.length === 0 && !moved) return { hints: 0 };
    const rebuildAlive = begin.rebuildHeartbeat !== null && Date.now() - begin.rebuildHeartbeat < REBUILD_STALE_MS;
    if (begin.rebuilding && rebuildAlive) {
      // A full rebuild is running and will refresh again when it ends.
      await ctx.scheduler.runAfter(REBUILD_WAIT_MS, internal.views.refresh, {});
      return { waiting: 1 };
    }
    if (begin.rebuilding) {
      console.error(`views: the full rebuild stopped (last stage began ${begin.rebuildHeartbeat === null ? 'never' : new Date(begin.rebuildHeartbeat).toISOString()}); starting it again`);
      await startRebuild(ctx, begin, true);
      return { restarted: 1 };
    }
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
      await ctx.runMutation(internal.views.buildNat, { federation, ageCategory });
      rebuilt.push(natKey(federation, ageCategory));
    }

    const meetsFull = new Set(byKind('meet'));
    const athleteKeys = new Set(byKind('athlete'));
    const meetsHistory = new Set<string>();
    if (athleteKeys.size > 0) {
      const meets: string[] = await ctx.runQuery(internal.views.meetNames, {});
      for (const meet of meets) {
        if (meetsFull.has(meet)) continue;
        const keys: string[] = await ctx.runQuery(internal.views.meetKeysView, { meet });
        if (keys.some((key) => athleteKeys.has(key))) meetsHistory.add(meet);
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
      await ctx.runMutation(internal.views.buildMeetStats, { meet });
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
      await ctx.runMutation(internal.views.buildClubs, {});
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

    const restamped: number = await ctx.runMutation(internal.views.finishRefresh, {
      hints: begin.hints.map(({ id, seq }) => ({ id, seq })),
      versions: begin.versions,
      rebuilt,
      restamp: true,
    });
    return { hints: begin.hints.length, rebuilt: rebuilt.length, restamped };
  },
});
