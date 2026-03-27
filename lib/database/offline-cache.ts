import AsyncStorage from '@react-native-async-storage/async-storage';

export type OfflineCacheEntry<T> = {
  data: T;
  lastSynced: number;
};

export const OFFLINE_CACHE_KEYS = {
  standards: '@offline_cache/standards',
  qualifyingTotals: '@offline_cache/qualifying_totals',
  intlRankings: '@offline_cache/intl_rankings',
  records: '@offline_cache/records',
  wsoRecords: '@offline_cache/wso_records',
  adaptiveRecords: '@offline_cache/adaptive_records',
  nationalRankings: '@offline_cache/national_rankings',
  clubs: '@offline_cache/clubs',
  clubAthletes: '@offline_cache/club_athletes',
  clubMeetStats: '@offline_cache/club_meet_stats',
} as const;

export async function getOfflineCache<T>(key: string): Promise<OfflineCacheEntry<T> | null> {
  try {
    const stored = await AsyncStorage.getItem(key);
    if (!stored) return null;
    return JSON.parse(stored) as OfflineCacheEntry<T>;
  } catch (error) {
    console.error('Error reading offline cache:', error);
    return null;
  }
}

export async function setOfflineCache<T>(key: string, data: T): Promise<OfflineCacheEntry<T>> {
  const entry: OfflineCacheEntry<T> = {
    data,
    lastSynced: Date.now()
  };
  try {
    await AsyncStorage.setItem(key, JSON.stringify(entry));
  } catch (error) {
    console.error('Error writing offline cache:', error);
  }
  return entry;
}

export async function clearOfflineCache(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch (error) {
    console.error('Error clearing offline cache:', error);
  }
}

export async function getOfflineLastSynced(key: string): Promise<number | null> {
  const entry = await getOfflineCache(key);
  return entry?.lastSynced ?? null;
}
