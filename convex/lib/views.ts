import type { Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { etagOf } from './etag';
import { athleteChangeAffects, meetKey, viewDependencies, type HintId, type ViewDependencies } from './viewKeys';

/**
 * Materialized views: an answer computed from many rows, stored ready to send
 * so a query reads a few documents instead of thousands (Convex charges per
 * document read; Postgres did not).
 *
 * Views hold JSON *text*, not Convex values. A query that passes a view
 * through (a ranking, a start list, a table) concatenates strings and never
 * builds the thousands of objects inside; one that narrows it runs V8's
 * native `JSON.parse`, far cheaper than materializing the same data as
 * document values. The app client parses the text once, as it parsed the Rust
 * API's response bodies. This is the Convex spelling of the Rust API's cached
 * response bytes.
 *
 * Freshness is tracked per key, by the pending changes themselves:
 *
 * - Every write to a source table goes through `recordWrite` (`convex/ingest.ts`),
 *   which leaves hints naming exactly what changed (a meet, a ranking class,
 *   an athlete, a reference table) in the write's own transaction.
 * - A view depends on the hints of what it reads (`viewDependencies` in
 *   `lib/viewKeys.ts`, from its key). `readFreshView` treats a view with any
 *   of them pending as a miss, so callers fall back to computing live: a view
 *   is never served past a write, only rebuilt some seconds later.
 * - The refresh deletes a hint only after rebuilding every view it names, and
 *   only if no write named it again meanwhile. So a write to one meet leaves
 *   every other meet's views fresh, and nothing has to restamp them.
 *
 * - A failed build keeps its hints, so only the views it names stay stale.
 *
 * Headers still record the source table versions their builder read
 * (`sources`); a header without them predates versioning and is never fresh.
 * They also carry the answer's tag (`etag`), computed once at build time, so
 * a client that already holds the current version is answered from the
 * header alone.
 */

/** Tables that views are built from. */
export const SOURCE_TABLES = [
  'meets',
  'session_schedule',
  'athletes',
  'lifting_results',
  'records',
  'standards',
  'qualifying_totals',
  'intl_rankings',
  'wso_records',
] as const;
export type SourceTable = (typeof SOURCE_TABLES)[number];

export type SourceVersion = { table: string; version: number };

/** A document holds at most 1 MiB; chunks stay well under it. */
const MAX_CHUNK_CHARS = 700 * 1024;

/**
 * `JSON.stringify(items)` split into chunks of at most `MAX_CHUNK_CHARS`,
 * each itself a JSON array; `joinJsonChunks` restores the exact text.
 */
export function jsonChunks(items: readonly unknown[]): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let chars = 2;
  for (const item of items) {
    const text = JSON.stringify(item) ?? 'null';
    if (current.length > 0 && chars + text.length + 1 > MAX_CHUNK_CHARS) {
      chunks.push(`[${current.join(',')}]`);
      current = [];
      chars = 2;
    }
    current.push(text);
    chars += text.length + 1;
  }
  chunks.push(`[${current.join(',')}]`);
  return chunks;
}

/** The single JSON array the chunks were cut from. */
export function joinJsonChunks(chunks: readonly string[]): string {
  if (chunks.length === 1) return chunks[0];
  const inner = chunks.map((chunk) => chunk.slice(1, -1)).filter((part) => part.length > 0);
  return `[${inner.join(',')}]`;
}

/** Plain text split into chunks, for views that are not JSON (the search directory). */
export function textChunks(text: string): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; ) {
    let end = Math.min(i + MAX_CHUNK_CHARS, text.length);
    // Never between the two halves of a surrogate pair: a lone half is not a
    // string Convex can store.
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
    chunks.push(text.slice(i, end));
    i = end;
  }
  return chunks.length > 0 ? chunks : [''];
}

async function versionOf(ctx: QueryCtx, table: string): Promise<number> {
  const row = await ctx.db
    .query('data_versions')
    .withIndex('by_table', (q) => q.eq('table', table))
    .unique();
  return row?.version ?? 0;
}

/** Current versions of `tables`, read in one transaction. */
export async function snapshotVersions(ctx: QueryCtx, tables: readonly SourceTable[]): Promise<SourceVersion[]> {
  return await Promise.all(tables.map(async (table) => ({ table, version: await versionOf(ctx, table) })));
}

