import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Schedule } from '@/types/schedule';
import type { LiftResult, AthleteMeetResult } from '@/data/types/athletes';
import { devLog } from '@/lib/logger';
import { scheduleShapeProblem } from '@/lib/schedule-shape';
import { normalizeLiftResults, normalizeAthleteName } from '@/lib/athletes';
import { emptyMeetEntry, getStore, meetDataWrites, updateStore } from './offline-store-index';
import { ATHLETES_KEY_PREFIX, LIFTING_RESULTS_KEY_PREFIX, SCHEDULE_KEY_PREFIX } from './offline-storage-keys';
import { saveSessionAthleteCaches } from './session-roster-cache';
import { writeStoredLiftingResults } from './lifting-results-blob';

export async function saveMeetSchedule(meetId: string, schedule: Schedule): Promise<void> {
  return meetDataWrites(meetId, async () => {
    try {
    
      const problem = scheduleShapeProblem(schedule);
      if (problem) {
        console.error(problem);
        throw new Error(problem);
      }
      if (schedule.length === 0) {
        console.error('Invalid schedule: empty array');
        throw new Error('Empty schedule');
      }

      const scheduleKey = `${SCHEDULE_KEY_PREFIX}${meetId}`;
      const scheduleString = JSON.stringify(schedule);
      const existingSchedule = await AsyncStorage.getItem(scheduleKey);
      if (existingSchedule !== scheduleString) {
        await AsyncStorage.setItem(scheduleKey, scheduleString);
      }

      try {
        await updateStore((store) => {
          const currentAthletesKey = store.meets[meetId]?.athletesKey || `${ATHLETES_KEY_PREFIX}${meetId}`;
          const currentLiftingResultsKey = store.meets[meetId]?.liftingResultsKey || `${LIFTING_RESULTS_KEY_PREFIX}${meetId}`;
          store.meets[meetId] = {
            schedule: null,
            scheduleKey: scheduleKey,
            athletesKey: currentAthletesKey,
            athletes: [],
            liftingResultsKey: currentLiftingResultsKey,
            lastSyncTime: Date.now(),
            athletesSyncedAt: store.meets[meetId]?.athletesSyncedAt ?? 0,
          };
        });
      } catch (metadataError) {
        console.warn('Saved schedule payload but failed to update store metadata:', metadataError);
      }

    } catch (error) {
      console.error('Error saving meet schedule:', error);
      throw error;
    }
  });
}

export const UNCHANGED_SYNC_STAMP_INTERVAL_MS = 15 * 60 * 1000;

export async function markMeetScheduleVerified(
  meetId: string,
  now: number = Date.now(),
  minIntervalMs: number = UNCHANGED_SYNC_STAMP_INTERVAL_MS,
): Promise<boolean> {
  const entry = (await getStore()).meets[meetId];
  if (!entry?.scheduleKey) return false;
  const age = now - (entry.lastSyncTime ?? 0);
  if (age >= 0 && age < minIntervalMs) return false;
  let wrote = false;
  await updateStore((store) => {
    const current = store.meets[meetId];
    if (!current?.scheduleKey) return;
    const currentAge = now - (current.lastSyncTime ?? 0);
    if (currentAge < minIntervalMs) return;
    current.lastSyncTime = now;
    wrote = true;
  });
  return wrote;
}

export async function saveMeetAthletes(meetId: string, athletes: LiftResult[]): Promise<boolean> {
  return meetDataWrites(meetId, async () => {
    try {
      const athletesKey = `${ATHLETES_KEY_PREFIX}${meetId}`;
      const existingPayload = await AsyncStorage.getItem(athletesKey);
      let existingAthletes: LiftResult[] = [];
      if (existingPayload) {
        try {
          const parsed: unknown = JSON.parse(existingPayload);
          existingAthletes = Array.isArray(parsed) ? normalizeLiftResults(parsed) : [];
        } catch (parseError) {
          console.warn('Ignoring invalid cached athlete payload:', parseError);
        }
      }
      if (athletes.length === 0 && existingAthletes.length > 0) {
        devLog('Roster answered with no athletes; keeping the stored roster', { meetId });
        return false;
      }
      const athleteKey = (athlete: LiftResult) =>
        athlete.memberId || normalizeAthleteName(athlete.name);
      const existingByKey = new Map(
        existingAthletes.map((athlete) => [athleteKey(athlete), athlete]),
      );
      const mergedAthletes = athletes.map((athlete) => {
        if (athlete.session) return athlete;
        const existing = existingByKey.get(athleteKey(athlete));
        return existing?.session
          ? {
              ...athlete,
              session: existing.session,
            }
          : athlete;
      });
      const mergedPayload = JSON.stringify(mergedAthletes);
      const payloadUnchanged = mergedPayload === existingPayload;
      if (!payloadUnchanged) {
        await AsyncStorage.setItem(athletesKey, mergedPayload);
        await saveSessionAthleteCaches(meetId, mergedAthletes);
      }

      try {
        await updateStore((store) => {
          if (!store.meets[meetId]) {
            store.meets[meetId] = { ...emptyMeetEntry(meetId), lastSyncTime: Date.now() };
          }
          store.meets[meetId].athletesKey = athletesKey;
          store.meets[meetId].athletes = [];
          store.meets[meetId].lastSyncTime = Date.now();
          store.meets[meetId].athletesSyncedAt = Date.now();
        });
      } catch (metadataError) {
        console.warn('Saved athletes payload but failed to update store metadata:', metadataError);
      }
      return true;
    } catch (error) {
      console.error('Error saving meet athletes:', error);
      throw error;
    }
  });
}

export async function saveMeetLiftingResults(meetId: string, liftingResults: AthleteMeetResult[]): Promise<void> {
  return meetDataWrites(meetId, async () => {
    try {
      const liftingResultsKey = `${LIFTING_RESULTS_KEY_PREFIX}${meetId}`;

      if (liftingResults.length === 0) {
        const existing = await AsyncStorage.getItem(liftingResultsKey);
        if (existing) {
          return;
        }
      }

      await writeStoredLiftingResults(liftingResultsKey, liftingResults);
    
      try {
        await updateStore((store) => {
          if (!store.meets[meetId]) {
            store.meets[meetId] = { ...emptyMeetEntry(meetId), lastSyncTime: Date.now() };
          } else {
            store.meets[meetId].liftingResultsKey = liftingResultsKey;
            store.meets[meetId].lastSyncTime = Date.now();
          }
        });
      } catch (metadataError) {
        console.warn('Saved lifting results payload but failed to update store metadata:', metadataError);
      }
    } catch (error) {
      console.error('Error saving meet lifting results:', error);
      throw error;
    }
  });
}
