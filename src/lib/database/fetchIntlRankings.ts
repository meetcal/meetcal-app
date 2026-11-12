import { isRecord } from '@/lib/is-record';
import { arrayOf, finiteNumber } from './cached-shapes';
import { createMutableResource } from '@/lib/data/mutable-resource';
import {
  getOfflineCache,
  OFFLINE_CACHE_KEYS,
  replaceOfflineCache,
  setOfflineCache,
} from './offline-cache';
import { fetchApiIntlRankingsTagged, type ApiIntlRankingRow } from '@/lib/api/reference-api';
import { mapTagged, requireNetwork, resourceEntry, untagged } from './tagged-read';

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

const readIntlRankings = arrayOf((value): IntlRanking | undefined => {
  if (!isRecord(value)) return undefined;
  const { meet, name, weightClass, gender, ageCategory } = value;
  const ranking = finiteNumber(value.ranking);
  const total = finiteNumber(value.total);
  const percentA = finiteNumber(value.percentA);
  if (typeof meet !== 'string' || typeof name !== 'string' || typeof weightClass !== 'string') return undefined;
  if (ranking === null || total === null || percentA === null) return undefined;
  if (typeof gender !== 'string' || !isIntlGender(gender)) return undefined;
  if (typeof ageCategory !== 'string' || !isIntlAgeCategory(ageCategory)) return undefined;
  return { meet, ranking, name, weightClass, total, percentA, gender, ageCategory };
});

async function readIntlRankingsCache() {
  return resourceEntry(await getOfflineCache(OFFLINE_CACHE_KEYS.intlRankings, readIntlRankings));
}

async function fetchIntlRankingsTagged(knownTag: string | null) {
  await requireNetwork();
  return mapTagged(await fetchApiIntlRankingsTagged(knownTag), toIntlRankings);
}

function fetchIntlRankingsFresh(): Promise<IntlRanking[]> {
  return untagged(fetchIntlRankingsTagged(null), '/data/intl-rankings');
}

function toIntlRankings(rows: readonly Readonly<ApiIntlRankingRow>[]): IntlRanking[] {
  const rankings: IntlRanking[] = [];
  for (const row of rows) {
    const ranking = toIntlRanking(row);
    if (ranking) rankings.push(ranking);
  }
  return rankings;
}

/**
 * No ranking at all. Neither the explicit download nor the browse path
 * (which writes to the download's key) stores such an answer: it would
 * replace a real download with nothing. The screen still shows the empty
 * answer; the stored copy stays.
 */
export function isIntlRankingsEmpty(rankings: readonly IntlRanking[]): boolean {
  return rankings.length === 0;
}

async function persistIntlRankings(rankings: IntlRanking[], tag: string | null) {
  if (isIntlRankingsEmpty(rankings)) return null;
  return resourceEntry(await setOfflineCache(OFFLINE_CACHE_KEYS.intlRankings, rankings, tag));
}

/**
 * Explicit offline download / refresh: fresh from the API and stored, or a
 * rejection that leaves the stored copy untouched. An empty table is a
 * rejection too: storing it would replace a real download with nothing.
 */
export async function downloadIntlRankingsForOffline(): Promise<void> {
  const rankings = await fetchIntlRankingsFresh();
  if (isIntlRankingsEmpty(rankings)) {
    throw new Error('International rankings download returned no rows');
  }
  await replaceOfflineCache(OFFLINE_CACHE_KEYS.intlRankings, rankings);
}

export const intlRankingsResource = createMutableResource<IntlRanking[], []>({
  getKey: () => OFFLINE_CACHE_KEYS.intlRankings,
  loadCached: () => readIntlRankingsCache(),
  fetchFresh: () => fetchIntlRankingsFresh(),
  persistFresh: (data) => persistIntlRankings(data, null),
  tagged: {
    fetch: (knownTag) => fetchIntlRankingsTagged(knownTag),
    persist: (data, tag) => persistIntlRankings(data, tag),
  },
});