/** Counts a write to `table`, for the stamps builders record (freshness itself is per key, by hints). */
export async function bumpVersion(ctx: MutationCtx, table: SourceTable): Promise<number> {
  const row = await ctx.db
    .query('data_versions')
    .withIndex('by_table', (q) => q.eq('table', table))
    .unique();
  const version = (row?.version ?? 0) + 1;
  if (row) await ctx.db.patch(row._id, { version });
  else await ctx.db.insert('data_versions', { table, version });
  return version;
}

export type FreshView<T> = {
  etag: string;
  meta: string | undefined;
  /** The view's JSON array, as text. */
  json: () => Promise<string>;
  /** The same, parsed. */
  items: () => Promise<T[]>;
  /** A text view's content (chunks joined as they are). */
  text: () => Promise<string>;
};

export async function viewHeader(ctx: QueryCtx, key: string) {
  return await ctx.db
    .query('views')
    .withIndex('by_key', (q) => q.eq('key', key))
    .unique();
}

async function readChunks(ctx: QueryCtx, key: string, chunkCount: number): Promise<string[]> {
  const chunks = await ctx.db
    .query('view_chunks')
    .withIndex('by_key_index', (q) => q.eq('key', key).lt('index', chunkCount))
    .collect();
  return chunks.map((chunk) => chunk.text);
}

function freshView<T>(ctx: QueryCtx, key: string, header: { etag: string; meta?: string; chunk_count: number }): FreshView<T> {
  let chunks: Promise<string[]> | null = null;
  const read = () => (chunks ??= readChunks(ctx, key, header.chunk_count));
  const json = async () => joinJsonChunks(await read());
  return {
    etag: header.etag,
    meta: header.meta,
    json,
    items: async () => JSON.parse(await json()) as T[],
    text: async () => (await read()).join(''),
  };
}

/**
 * Pending athlete hints a freshness check compares with a roster; with more
 * pending than this (a national meet's results just landed), every view that
 * reads roster athletes' results counts as stale until the refresh catches up.
 */
const MAX_ATHLETE_HINTS_CHECKED = 200;

async function hintPending(ctx: QueryCtx, { kind, key }: HintId): Promise<boolean> {
  const hint = await ctx.db
    .query('view_hints')
    .withIndex('by_kind_key', (q) => q.eq('kind', kind).eq('key', key))
    .first();
  return hint !== null;
}

/**
 * Whether a pending athlete hint can change a meet's timelines or stats view
 * (`meta` from its header): one range read when none is pending, as almost
 * always, and the meet's roster keys only when some are.
 */
async function rosterChangePending(
  ctx: QueryCtx,
  { meet, part }: NonNullable<ViewDependencies['roster']>,
  meta: string | undefined,
): Promise<boolean> {
  const pending = await ctx.db
    .query('view_hints')
    .withIndex('by_kind_key', (q) => q.eq('kind', 'athlete'))
    .take(MAX_ATHLETE_HINTS_CHECKED + 1);
  // Past the cap, the unread hints could be anyone's.
  if (pending.length > MAX_ATHLETE_HINTS_CHECKED) return true;
  const relevant = pending.filter((hint) => athleteChangeAffects(part, hint.since, meta));
  if (relevant.length === 0) return false;
  const roster = new Set(JSON.parse((await readViewJsonAnyAge(ctx, meetKey(meet, 'keys'))) ?? '[]') as string[]);
  return relevant.some((hint) => roster.has(hint.key));
}

/**
 * The view if it exists and no change to what it reads is pending (see the
 * top of this file); null otherwise (the caller computes the answer live).
 * Chunks are read only when asked for, so a caller whose client holds `etag`
 * reads the header and a hint lookup or two alone.
 */
export async function readFreshView<T>(ctx: QueryCtx, key: string): Promise<FreshView<T> | null> {
  const dependencies = viewDependencies(key);
  if (dependencies === null) return null;
  const [header, pending] = await Promise.all([
    viewHeader(ctx, key),
    Promise.all(dependencies.hints.map((hint) => hintPending(ctx, hint))),
  ]);
  if (!header?.sources || pending.some(Boolean)) return null;
  if (dependencies.roster && (await rosterChangePending(ctx, dependencies.roster, header.meta))) return null;
  return freshView<T>(ctx, key, header);
}

/**
 * The view whatever its age, or null if it was never built. For answers
 * where the last complete build beats computing live (national rankings and
 * the club list, whose live computations are more than one query may read).
 */
