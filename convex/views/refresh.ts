import { syncMeetNames } from '../meetNames';
import { isStringList, isTextPair, parsedAs } from '../lib/json';
import { chunks } from '../lib/concurrency';
import { v } from 'convex/values';
import { internalAction, internalMutation, internalQuery, type ActionCtx, type MutationCtx, type QueryCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { compareBytes } from '../lib/sort';
import { athleteChangeAffects, earliestSince, meetKey, natKey, SEARCH_SHARD_SIZES_VIEW } from '../lib/viewKeys';
import { readViewJsonAnyAge, viewHeader } from '../lib/views';
import { buildStats } from './builders';
import { loadMeetIndex } from './meetIndex';
import { rebuildMeet, startRebuild } from './rebuild';
import { applyPendingShardChanges } from './searchDirectory';
import { HINT_DELETE_BATCH, type Hint, REBUILD_STAGES, REBUILD_STALE_MS, REBUILD_WAIT_MS, REFRESH_BUSY_RETRY_MS, type RebuildPosition, type RefreshBegin, STAGE_BUDGET_MS } from './shared';

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

const RESULT_NAMES_SYNC_BATCH = 500;

/** Meets checked per `meetsWithViews` query (two index seeks each at most). */
const MEETS_PER_EXISTENCE_CHECK = 200;

/**
 * A refresh holds the lease for at most this long: longer than an action can
 * run, so a refresh that died without releasing it is taken over after this.
 */
const REFRESH_LEASE_MS = 11 * 60 * 1000;

export async function refreshState(ctx: QueryCtx) {
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
      lastRead: rows[rows.length - 1]?._creationTime ?? null,
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
        const roster = parsedAs((await readViewJsonAnyAge(ctx, meetKey(meet, 'keys'))) ?? '[]', isStringList, `the roster keys of ${meet}`);
        const matched = roster.filter((key) => wanted.has(key));
        if (matched.length === 0) return null;
        const stats = await viewHeader(ctx, meetKey(meet, 'stats'));
        return { meet, keys: matched, statsMeta: stats?.meta ?? null };
      }),
    );
    return listed.filter((listing): listing is RosterListing => listing !== null);
  },
});

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
  for (const batch of chunks(hints, HINT_DELETE_BATCH)) {
    deleted += await ctx.runMutation(internal.views.deleteHints, { hints: batch.map(({ id, seq }) => ({ id, seq })) });
  }
  return deleted;
}

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
    const [federation, ageCategory] = parsedAs(hint.key, isTextPair, 'a national ranking hint');
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
    const meetNamesSynced = await build('meet name index', () => syncMeetNames(ctx, hinted));
    await done(meetHints.filter((h) => meetNamesSynced && covered.has(h.key)));
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
      for (const batch of chunks(names, RESULT_NAMES_SYNC_BATCH)) {
        await ctx.runMutation(internal.views.syncResultNames, { names: batch });
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
