import { type MutationCtx } from '../_generated/server';
import { mapInBatches } from '../lib/concurrency';
import { earliestSince } from '../lib/viewKeys';
import { bumpVersion, type SourceTable } from '../lib/views';
import { scheduleRefresh } from '../views';

/** `since`: the earliest date of the results an `athlete` hint's write changed. */
export type WriteHint = { kind: string; key: string; since?: string };

export async function recordWrite(ctx: MutationCtx, table: SourceTable, hints: WriteHint[]): Promise<void> {
  await bumpVersion(ctx, table);
  const unique = new Map<string, WriteHint>();
  // Only a results write can be under a linked results title.
  const linked = table === 'lifting_results' ? await linkedMeetHints(ctx, hints) : [];
  for (const hint of [...hints, ...linked]) {
    const id = `${hint.kind}\u0000${hint.key}`;
    const seen = unique.get(id);
    unique.set(id, seen ? { ...hint, since: earliestSince(seen.since, hint.since) } : hint);
  }
  for (const hint of unique.values()) {
    const existing = await ctx.db
      .query('view_hints')
      .withIndex('by_kind_key', (q) => q.eq('kind', hint.kind).eq('key', hint.key))
      .first();
    const updatedAt = Date.now();
    // A pending hint's date only moves earlier, so it still covers the write
    // a refresh may be handling now.
    if (existing) await ctx.db.patch(existing._id, { seq: (existing.seq ?? 0) + 1, updatedAt, since: earliestSince(existing.since, hint.since) });
    else await ctx.db.insert('view_hints', { ...hint, seq: 0, updatedAt });
  }
  await scheduleRefresh(ctx);
}

const LINK_LOOKUP_BATCH = 250;

async function linkedMeetHints(ctx: MutationCtx, hints: readonly WriteHint[]): Promise<WriteHint[]> {
  const titles = [...new Set(hints.filter((hint) => hint.kind === 'meet').map((hint) => hint.key))];
  const links = await mapInBatches(titles, LINK_LOOKUP_BATCH, (title) =>
    ctx.db
      .query('meet_result_titles')
      .withIndex('by_title', (q) => q.eq('title', title))
      .first(),
  );
  return links.flatMap((link): WriteHint[] => (link ? [{ kind: 'meet', key: link.meet }] : []));
}
