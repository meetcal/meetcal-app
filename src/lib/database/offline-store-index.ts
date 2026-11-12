import { isRecord } from '@/lib/is-record';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Schedule } from '@/types/schedule';
import type { LiftResult } from '@/data/types/athletes';
import { MeetName } from '@/data/types/meet';
import { createKeyedWriteChain, createWriteChain } from '@/lib/data/write-chain';
import { normalizeLiftResults } from '@/lib/athletes';
import { ATHLETES_KEY_PREFIX, LIFTING_RESULTS_KEY_PREFIX, SCHEDULE_KEY_PREFIX } from './offline-storage-keys';

const STORE_KEY = 'meetcal_offline_store';

export interface MeetData {
  schedule: Schedule | null;
  scheduleKey: string;
  athletesKey: string;
  athletes: LiftResult[];
  liftingResultsKey: string;
  lastSyncTime: number;
  athletesSyncedAt?: number;
}

export interface OfflineStore {
  meets: {
    [meetId: string]: MeetData;
  };
}

const storeWrites = createWriteChain();

const meetDataWriteChain = createKeyedWriteChain();

const meetWriteGenerations = new Map<string, number>();

function bumpMeetWriteGeneration(meetId: string): void {
  meetWriteGenerations.set(meetId, (meetWriteGenerations.get(meetId) ?? 0) + 1);
}

export function meetDataWrites<T>(meetId: string, task: () => Promise<T>): Promise<T> {
  bumpMeetWriteGeneration(meetId);
  const run = meetDataWriteChain(meetId, task);
  const settle = () => bumpMeetWriteGeneration(meetId);
  run.then(settle, settle);
  return run;
}

export function emptyMeetEntry(meetId: string): MeetData {
  return {
    schedule: null,
    scheduleKey: `${SCHEDULE_KEY_PREFIX}${meetId}`,
    athletesKey: `${ATHLETES_KEY_PREFIX}${meetId}`,
    athletes: [],
    liftingResultsKey: `${LIFTING_RESULTS_KEY_PREFIX}${meetId}`,
    lastSyncTime: 0,
  };
}

export async function updateStore(mutate: (store: OfflineStore) => void): Promise<void> {
  await storeWrites(async () => {
    const store = await getStore();
    mutate(store);
    await AsyncStorage.setItem(STORE_KEY, JSON.stringify(store));
  });
}

export async function initStore(): Promise<void> {
  try {
    await storeWrites(async () => {
      const store = await AsyncStorage.getItem(STORE_KEY);
      if (!store) {
        const initialStore: OfflineStore = {
          meets: {}
        };
        await AsyncStorage.setItem(STORE_KEY, JSON.stringify(initialStore));
      }
    });
  } catch (error) {
    console.error('Error initializing store:', error);
  }
}

export function getMeetWriteGeneration(meetId: string): number {
  return meetWriteGenerations.get(meetId) ?? 0;
}

export async function getMeetAthletesSyncedAt(meetId: string): Promise<number> {
  try {
    return (await getStore()).meets[meetId]?.athletesSyncedAt ?? 0;
  } catch {
    return 0;
  }
}

export async function getLastSyncTime(meet: MeetName): Promise<number | null> {
  try {
    const data = await getStore();
    return data.meets[meet]?.lastSyncTime || null;
  } catch (error) {
    console.error('Error getting last sync time:', error);
    return null;
  }
}

function toStoredMeetData(meetId: string, value: unknown): MeetData | null {
  if (!isRecord(value)) return null;
  const entry = value;
  const stringOr = (candidate: unknown, fallback: string) =>
    typeof candidate === 'string' && candidate.length > 0 ? candidate : fallback;
  return {
    schedule: null,
    scheduleKey: stringOr(entry.scheduleKey, `${SCHEDULE_KEY_PREFIX}${meetId}`),
    athletesKey: stringOr(entry.athletesKey, `${ATHLETES_KEY_PREFIX}${meetId}`),
    athletes: Array.isArray(entry.athletes) ? normalizeLiftResults(entry.athletes) : [],
    liftingResultsKey: stringOr(
      entry.liftingResultsKey,
      `${LIFTING_RESULTS_KEY_PREFIX}${meetId}`,
    ),
    lastSyncTime:
      typeof entry.lastSyncTime === 'number' && Number.isFinite(entry.lastSyncTime)
        ? entry.lastSyncTime
        : 0,
    athletesSyncedAt:
      typeof entry.athletesSyncedAt === 'number' && Number.isFinite(entry.athletesSyncedAt)
        ? entry.athletesSyncedAt
        : 0,
  };
}

function toOfflineStore(value: unknown): OfflineStore | null {
  if (!isRecord(value)) return null;
  const meetsValue = (value as { meets?: unknown }).meets;
  if (!isRecord(meetsValue)) {
    return null;
  }
  const meets: OfflineStore['meets'] = {};
  let dropped = 0;
  for (const [meetId, entry] of Object.entries(meetsValue)) {
    const meetData = toStoredMeetData(meetId, entry);
    if (meetData) {
      meets[meetId] = meetData;
    } else {
      dropped += 1;
    }
  }
  if (dropped > 0) {
    console.warn(`Dropped ${dropped} malformed offline store meet entries`);
  }
  return { meets };
}

export async function getStore(): Promise<OfflineStore> {
  const store = await AsyncStorage.getItem(STORE_KEY);
  if (store) {
    try {
      const parsed: unknown = JSON.parse(store);
      const validated = toOfflineStore(parsed);
      if (validated) {
        return validated;
      }
    } catch (error) {
      console.warn('Store payload was invalid, reinitializing:', error);
    }
  }

  return { meets: {} };
}
