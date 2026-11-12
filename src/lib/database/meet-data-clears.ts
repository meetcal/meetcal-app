import AsyncStorage from '@react-native-async-storage/async-storage';
import { MeetName } from '@/data/types/meet';
import { clearPackageEtag } from './package-etags';
import { runMeetClear } from './offline-clears';
import { emptyMeetEntry, getStore, meetDataWrites, updateStore } from './offline-store-index';
import { readStoredAthletes } from './meet-data-reads';
import { getExplicitlyDownloadedMeetIds, markMeetExplicitlyDownloaded } from './meet-downloads-registry';
import { clearStoredLiftingResultsValue } from './lifting-results-blob';
import { ATHLETES_KEY_PREFIX, LIFTING_RESULTS_CHUNK_MARKER, LIFTING_RESULTS_KEY_PREFIX, SCHEDULE_KEY_PREFIX, SESSION_ATHLETES_KEY_PREFIX } from './offline-storage-keys';
import { multiRemoveBatched } from './storage-batches';
import { pruneAthleteHistoryExclusiveToRoster } from './athlete-history-clears';

export async function readStorageKeysForMeetClear(
  meetCount: number,
): Promise<readonly string[]> {
  if (meetCount <= 0) return [];
  return AsyncStorage.getAllKeys();
}

export async function clearMeetData(
  meet: MeetName,
  options?: {
    storageKeys?: readonly string[];
    pruneHistory?: boolean;
  },
): Promise<void> {
  return runMeetClear(meet, () => meetDataWrites(meet, async () => {
    try {
      await clearPackageEtag(meet);
      const data = await getStore();
      const entry = data.meets[meet];
      const fixed = emptyMeetEntry(meet);
      const keysFor = (stored: string | undefined, fallback: string) =>
        Array.from(new Set([stored, fallback].filter((key): key is string => Boolean(key))));
      const scheduleKeys = keysFor(entry?.scheduleKey, fixed.scheduleKey);
      const athletesKeys = keysFor(entry?.athletesKey, fixed.athletesKey);
      const liftingResultsKeys = keysFor(entry?.liftingResultsKey, fixed.liftingResultsKey);
      const [primaryAthletesKey] = athletesKeys;
      const rosterNames =
        options?.pruneHistory === false || primaryAthletesKey === undefined
          ? []
          : (await readStoredAthletes(primaryAthletesKey, [])).map((athlete) => athlete.name);
      await markMeetExplicitlyDownloaded(meet, false);
      for (const key of [...scheduleKeys, ...athletesKeys]) {
        await AsyncStorage.removeItem(key);
      }
      for (const liftingResultsKey of liftingResultsKeys) {
        await clearStoredLiftingResultsValue(liftingResultsKey);
      }
      const keys = options?.storageKeys ?? (await AsyncStorage.getAllKeys());
      const sessionAthletesPrefix = `${SESSION_ATHLETES_KEY_PREFIX}${encodeURIComponent(meet)}:`;
      const chunkPrefixes = liftingResultsKeys.map((key) => `${key}${LIFTING_RESULTS_CHUNK_MARKER}`);
      const leftoverKeys = keys.filter(
        (key) =>
          key.startsWith(sessionAthletesPrefix) ||
          chunkPrefixes.some((prefix) => key.startsWith(prefix)),
      );
      await multiRemoveBatched(leftoverKeys);
      if (rosterNames.length > 0) {
        await pruneAthleteHistoryExclusiveToRoster(meet, rosterNames, await getStore(), keys);
      }
      await updateStore((store) => {
        delete store.meets[meet];
      });
    } catch (error) {
      console.error('Error clearing meet data:', error);
      throw error;
    }
  }));
}

function meetIdOfStorageKey(key: string): string | null {
  if (key.startsWith(SESSION_ATHLETES_KEY_PREFIX)) {
    const rest = key.slice(SESSION_ATHLETES_KEY_PREFIX.length);
    const end = rest.indexOf(':');
    if (end <= 0) return null;
    try {
      return decodeURIComponent(rest.slice(0, end));
    } catch {
      return null;
    }
  }
  for (const prefix of [SCHEDULE_KEY_PREFIX, ATHLETES_KEY_PREFIX, LIFTING_RESULTS_KEY_PREFIX]) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length);
    const chunkAt = rest.indexOf(LIFTING_RESULTS_CHUNK_MARKER);
    const meetId = chunkAt === -1 ? rest : rest.slice(0, chunkAt);
    return meetId.length > 0 ? meetId : null;
  }
  return null;
}

export async function listStoredMeets(
  extraMeetIds: readonly string[] = [],
): Promise<{ meetIds: MeetName[]; storageKeys: readonly string[] }> {
  const store = await getStore();
  const storageKeys = await AsyncStorage.getAllKeys();
  const meetIds = new Set<string>([...extraMeetIds, ...Object.keys(store.meets)]);
  for (const key of storageKeys) {
    const meetId = meetIdOfStorageKey(key);
    if (meetId) meetIds.add(meetId);
  }
  return { meetIds: Array.from(meetIds) as MeetName[], storageKeys };
}

export async function clearAllMeetData(): Promise<{ failed: number }> {
  try {
    const downloaded = await getExplicitlyDownloadedMeetIds();
    const { meetIds, storageKeys } = await listStoredMeets(Array.from(downloaded));

    let failed = 0;
    for (const meetId of meetIds) {
      try {
        await clearMeetData(meetId, { storageKeys, pruneHistory: false });
      } catch (error) {
        failed += 1;
        console.error('Error clearing meet data during clear-all:', error);
      }
    }
    return { failed };
  } catch (error) {
    console.error('Error clearing all meet data:', error);
    return { failed: 1 };
  }
}

export async function clearImplicitMeetData(
  exceptMeet?: MeetName,
  options?: { skip?: (meet: MeetName) => boolean },
): Promise<void> {
  try {
    const { meetIds, storageKeys: listing } = await listStoredMeets();
    const explicitlyDownloaded = await getExplicitlyDownloadedMeetIds();
    const implicitMeetIds = meetIds.filter((meetId) => {
      const meetName = meetId as MeetName;
      if (exceptMeet && meetName === exceptMeet) return false;
      return !explicitlyDownloaded.has(meetName);
    });
    const storageKeys = listing;

    for (const meetId of implicitMeetIds) {
      if (options?.skip?.(meetId as MeetName)) continue;
      try {
        await clearMeetData(meetId as MeetName, { storageKeys });
      } catch (error) {
        console.error('Error clearing implicit meet:', error);
      }
    }
  } catch (error) {
    console.error('Error clearing implicit meet data:', error);
  }
}
