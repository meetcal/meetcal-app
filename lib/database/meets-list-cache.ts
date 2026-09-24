import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Meet } from '@/data/types/meet';

/**
 * The `/meets` list as last fetched, on disk.
 *
 * Its own module (re-exported by `meet-manager`) so `queries.fetchSchedule`
 * can resolve a meet from it without importing `meet-manager`, which imports
 * `queries`.
 */
export const MEETS_LIST_CACHE_KEY = '@meets_list_cache_v1';

/**
 * The cached meets list is the offline source for the meet picker, the schedule
 * header and every meet-local time conversion, so a row without `name`,
 * `dates` or `time` is not a meet we can render — it would surface as
 * `Cannot read property 'timeZoneIdentifier' of undefined` in a screen rather
 * than as a missing row here.
 */
function isCachedMeet(value: unknown): value is Meet {
  if (!value || typeof value !== 'object') return false;
  const meet = value as Partial<Meet>;
  return (
    typeof meet.name === 'string' &&
    meet.name.length > 0 &&
    typeof meet.dates === 'object' &&
    meet.dates !== null &&
    typeof meet.time === 'object' &&
    meet.time !== null &&
    typeof meet.time.timeZoneIdentifier === 'string'
  );
}

export async function getCachedMeets(): Promise<Meet[]> {
  try {
    const cached = await AsyncStorage.getItem(MEETS_LIST_CACHE_KEY);
    if (!cached) return [];
    const parsed: unknown = JSON.parse(cached);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCachedMeet);
  } catch (error) {
    console.error('Error reading cached meets list:', error);
    return [];
  }
}

export async function setCachedMeets(meets: Meet[]): Promise<void> {
  try {
    await AsyncStorage.setItem(MEETS_LIST_CACHE_KEY, JSON.stringify(meets));
  } catch (error) {
    console.error('Error saving cached meets list:', error);
  }
}

/**
 * The meet from the cached `/meets` list only — never the network. For
 * callers that want to *skip* a `/meets/details` round trip when the answer is
 * already on disk, and can carry on without it when it is not.
 */
export async function getCachedMeetByName(name: string): Promise<Meet | null> {
  const cached = await getCachedMeets();
  return cached.find((meet) => meet.name === name) ?? null;
}
