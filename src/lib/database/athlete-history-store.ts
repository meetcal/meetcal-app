import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AthleteMeetResult } from '@/data/types/athletes';
import { MeetName } from '@/data/types/meet';
import { normalizeAthleteName } from '@/lib/athletes';
import { readStoredLiftingResults, writeStoredLiftingResultsBatch, type LiftingResultsWrite } from './lifting-results-blob';
import { getAthleteHistoryKey, legacyAthleteKeyName } from './offline-storage-keys';
import { STORAGE_READ_BATCH_SIZE } from './storage-batches';
import { getStore } from './offline-store-index';

export type AthleteHistoryEntry = {
  name: string;
  results: AthleteMeetResult[];
};

export async function saveAthleteHistoryBatch(
  entries: readonly AthleteHistoryEntry[],
): Promise<number> {
  try {
    const writesByKey = new Map<string, LiftingResultsWrite>();
    for (const entry of entries) {
      const normalized = normalizeAthleteName(entry.name);
      if (normalized.length === 0) continue;
      writesByKey.set(getAthleteHistoryKey(normalized), {
        key: getAthleteHistoryKey(normalized),
        results: entry.results,
      });
    }
    return await writeStoredLiftingResultsBatch(Array.from(writesByKey.values()));
  } catch (error) {
    console.error('Error saving athlete history:', error);
    throw error;
  }
}

export async function findAthleteNamesWithoutHistory(
  athleteNames: readonly string[],
): Promise<string[]> {
  const uniqueNames = Array.from(new Set(athleteNames.filter(Boolean)));
  const missing: string[] = [];
  for (let offset = 0; offset < uniqueNames.length; offset += STORAGE_READ_BATCH_SIZE) {
    const batch = uniqueNames.slice(offset, offset + STORAGE_READ_BATCH_SIZE);
    const entries = await AsyncStorage.multiGet(
      batch.map((name) => getAthleteHistoryKey(normalizeAthleteName(name))),
    );
    const stillMissing = batch.filter((_name, index) => !entries[index]?.[1]);
    const legacy = stillMissing.flatMap((name) => {
      const legacyName = legacyAthleteKeyName(name);
      return legacyName ? [{ name, key: getAthleteHistoryKey(legacyName) }] : [];
    });
    const legacyEntries =
      legacy.length > 0 ? await AsyncStorage.multiGet(legacy.map(({ key }) => key)) : [];
    const foundLegacy = new Set(
      legacy.filter((_entry, index) => legacyEntries[index]?.[1]).map(({ name }) => name),
    );
    for (const name of stillMissing) {
      if (!foundLegacy.has(name)) missing.push(name);
    }
  }
  return missing;
}

export async function getAllCachedLiftingResultsForAthletes(
  athleteNames: string[],
): Promise<Record<string, AthleteMeetResult[]>> {
  const uniqueNames = Array.from(new Set(athleteNames));
  const byName: Record<string, AthleteMeetResult[]> = {};
  if (uniqueNames.length === 0) return byName;

  const needsMeetScan: string[] = [];
  for (const athleteName of uniqueNames) {
    byName[athleteName] = [];
    try {
      let fromHistory = await readStoredLiftingResults(
        getAthleteHistoryKey(normalizeAthleteName(athleteName)),
      );
      const legacyName = legacyAthleteKeyName(athleteName);
      if (fromHistory.length === 0 && legacyName) {
        fromHistory = await readStoredLiftingResults(getAthleteHistoryKey(legacyName));
      }
      if (fromHistory.length > 0) {
        byName[athleteName] = fromHistory;
        continue;
      }
    } catch (error) {
      console.error('Error getting cached lifting results for athlete:', error);
      continue;
    }
    needsMeetScan.push(athleteName);
  }

  if (needsMeetScan.length === 0) return byName;

  try {
    const store = await getStore();
    const meetIds = Object.keys(store.meets);

    const seenByName = new Map<string, Set<string>>();
    const rowIndexByName = new Map<string, number>();
    const namesByNormalized = new Map<string, string[]>();
    for (const athleteName of needsMeetScan) {
      seenByName.set(athleteName, new Set());
      rowIndexByName.set(athleteName, 0);
      const normalized = normalizeAthleteName(athleteName);
      const bucket = namesByNormalized.get(normalized);
      if (bucket) bucket.push(athleteName);
      else namesByNormalized.set(normalized, [athleteName]);
    }

    for (const meetId of meetIds) {
      const liftingResultsKey = store.meets[meetId as MeetName]?.liftingResultsKey;
      if (!liftingResultsKey) continue;

      const meetResults = await readStoredLiftingResults(liftingResultsKey);
      for (const r of meetResults) {
        const targets = namesByNormalized.get(normalizeAthleteName(r.name));
        if (!targets) continue;
        const baseKey = `${r.event_id || r.meet}-${r.date}-${r.name}`;
        const isSentinelKey = baseKey === 'undefined-undefined-undefined';
        for (const athleteName of targets) {
          const seen = seenByName.get(athleteName)!;
          let dedupeKey = baseKey;
          if (isSentinelKey) {
            const rowIndex = rowIndexByName.get(athleteName)!;
            dedupeKey = `${baseKey}-${rowIndex}`;
            rowIndexByName.set(athleteName, rowIndex + 1);
          }
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          byName[athleteName].push(r);
        }
      }
    }

    for (const athleteName of needsMeetScan) {
      byName[athleteName].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
    }
  } catch (error) {
    console.error('Error getting cached lifting results for athlete:', error);
    for (const athleteName of needsMeetScan) {
      byName[athleteName] = [];
    }
  }

  return byName;
}

export async function getAllCachedLiftingResultsForAthlete(
  athleteName: string,
): Promise<AthleteMeetResult[]> {
  const byName = await getAllCachedLiftingResultsForAthletes([athleteName]);
  return byName[athleteName] ?? [];
}
