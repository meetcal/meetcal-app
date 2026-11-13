import type { LifterCard, PRIndexes } from '@/data/types/athletes';
import type { AthleteRequest } from '@/lib/api/results-api';
import type { ApiDetails, SavedResults } from '@/lib/athlete-results-load';
import { normalizeAthleteName } from '@/lib/athletes';
import { isRecord } from '@/lib/is-record';
import type { AthleteMeetResult } from '@/types/athlete-results';
import { OFFLINE_CACHE_KEYS, readBoundedCacheEntry, writeBoundedCacheEntry } from './offline-cache';
import { readUnknown } from './cached-shapes';
import { toCachedLiftResults } from './lifting-results-blob';

export const MAX_BROWSED_ATHLETES = 12;

function browseKey({ name, lifter, membership, other }: AthleteRequest): string | null {
  const folded = normalizeAthleteName(name);
  if (!folded) return null;
  if (lifter) return `${folded}\u0000lifter:${lifter}`;
  if (other) return `${folded}\u0000other`;
  if (membership) return `${folded}\u0000member:${membership}`;
  return folded;
}

const isIndex = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);

function readPrIndexes(value: unknown): PRIndexes | null {
  if (!isRecord(value) || !isIndex(value.snatch) || !isIndex(value.cj) || !isIndex(value.total)) return null;
  return { snatch: value.snatch, cj: value.cj, total: value.total };
}

function readLifterCard(value: unknown): LifterCard | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.label !== 'string') return null;
  return { id: value.id, name: value.name, label: value.label };
}

function readDetails(value: unknown): ApiDetails | null {
  if (!isRecord(value)) return null;
  const prs = readPrIndexes(value.prs);
  if (!prs) return null;
  return { lifter: readLifterCard(value.lifter), prs };
}

export async function readBrowsedAthleteResults(request: AthleteRequest): Promise<SavedResults | null> {
  const key = browseKey(request);
  if (!key) return null;
  const entry = await readBoundedCacheEntry(OFFLINE_CACHE_KEYS.athleteResultsBrowse, key, readUnknown);
  if (!entry) return null;
  const saved = isRecord(entry.data) ? entry.data : { rows: entry.data, details: null };
  if (!Array.isArray(saved.rows)) return null;
  const rows = toCachedLiftResults(saved.rows);
  return rows.length > 0 ? { rows, details: readDetails(saved.details) } : null;
}

export async function saveBrowsedAthleteResults(
  request: AthleteRequest,
  rows: readonly AthleteMeetResult[],
  details: ApiDetails,
): Promise<void> {
  const key = browseKey(request);
  if (!key || rows.length === 0) return;
  await writeBoundedCacheEntry(OFFLINE_CACHE_KEYS.athleteResultsBrowse, key, { rows, details }, MAX_BROWSED_ATHLETES);
}
