import type { MutationCtx, QueryCtx } from '../_generated/server';
import { etagOf } from './etag';

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
 * Correctness rests on version stamps, not on remembering to invalidate:
 *
 * - Every write to a source table goes through `recordWrite` (`convex/ingest.ts`),
 *   which bumps that table's row in `data_versions`.
 * - A view's header records the version of each source table it was built
 *   from. `readFreshView` compares them with the current versions and treats
 *   any difference as a miss, so callers fall back to computing live. A view
 *   is therefore never served past a write, only rebuilt some seconds later.
 * - Builders stamp the versions they read before reading any rows, in the
 *   same transaction, so a stamp always describes exactly the data read.
 *
 * Headers also carry the answer's tag (`etag`), computed once at build time,
 * so a client that already holds the current version is answered from the
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
  for (let i = 0; i < text.length; i += MAX_CHUNK_CHARS) chunks.push(text.slice(i, i + MAX_CHUNK_CHARS));
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

/** Marks `table` as changed; every view built from it becomes stale. */
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

async function viewHeader(ctx: QueryCtx, key: string) {
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
 * The view if it exists and no source table has changed since it was built;
 * null otherwise (the caller computes the answer live). Chunks are read only
 * when asked for, so a caller whose client holds `etag` reads the header and
 * the version rows alone.
 */
export async function readFreshView<T>(ctx: QueryCtx, key: string): Promise<FreshView<T> | null> {
  // The header and every version row in parallel: `data_versions` is a
  // handful of rows, one range read.
  const [header, versions] = await Promise.all([viewHeader(ctx, key), ctx.db.query('data_versions').collect()]);
  if (!header?.sources) return null;
  const current = new Map(versions.map((row) => [row.table, row.version]));
  if (header.sources.some((s) => s.version !== (current.get(s.table) ?? 0))) return null;
  return freshView<T>(ctx, key, header);
}

/**
 * A view's raw text whatever its age, or null if it was never built. Only for
 * views whose staleness is harmless by design (the search directory).
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

/**
 * Moves the stamp of views whose content the writes since their build cannot
 * have changed (the refresh decided so from the write hints) up to `sources`.
 */
export async function restampViews(
  ctx: MutationCtx,
  keys: readonly string[],
  sources: readonly SourceVersion[],
): Promise<number> {
  let restamped = 0;
  for (const key of keys) {
    const header = await viewHeader(ctx, key);
    if (!header?.sources) continue;
    const stamped = header.sources.map((s) => {
      const next = sources.find((n) => n.table === s.table);
      return next && next.version > s.version ? next : s;
    });
    await ctx.db.patch(header._id, { sources: stamped });
    restamped += 1;
  }
  return restamped;
}

/** Deletes every view whose key starts with `prefix` (headers and chunks). */
export async function deleteViewsWithPrefix(ctx: MutationCtx, prefix: string): Promise<number> {
  const headers = await ctx.db
    .query('views')
    .withIndex('by_key', (q) => q.gte('key', prefix).lt('key', `${prefix}\uffff`))
    .collect();
  for (const header of headers) {
    const chunks = await ctx.db
      .query('view_chunks')
      .withIndex('by_key_index', (q) => q.eq('key', header.key))
      .collect();
    for (const chunk of chunks) await ctx.db.delete(chunk._id);
    await ctx.db.delete(header._id);
  }
  return headers.length;
}

/** Keys of every view whose key starts with `prefix`. */
export async function viewKeysWithPrefix(ctx: QueryCtx, prefix: string): Promise<string[]> {
  const headers = await ctx.db
    .query('views')
    .withIndex('by_key', (q) => q.gte('key', prefix).lt('key', `${prefix}\uffff`))
    .collect();
  return headers.map((h) => h.key);
}
