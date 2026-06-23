import type { Schedule } from '@/types/schedule';
import type { SupabaseBests, SupabaseLiftResult, LiftResult } from '@/data/types/athletes';
import { MeetName } from '@/data/types/meet';
import {
  fetchApiAthletes,
  fetchApiAthletesWithSession,
  fetchApiLiftingResultsForMeet,
  fetchApiRecentResultsByNames,
  fetchApiResultsByNames,
  fetchApiYearBestsByNames,
  fetchApiSchedule,
  searchApi,
} from '@/lib/api/meetcal-api';

const scheduleInFlight = new Map<MeetName, Promise<Schedule>>();
const athletesWithSessionInFlight = new Map<string, Promise<LiftResult[]>>();

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
  const key = `${meet}:${sessionNumber ?? ''}:${platform ?? ''}`;
  const inFlight = athletesWithSessionInFlight.get(key);
  if (inFlight) return inFlight;

  const request = fetchApiAthletesWithSession(meet, sessionNumber, platform)
    .catch((error) => {
      console.error('Error fetching athletes with session, falling back to fetchAthletes', { meet, error });
      if (sessionNumber != null || platform) {
        throw error;
      }
      return fetchAthletes(meet);
    })
    .finally(() => {
      athletesWithSessionInFlight.delete(key);
    });

  athletesWithSessionInFlight.set(key, request);
  return request;
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

export async function fetchRecentAthleteHistoryForNames(
  names: string[],
  cutoffDate?: string,
): Promise<SupabaseLiftResult[]> {
  return fetchApiRecentResultsByNames(names, cutoffDate);
}

export async function fetchAthleteBestsForNames(
  names: string[],
  cutoffDate?: string,
): Promise<Record<string, SupabaseBests>> {
  const rows = await fetchApiYearBestsByNames(names, cutoffDate);
  const byName: Record<string, SupabaseBests> = {};
  names.forEach((name) => {
    const row = rows[name];
    byName[name] = {
      snatch_best: row?.bestSnatch && row.bestSnatch > 0 ? row.bestSnatch : null,
      cj_best: row?.bestCJ && row.bestCJ > 0 ? row.bestCJ : null,
      total: row?.bestTotal && row.bestTotal > 0 ? row.bestTotal : null,
    };
  });
  return byName;
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
