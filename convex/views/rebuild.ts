import { chunks } from '../lib/concurrency';
import { v } from 'convex/values';
import { internalAction, internalMutation, internalQuery, type ActionCtx, type QueryCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { HISTORY_READY, writeHistories } from '../lib/history';
import { normalizeName } from '../lib/names';
import { compareBytes, compareCollated } from '../lib/sort';
import { INTERNAL_VIEW_PREFIXES, natKey, RESULT_NAMES_VIEW, viewDependencies } from '../lib/viewKeys';
import { deleteHeaderAndChunks, jsonChunks, readViewJsonAnyAge, readViewTextAnyAge, textChunks, writeView } from '../lib/views';
import { directoryNames, directoryText } from '../lib/directory';
import { buildStats } from './builders';
import { discoverMeets, loadMeetIndex } from './meetIndex';
import { refreshState, scheduleRefresh } from './refresh';
import { rebuildSearchShards } from './searchDirectory';
import { HINT_DELETE_BATCH, REBUILD_STAGES, REBUILD_STALE_MS, REBUILD_WAIT_MS, REFRESH_BUSY_RETRY_MS, type RebuildPosition, type RebuildStage, type RefreshBegin, STAGE_BUDGET_MS } from './shared';

/** Rows per page when an action walks `lifting_results`. */
const PAGE_SIZE = 8000;

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

export async function rebuildMeet(ctx: ActionCtx, meet: string): Promise<void> {
  await ctx.runMutation(internal.views.buildMeet, { meet });
  await ctx.runMutation(internal.views.buildMeetTimelines, { meet });
  await buildStats(ctx, meet);
}

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

export const rebuildPosition = v.object({
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
          for (const batch of chunks(orphans, HISTORY_BATCH)) {
            await ctx.runMutation(internal.views.buildHistories, { keys: batch });
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
          for (const batch of chunks(args.hints, HINT_DELETE_BATCH)) {
            await ctx.runMutation(internal.views.deleteHints, { hints: batch });
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
export async function startRebuild(ctx: ActionCtx, options: { again: boolean; restarted?: boolean; from?: RebuildPosition | null }): Promise<void> {
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
