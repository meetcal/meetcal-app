import { chunks } from '../lib/concurrency';
import { v } from 'convex/values';
import { internalAction, internalMutation, internalQuery, type ActionCtx, type MutationCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { normalizeName } from '../lib/names';
import { compareCollated } from '../lib/sort';
import { RESULT_NAMES_VIEW, SEARCH_SHARD_PREFIX, SEARCH_SHARD_SIZES_VIEW, LEGACY_SEARCH_SHARD_SIZES_VIEWS, searchShardKey } from '../lib/viewKeys';
import { deleteView, deleteViewsWithPrefix, jsonChunks, readViewJsonAnyAge, readViewTextAnyAge, textChunks, writeView } from '../lib/views';
import { directoryNames, directoryText, nameBigrams, shardDirectory } from '../lib/directory';

const STALE_SHARD_DELETE_BATCH = 200;

const SHARD_PATCH_BATCH = 20;

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
export async function rebuildSearchShards(ctx: ActionCtx, sortedNames: readonly string[]): Promise<void> {
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
  for (const keys of chunks(stale, STALE_SHARD_DELETE_BATCH)) await ctx.runMutation(internal.views.deleteSearchShards, { keys });
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
export async function applyPendingShardChanges(ctx: ActionCtx): Promise<void> {
  for (;;) {
    const pending: { id: Id<'search_shard_pending'>; name: string; present: boolean }[] = await ctx.runQuery(internal.views.pendingShardChanges, {});
    if (pending.length === 0) return;
    const added = pending.filter((p) => p.present).map((p) => p.name);
    const removed = pending.filter((p) => !p.present).map((p) => p.name);
    const bigrams = new Set<string>();
    for (const { name } of pending) for (const bigram of nameBigrams(name)) bigrams.add(bigram);
    const list = [...bigrams];
    for (const batch of chunks(list, SHARD_PATCH_BATCH)) {
      await ctx.runMutation(internal.views.patchSearchShards, { bigrams: batch, added, removed });
    }
    await ctx.runMutation(internal.views.clearPendingShardChanges, { applied: pending.map(({ id, present }) => ({ id, present })) });
    if (pending.length < 500) return;
  }
}
