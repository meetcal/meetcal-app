import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearAllPackageEtags } from './package-etags';
import { runHistoryClear } from './offline-clears';
import { normalizeAthleteName } from '@/lib/athletes';
import { ATHLETE_BESTS_KEY_PREFIX, ATHLETE_HISTORY_KEY_PREFIX, LIFTING_RESULTS_CHUNK_MARKER } from './offline-storage-keys';
import { removeManyBatched } from './storage-batches';
import { getStore, type OfflineStore } from './offline-store-index';
import { readStoredAthletes } from './meet-data-reads';

function athleteNameOfStorageKey(key: string): string | null {
  const prefix = key.startsWith(ATHLETE_HISTORY_KEY_PREFIX)
    ? ATHLETE_HISTORY_KEY_PREFIX
    : key.startsWith(ATHLETE_BESTS_KEY_PREFIX)
      ? ATHLETE_BESTS_KEY_PREFIX
      : null;
  if (!prefix) return null;
  const rest = key.slice(prefix.length);
  const chunkAt = rest.indexOf(LIFTING_RESULTS_CHUNK_MARKER);
  return normalizeAthleteName(chunkAt === -1 ? rest : rest.slice(0, chunkAt));
}

function athleteNamesWithStoredDataInListing(storageKeys: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (const key of storageKeys) {
    const name = athleteNameOfStorageKey(key);
    if (name) names.add(name);
  }
  return names;
}

async function removeAthleteKeysFromListing(
  storageKeys: readonly string[],
  normalizedNames: ReadonlySet<string>,
): Promise<number> {
  if (normalizedNames.size === 0) return 0;
  const keys = storageKeys.filter((key) => {
    const name = athleteNameOfStorageKey(key);
    return name !== null && normalizedNames.has(name);
  });
  await removeManyBatched(keys);
  return keys.length;
}

async function readRemainingRosterNames(
  store: OfflineStore,
  exceptMeet: string,
): Promise<Set<string>> {
  const names = new Set<string>();
  for (const [meetId, entry] of Object.entries(store.meets)) {
    if (meetId === exceptMeet) continue;
    const roster = await readStoredAthletes(entry.athletesKey, []);
    for (const athlete of roster) {
      const normalized = normalizeAthleteName(athlete.name);
      if (normalized) names.add(normalized);
    }
  }
  return names;
}

export async function pruneAthleteHistoryExclusiveToRoster(
  meet: string,
  rosterNames: readonly string[],
  store: OfflineStore,
  storageKeys: readonly string[],
): Promise<number> {
  const withStoredData = athleteNamesWithStoredDataInListing(storageKeys);
  const candidates = new Set<string>();
  for (const name of rosterNames) {
    const normalized = normalizeAthleteName(name);
    if (normalized && withStoredData.has(normalized)) candidates.add(normalized);
  }
  if (candidates.size === 0) return 0;

  const shared = await readRemainingRosterNames(store, meet);
  const exclusive = new Set<string>();
  for (const name of candidates) {
    if (!shared.has(name)) exclusive.add(name);
  }
  return removeAthleteKeysFromListing(storageKeys, exclusive);
}

export async function pruneOrphanedAthleteHistory(
  options?: { keepNames?: readonly string[] },
): Promise<number> {
  try {
    const storageKeys = await AsyncStorage.getAllKeys();
    const withStoredData = athleteNamesWithStoredDataInListing(storageKeys);
    if (withStoredData.size === 0) return 0;

    const store = await getStore();
    const keep = await readRemainingRosterNames(store, '');
    for (const name of options?.keepNames ?? []) {
      const normalized = normalizeAthleteName(name);
      if (normalized) keep.add(normalized);
    }
    const orphaned = new Set<string>();
    for (const name of withStoredData) {
      if (!keep.has(name)) orphaned.add(name);
    }
    return await removeAthleteKeysFromListing(storageKeys, orphaned);
  } catch (error) {
    console.error('Error pruning orphaned athlete history:', error);
    return 0;
  }
}

export async function clearAllAthleteHistory(): Promise<void> {
  try {
    await runHistoryClear(removeAllAthleteHistory);
  } catch (error) {
    console.error('Error clearing athlete history:', error);
  }
}

async function removeAllAthleteHistory(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const athleteHistoryKeys = keys.filter(
    (k) => k.startsWith(ATHLETE_HISTORY_KEY_PREFIX) || k.startsWith(ATHLETE_BESTS_KEY_PREFIX),
  );
  await removeManyBatched(athleteHistoryKeys);
  await clearAllPackageEtags();
}
