import { SupabaseLiftResult } from '@/data/types/athletes';
import { getAllCachedLiftingResultsForAthlete } from '@/lib/database/offline-store';
import { convex } from '@/lib/convex';
import { api } from '@/convex/_generated/api';

export type YearBests = { bestSnatch: number; bestCJ: number; bestTotal: number };

const cache = new Map<string, YearBests>();

const ZERO_BESTS: YearBests = { bestSnatch: 0, bestCJ: 0, bestTotal: 0 };

function maxPositive(values: (number | null | undefined)[]): number {
  return values.reduce<number>((max, v) => (typeof v === 'number' && v > 0 && v > max ? v : max), 0);
}

function deriveBestsFromResults(results: SupabaseLiftResult[]): YearBests {
  let bestSnatch = 0;
  let bestCJ = 0;
  let bestTotal = 0;
  for (const r of results) {
    const sn = maxPositive([r.snatch_best, r.snatch1, r.snatch2, r.snatch3]);
    const cj = maxPositive([r.cj_best, r.cj1, r.cj2, r.cj3]);
    const tot = typeof r.total === 'number' && r.total > 0 ? r.total : sn + cj;
    if (sn > bestSnatch) bestSnatch = sn;
    if (cj > bestCJ) bestCJ = cj;
    if (tot > bestTotal) bestTotal = tot;
  }
  return { bestSnatch, bestCJ, bestTotal };
}

async function getOfflineFallback(athleteName: string): Promise<YearBests> {
  try {
    const results = await getAllCachedLiftingResultsForAthlete(athleteName);
    if (results.length === 0) return ZERO_BESTS;
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const cutoff = oneYearAgo.toISOString().split('T')[0];
    const recent = results.filter(r => {
      if (!r.date) return true;
      const d = new Date(r.date);
      if (isNaN(d.getTime())) return true;
      return d.toISOString().split('T')[0] >= cutoff;
    });
    if (recent.length === 0) return deriveBestsFromResults(results);
    return deriveBestsFromResults(recent);
  } catch {
    return ZERO_BESTS;
  }
}

export async function getLastYearBests(athleteName: string): Promise<YearBests> {
  const cached = cache.get(athleteName);
  if (cached != null) return cached;
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  try {
    const cutoffDate = oneYearAgo.toISOString().split('T')[0];
    const results = await convex.query(api.liftingResults.getYearBestsByName, {
      name: athleteName,
      cutoffDate,
    });
    if (results.length === 0) {
      const fallback = await getOfflineFallback(athleteName);
      cache.set(athleteName, fallback);
      return fallback;
    }
    const result: YearBests = {
      bestSnatch: Math.max(...results.map(r => r.snatchBest || 0)),
      bestCJ: Math.max(...results.map(r => r.cjBest || 0)),
      bestTotal: Math.max(...results.map(r => r.total || 0)),
    };
    cache.set(athleteName, result);
    return result;
  } catch {
    const fallback = await getOfflineFallback(athleteName);
    cache.set(athleteName, fallback);
    return fallback;
  }
}

export function preloadYearBests(names: string[]): void {
  names.forEach(name => getLastYearBests(name));
}
