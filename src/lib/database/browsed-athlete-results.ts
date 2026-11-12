import { normalizeAthleteName } from '@/lib/athletes';
import type { AthleteMeetResult } from '@/types/athlete-results';
import { OFFLINE_CACHE_KEYS, readBoundedCacheEntry, writeBoundedCacheEntry } from './offline-cache';
import { readUnknown } from './cached-shapes';
import { toCachedLiftResults } from './lifting-results-blob';

export const MAX_BROWSED_ATHLETES = 12;

export async function readBrowsedAthleteResults(name: string): Promise<AthleteMeetResult[] | null> {
  const key = normalizeAthleteName(name);
  if (!key) return null;
  const entry = await readBoundedCacheEntry(OFFLINE_CACHE_KEYS.athleteResultsBrowse, key, readUnknown);
  if (!entry || !Array.isArray(entry.data)) return null;
  const rows = toCachedLiftResults(entry.data);
  return rows.length > 0 ? rows : null;
}

export async function saveBrowsedAthleteResults(name: string, rows: readonly AthleteMeetResult[]): Promise<void> {
  const key = normalizeAthleteName(name);
  if (!key || rows.length === 0) return;
  await writeBoundedCacheEntry(OFFLINE_CACHE_KEYS.athleteResultsBrowse, key, rows, MAX_BROWSED_ATHLETES);
}
