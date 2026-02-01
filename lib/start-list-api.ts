import { supabase } from '@/lib/supabase';

export type YearBests = { bestSnatch: number; bestCJ: number; bestTotal: number };

const cache = new Map<string, YearBests>();

const ZERO_BESTS: YearBests = { bestSnatch: 0, bestCJ: 0, bestTotal: 0 };

function setNegativeCache(athleteName: string): YearBests {
  cache.set(athleteName, ZERO_BESTS);
  return ZERO_BESTS;
}

export async function getLastYearBests(athleteName: string): Promise<YearBests> {
  const cached = cache.get(athleteName);
  if (cached != null) return cached;
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  try {
    type LiftBestRow = { snatch_best: number | null; cj_best: number | null; total: number | null };
    const { data: athleteResults, error } = await supabase
      .from('lifting_results')
      .select('snatch_best, cj_best, total')
      .eq('name', athleteName)
      .gte('date', oneYearAgo.toISOString())
      .order('date', { ascending: false });
    if (error) return setNegativeCache(athleteName);
    const results = (athleteResults ?? []) as LiftBestRow[];
    if (results.length === 0) return setNegativeCache(athleteName);
    const result: YearBests = {
      bestSnatch: Math.max(...results.map(r => r.snatch_best || 0)),
      bestCJ: Math.max(...results.map(r => r.cj_best || 0)),
      bestTotal: Math.max(...results.map(r => r.total || 0))
    };
    cache.set(athleteName, result);
    return result;
  } catch {
    return setNegativeCache(athleteName);
  }
}

export function preloadYearBests(names: string[]): void {
  names.forEach(name => getLastYearBests(name));
}