export async function readViewAnyAge<T>(ctx: QueryCtx, key: string): Promise<FreshView<T> | null> {
  const header = await viewHeader(ctx, key);
  return header ? freshView<T>(ctx, key, header) : null;
}

/**
 * A JSON view's text whatever its age (its chunks joined back into one
 * array), or null if it was never built. For views written with `jsonChunks`
 * whose staleness is harmless by design (the shard size table, a meet's
 * athlete keys, the rebuild's class list).
 */
export async function readViewJsonAnyAge(ctx: QueryCtx, key: string): Promise<string | null> {
  const header = await viewHeader(ctx, key);
  return header ? joinJsonChunks(await readChunks(ctx, key, header.chunk_count)) : null;
}

/**
 * A text view's raw text whatever its age, or null if it was never built.
 * Only for views whose staleness is harmless by design (the search directory
 * and its shards); JSON views go through `readViewJsonAnyAge`.
 */
export async function readViewTextAnyAge(ctx: QueryCtx, key: string): Promise<string | null> {
  const header = await viewHeader(ctx, key);
  return header ? (await readChunks(ctx, key, header.chunk_count)).join('') : null;
}

/**
 * Replaces a view atomically (chunks and header in one mutation), stamped with
 * `sources`: the versions its builder read before reading any rows. `chunks`
 * come from `jsonChunks` (or `textChunks` for a text view); the tag is that
 * of the whole text, which for a JSON view is exactly the tag `revalidated`
 * gives the same answer computed live.
 */
export async function writeView(
  ctx: MutationCtx,
  key: string,
  chunks: readonly string[],
  sources: readonly SourceVersion[],
  options: { meta?: string; text?: boolean } = {},
): Promise<{ etag: string; chunk_count: number }> {
  const whole = options.text ? chunks.join('') : joinJsonChunks(chunks);
  const etag = etagOf(whole);
  const existing = await viewHeader(ctx, key);
  const header = {
    key,
    etag,
    chunk_count: chunks.length,
    built_at: Date.now(),
    sources: [...sources],
    meta: options.meta,
  };
  if (existing && existing.etag === etag && existing.meta === options.meta && existing.chunk_count === chunks.length) {
    // Same content: only the stamp moves.
    await ctx.db.patch(existing._id, { sources: header.sources, built_at: header.built_at });
    return header;
  }
  const oldChunks = await ctx.db
    .query('view_chunks')
    .withIndex('by_key_index', (q) => q.eq('key', key))
    .collect();
  await Promise.all(oldChunks.map((chunk) => ctx.db.delete(chunk._id)));
  await Promise.all(chunks.map((text, index) => ctx.db.insert('view_chunks', { key, index, text })));
  if (existing) await ctx.db.replace(existing._id, header);
  else await ctx.db.insert('views', header);
  return header;
}

export async function deleteHeaderAndChunks(ctx: MutationCtx, header: { _id: Id<'views'>; key: string }): Promise<void> {
  const chunks = await ctx.db
    .query('view_chunks')
    .withIndex('by_key_index', (q) => q.eq('key', header.key))
    .collect();
  for (const chunk of chunks) await ctx.db.delete(chunk._id);
  await ctx.db.delete(header._id);
}

/** Deletes every view whose key starts with `prefix` (headers and chunks). */
export async function deleteViewsWithPrefix(ctx: MutationCtx, prefix: string): Promise<number> {
  const headers = await ctx.db
    .query('views')
    .withIndex('by_key', (q) => q.gte('key', prefix).lt('key', `${prefix}\uffff`))
    .collect();
  for (const header of headers) await deleteHeaderAndChunks(ctx, header);
  return headers.length;
}

/** Deletes the view with exactly this key, if there is one; never one it is a prefix of. */
export async function deleteView(ctx: MutationCtx, key: string): Promise<boolean> {
  const header = await viewHeader(ctx, key);
  if (header) await deleteHeaderAndChunks(ctx, header);
  return header !== null;
}

/** Keys of every view whose key starts with `prefix`. */
export async function viewKeysWithPrefix(ctx: QueryCtx, prefix: string): Promise<string[]> {
  const headers = await ctx.db
    .query('views')
    .withIndex('by_key', (q) => q.gte('key', prefix).lt('key', `${prefix}\uffff`))
    .collect();
  return headers.map((h) => h.key);
}
