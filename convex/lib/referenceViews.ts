import type { MutationCtx } from '../_generated/server';
import { itemAt } from './json';
import { computeQualifyingTotals, computeRecords } from './referenceData';
import { groupedByFoldedValue, qualifyingTotalCategories, recordCategories } from './referenceFilters';
import {
  QUALIFYING_TOTALS_OF_EVENT_PREFIX,
  qualifyingTotalsOfEventKey,
  RECORDS_OF_FEDERATION_PREFIX,
  recordsOfFederationKey,
  REF_VIEWS,
  VIEW_SOURCES,
} from './viewKeys';
import { deleteView, jsonChunks, snapshotVersions, viewKeysWithPrefix, writeView, type SourceVersion } from './views';

async function replaceViewsOfEachValue<T>(
  ctx: MutationCtx,
  prefix: string,
  keyOf: (value: string) => string,
  rows: readonly T[],
  valueOf: (row: T) => string,
  sources: readonly SourceVersion[],
): Promise<void> {
  const written = new Set<string>();
  for (const group of groupedByFoldedValue(rows, valueOf).values()) {
    const key = keyOf(valueOf(itemAt(group, 0)));
    await writeView(ctx, key, jsonChunks(group), sources);
    written.add(key);
  }
  for (const key of await viewKeysWithPrefix(ctx, prefix)) {
    if (!written.has(key)) await deleteView(ctx, key);
  }
}

export async function writeRecordsViews(ctx: MutationCtx): Promise<void> {
  const sources = await snapshotVersions(ctx, VIEW_SOURCES.records);
  const rows = await computeRecords(ctx);
  await writeView(ctx, REF_VIEWS.records, jsonChunks(rows), sources);
  await writeView(ctx, REF_VIEWS.record_categories, jsonChunks(recordCategories(rows)), sources);
  await replaceViewsOfEachValue(ctx, RECORDS_OF_FEDERATION_PREFIX, recordsOfFederationKey, rows, (row) => row.record_type, sources);
}

export async function writeQualifyingTotalsViews(ctx: MutationCtx): Promise<void> {
  const sources = await snapshotVersions(ctx, VIEW_SOURCES.qualifying_totals);
  const rows = await computeQualifyingTotals(ctx);
  await writeView(ctx, REF_VIEWS.qualifying_totals, jsonChunks(rows), sources);
  await writeView(ctx, REF_VIEWS.qualifying_total_categories, jsonChunks(qualifyingTotalCategories(rows)), sources);
  await replaceViewsOfEachValue(ctx, QUALIFYING_TOTALS_OF_EVENT_PREFIX, qualifyingTotalsOfEventKey, rows, (row) => row.event_name, sources);
}
