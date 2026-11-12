import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Schedule } from '@/types/schedule';
import type { LiftResult, AthleteMeetResult } from '@/data/types/athletes';
import { MeetName } from '@/data/types/meet';
import { isSchedule, scheduleShapeProblem } from '@/lib/schedule-shape';
import { normalizeLiftResults } from '@/lib/athletes';
import { emptyMeetEntry, getStore, type MeetData } from './offline-store-index';
import { ATHLETES_KEY_PREFIX, SCHEDULE_KEY_PREFIX } from './offline-storage-keys';
import { readStoredLiftingResults } from './lifting-results-blob';

export async function readStoredAthletes(athletesKey: string, fallback: LiftResult[]): Promise<LiftResult[]> {
  try {
    const athletesString = await AsyncStorage.getItem(athletesKey);
    if (!athletesString) {
      return fallback;
    }
    const parsed: unknown = JSON.parse(athletesString);
    return Array.isArray(parsed) ? normalizeLiftResults(parsed) : fallback;
  } catch (error) {
    console.error('Error reading stored athletes:', error);
    return fallback;
  }
}

async function readCachedSchedule(scheduleKey: string): Promise<Schedule | null> {
  const scheduleString = await AsyncStorage.getItem(scheduleKey);
  if (!scheduleString) return null;
  try {
    const parsed: unknown = JSON.parse(scheduleString);
    if (isSchedule(parsed)) return parsed;
    console.warn('Ignoring cached schedule:', scheduleShapeProblem(parsed));
    return null;
  } catch (parseError) {
    console.warn('Ignoring invalid cached schedule payload:', parseError);
    return null;
  }
}

export async function getMeetData(meetId: MeetName): Promise<MeetData> {
  try {
    const store = await getStore();
    const entry = store.meets[meetId] ?? emptyMeetEntry(meetId);

    const scheduleKey = entry.scheduleKey;
    const schedule = scheduleKey ? await readCachedSchedule(scheduleKey) : null;
    
    const athletesKey = entry.athletesKey || `${ATHLETES_KEY_PREFIX}${meetId}`;
    const athletes = await readStoredAthletes(
      athletesKey,
      Array.isArray(entry.athletes) ? normalizeLiftResults(entry.athletes) : [],
    );

    return {
      schedule,
      scheduleKey: entry.scheduleKey,
      athletesKey,
      athletes,
      liftingResultsKey: entry.liftingResultsKey,
      lastSyncTime: entry.lastSyncTime,
      athletesSyncedAt: entry.athletesSyncedAt ?? 0,
    };
  } catch (error) {
    console.error('Error getting meet data:', error);
    throw error;
  }
}

export async function getMeetLiftingResults(meetId: MeetName): Promise<AthleteMeetResult[]> {
  try {
    const meetData = await getMeetData(meetId);
    const liftingResultsKey = meetData.liftingResultsKey;

    if (!liftingResultsKey) {
      return [];
    }

    return await readStoredLiftingResults(liftingResultsKey);
  } catch (error) {
    console.error('Error getting meet lifting results:', error);
    return [];
  }
}

export async function getMeetSchedule(meetId: string): Promise<Schedule> {
  try {
    const fixedKey = `${SCHEDULE_KEY_PREFIX}${meetId}`;
    const fromFixedKey = await readCachedSchedule(fixedKey);
    if (fromFixedKey) return fromFixedKey;
    const indexed = (await getStore()).meets[meetId]?.scheduleKey;
    if (!indexed || indexed === fixedKey) return [];
    return (await readCachedSchedule(indexed)) ?? [];
  } catch (error) {
    console.error('Error getting meet schedule:', error);
    return [];
  }
}
