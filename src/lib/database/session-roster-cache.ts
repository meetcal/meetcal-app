import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LiftResult } from '@/data/types/athletes';
import { MeetName } from '@/data/types/meet';
import { filterSessionAthletes, normalizeLiftResults, normalizePlatformKey } from '@/lib/athletes';
import { meetDataWrites } from './offline-store-index';
import { SESSION_ATHLETES_KEY_PREFIX, getSessionAthletesKey } from './offline-storage-keys';
import { multiRemoveBatched, multiSetBatched } from './storage-batches';
import { getMeetData } from './meet-data-reads';

function groupAthletesBySession(athletes: LiftResult[]) {
  const groups = new Map<string, LiftResult[]>();

  athletes.forEach((athlete) => {
    const session = athlete.session;
    if (!session) return;

    const key = `${session.number}:${normalizePlatformKey(session.platform)}`;
    const group = groups.get(key) ?? [];
    group.push(athlete);
    groups.set(key, group);
  });

  return groups;
}

export async function saveSessionAthletes(
  meetId: MeetName | string,
  sessionNumber: number,
  platform: string,
  athletes: LiftResult[],
): Promise<void> {
  if (athletes.length === 0) return;
  return meetDataWrites(String(meetId), async () => {
    try {
      const key = getSessionAthletesKey(meetId, sessionNumber, platform);
      await AsyncStorage.setItem(key, JSON.stringify(athletes));
    } catch (error) {
      console.error('Error saving session athletes:', error);
      throw error;
    }
  });
}

export async function saveSessionAthleteCaches(
  meetId: MeetName | string,
  athletes: LiftResult[],
): Promise<void> {
  const grouped = groupAthletesBySession(athletes);

  const entries = Array.from(grouped.entries()).map(([groupKey, group]) => {
    const [sessionNumber, platform = ''] = groupKey.split(':');
    return [
      getSessionAthletesKey(meetId, Number(sessionNumber), platform),
      JSON.stringify(group),
    ] as [string, string];
  });

  await multiSetBatched(entries);

  const current = new Set(entries.map(([key]) => key));
  const prefix = `${SESSION_ATHLETES_KEY_PREFIX}${encodeURIComponent(meetId)}:`;
  const stale = (await AsyncStorage.getAllKeys()).filter(
    (key) => key.startsWith(prefix) && !current.has(key),
  );
  await multiRemoveBatched(stale);
}

export async function getSessionAthletesFromMeetCache(
  meetId: MeetName,
  sessionNumber: number,
  platform: string
): Promise<LiftResult[]> {
  try {
    const sessionPayload = await AsyncStorage.getItem(
      getSessionAthletesKey(meetId, sessionNumber, platform),
    );
    if (sessionPayload) {
      const parsed: unknown = JSON.parse(sessionPayload);
      const normalized = Array.isArray(parsed) ? normalizeLiftResults(parsed) : [];
      if (Array.isArray(parsed) && parsed.length > 0 && normalized.length === parsed.length) {
        const athletes = filterSessionAthletes(normalized, sessionNumber, platform);
        if (athletes.length > 0) return athletes;
      }
    }

  } catch (error) {
    console.error('Error getting session athletes from cache:', error);
  }

  try {
    const meetData = await getMeetData(meetId);
    return filterSessionAthletes(meetData.athletes, sessionNumber, platform);
  } catch (error) {
    console.error('Error getting session athletes from meet cache:', error);
    return [];
  }
}
