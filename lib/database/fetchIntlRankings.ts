import { createMutableResource } from '@/lib/data/mutable-resource';
import { isNetworkAvailable } from '@/lib/networkUtils';
import {
  getOfflineCache,
  OFFLINE_CACHE_KEYS,
  replaceOfflineCache,
  setOfflineCache,
} from './offline-cache';
import { fetchApiIntlRankings, type ApiIntlRankingRow } from '@/lib/api/meetcal-api';

export type IntlRanking = {
  meet: string;
  ranking: number;
  name: string;
  weightClass: string;
  total: number;
  percentA: number;
  gender: 'Men' | 'Women';
  ageCategory: 'Senior' | 'Junior' | 'Youth' | 'U17' | 'U15' | 'University';
};

const INTL_GENDERS: ReadonlySet<string> = new Set<IntlRanking['gender']>(['Men', 'Women']);
const INTL_AGE_CATEGORIES: ReadonlySet<string> = new Set<IntlRanking['ageCategory']>([
  'Senior',
  'Junior',
  'Youth',
  'U17',
  'U15',
  'University',
]);

function isIntlGender(value: string): value is IntlRanking['gender'] {
  return INTL_GENDERS.has(value);
}

function isIntlAgeCategory(value: string): value is IntlRanking['ageCategory'] {
  return INTL_AGE_CATEGORIES.has(value);
}

/**
 * The row mapped into the app shape, or `null` when a column the screen
 * needs is missing or outside the categories `IntlRanking` declares.
 */
function toIntlRanking(row: Readonly<ApiIntlRankingRow>): IntlRanking | null {
  const { meet, ranking, name, weight_class, total, percent_a, gender, age_category } = row;
  if (!meet || !name || !weight_class) return null;
  if (ranking == null || total == null || percent_a == null) return null;
  if (!gender || !isIntlGender(gender)) return null;
  if (!age_category || !isIntlAgeCategory(age_category)) return null;
  return {
    meet,
    ranking,
    name,
    weightClass: weight_class,
    total,
    percentA: percent_a,
    gender,
    ageCategory: age_category,
  };
}

async function readIntlRankingsCache() {
  const cached = await getOfflineCache<IntlRanking[]>(OFFLINE_CACHE_KEYS.intlRankings);
  return cached ? { data: cached.data, lastUpdatedAt: cached.lastSynced } : null;
}

async function fetchIntlRankingsFresh(): Promise<IntlRanking[]> {
  const hasNetwork = await isNetworkAvailable();
  if (!hasNetwork) {
    throw new Error('Offline');
  }

  const rows = await fetchApiIntlRankings();
  const rankings: IntlRanking[] = [];
  for (const row of rows) {
    const ranking = toIntlRanking(row);
    if (ranking) rankings.push(ranking);
  }
  return rankings;
}

async function persistIntlRankings(rankings: IntlRanking[]) {
  const entry = await setOfflineCache(OFFLINE_CACHE_KEYS.intlRankings, rankings);
  return { data: entry.data, lastUpdatedAt: entry.lastSynced };
}

/**
 * Explicit offline download / refresh: fresh from the API and stored, or a
 * rejection that leaves the stored copy untouched. An empty table is a
 * rejection too: storing it would replace a real download with nothing.
 */
export async function downloadIntlRankingsForOffline(): Promise<void> {
  const rankings = await fetchIntlRankingsFresh();
  if (rankings.length === 0) {
    throw new Error('International rankings download returned no rows');
  }
  await replaceOfflineCache(OFFLINE_CACHE_KEYS.intlRankings, rankings);
}

export const intlRankingsResource = createMutableResource<IntlRanking[], []>({
  getKey: () => OFFLINE_CACHE_KEYS.intlRankings,
  loadCached: () => readIntlRankingsCache(),
  fetchFresh: () => fetchIntlRankingsFresh(),
  persistFresh: (data) => persistIntlRankings(data),
});
