import { readNationalRankings } from './cached-shapes';
import { createMutableResource } from '@/lib/data/mutable-resource';
import {
  OFFLINE_CACHE_KEYS,
  readBoundedCacheEntry,
  writeBoundedCacheEntry,
} from './offline-cache';
import { fetchApiNationalRankingsTagged, type ApiNationalRankingRow } from '@/lib/api/reference-api';
import { mapTagged, untagged } from './tagged-read';

export type NationalRanking = {
  id: number;
  name: string;
  total: number;
};

/**
 * Weight classes whose rankings stay cached for offline browsing. One class
 * is ~14KB; 24 covers every class of one gender across a couple of age
 * groups (what one lifter or coach flips between) in ~350KB, where the
 * uncapped cache reached 1.7MB at 120 classes.
 */
export const MAX_CACHED_RANKING_CLASSES = 24;

function mapRankings(rows: readonly Readonly<ApiNationalRankingRow>[]): NationalRanking[] {
  const seenNames = new Set<string>();
  const rankings: NationalRanking[] = [];
  let idx = 0;

  rows.forEach((row) => {
    if (!row.name || row.total == null || seenNames.has(row.name)) return;
    seenNames.add(row.name);
    rankings.push({
      id: idx++,
      name: row.name,
      total: row.total,
    });
  });

  return rankings;
}

function readNationalRankingsCache(weightClassAge: string) {
  return readBoundedCacheEntry(OFFLINE_CACHE_KEYS.nationalRankings, weightClassAge, readNationalRankings);
}

async function fetchNationalRankingsTagged(knownTag: string | null, weightClassAge: string) {
  return mapTagged(await fetchApiNationalRankingsTagged(knownTag, 'USAW', weightClassAge), mapRankings);
}

function fetchNationalRankingsFresh(weightClassAge: string): Promise<NationalRanking[]> {
  return untagged(fetchNationalRankingsTagged(null, weightClassAge), '/data/nat-rankings');
}

function persistNationalRankings(weightClassAge: string, rankings: NationalRanking[], tag: string | null) {
  return writeBoundedCacheEntry(
    OFFLINE_CACHE_KEYS.nationalRankings,
    weightClassAge,
    rankings,
    MAX_CACHED_RANKING_CLASSES,
    tag,
  );
}

export const nationalRankingsResource = createMutableResource<
  NationalRanking[],
  [string]
>({
  getKey: (weightClassAge) =>
    `${OFFLINE_CACHE_KEYS.nationalRankings}:${weightClassAge}`,
  loadCached: (weightClassAge) => readNationalRankingsCache(weightClassAge),
  fetchFresh: (weightClassAge) => fetchNationalRankingsFresh(weightClassAge),
  persistFresh: (data, weightClassAge) =>
    persistNationalRankings(weightClassAge, data, null),
  tagged: {
    fetch: (knownTag, weightClassAge) => fetchNationalRankingsTagged(knownTag, weightClassAge),
    persist: (data, tag, weightClassAge) => persistNationalRankings(weightClassAge, data, tag),
  },
});
