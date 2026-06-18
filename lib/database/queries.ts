import type { Schedule } from '@/types/schedule';
import type { SupabaseLiftResult, LiftResult } from '@/data/types/athletes';
import { MeetName } from '@/data/types/meet';
import {
  fetchApiAthletes,
  fetchApiAthletesWithSession,
  fetchApiLiftingResultsForMeet,
  fetchApiRecentResultsByNames,
  fetchApiResultsByNames,
  fetchApiSchedule,
  searchApi,
} from '@/lib/api/meetcal-api';

const scheduleInFlight = new Map<MeetName, Promise<Schedule>>();

export async function fetchSchedule(meet: MeetName): Promise<Schedule> {
  const inFlight = scheduleInFlight.get(meet);
  if (inFlight) return inFlight;

  const request = fetchApiSchedule(meet)
    .catch((error) => {
      console.error('Error in fetchSchedule:', error);
      throw error;
    })
    .finally(() => {
      scheduleInFlight.delete(meet);
    });

  scheduleInFlight.set(meet, request);
  return request;
}

export async function fetchAthletesWithSession(
  meet: MeetName,
  sessionNumber?: number,
  platform?: string,
): Promise<LiftResult[]> {
  try {
    return await fetchApiAthletesWithSession(meet, sessionNumber, platform);
  } catch (error) {
    console.error('Error fetching athletes with session, falling back to fetchAthletes', { meet, error });
    if (sessionNumber != null || platform) {
      throw error;
    }
    return fetchAthletes(meet);
  }
}

export async function fetchAthletes(meet: MeetName): Promise<LiftResult[]> {
  return fetchApiAthletes(meet);
}

export async function searchAthletesByName(query: string): Promise<string[]> {
  try {
    const response = await searchApi(query);
    return response.suggestions;
  } catch (error) {
    console.error('Error in searchAthletesByName:', error);
    throw error;
  }
}

export async function fetchAllResultsForName(name: string): Promise<SupabaseLiftResult[]> {
  return fetchApiResultsByNames([name]);
}

export async function fetchAthleteHistoryForNames(
  names: string[],
): Promise<Record<string, SupabaseLiftResult[]>> {
  const byName: Record<string, SupabaseLiftResult[]> = {};
  names.forEach((name) => {
    byName[name] = [];
  });
  if (names.length === 0) return byName;

  try {
    const rows = await fetchApiResultsByNames(names);
    const normalizedNameLookup = new Map(
      names.map((name) => [name.trim().toLowerCase().replace(/\s+/g, ' '), name]),
    );
    rows.forEach((row) => {
      const key = normalizedNameLookup.get(
        (row.name || '').trim().toLowerCase().replace(/\s+/g, ' '),
      );
      if (key) byName[key].push(row);
    });
    return byName;
  } catch (error) {
    console.error('Error in fetchAthleteHistoryForNames:', error);
    throw error;
  }
}

export async function fetchRecentAthleteHistoryForNames(
  names: string[],
  cutoffDate?: string,
): Promise<SupabaseLiftResult[]> {
  return fetchApiRecentResultsByNames(names, cutoffDate);
}

export async function fetchLiftingResultsForMeet(
  meet: MeetName,
  _athleteNames: string[] = [],
): Promise<SupabaseLiftResult[]> {
  try {
    return await fetchApiLiftingResultsForMeet(meet);
  } catch (error) {
    console.error('Error in fetchLiftingResultsForMeet:', error);
    throw error;
  }
}
