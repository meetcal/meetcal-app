import type { Schedule } from '@/types/schedule';
import type { AthleteLookup, AthleteMeetResult, LiftResult } from '@/data/types/athletes';
import { MeetName } from '@/data/types/meet';
import {
  getMockAthletesWithSession,
  getMockSchedule,
  isMockedMeet,
} from '@/config/dev-mock-meet';
import { fetchApiAthletes, fetchApiAthletesWithSession, fetchApiRosterTagged, fetchApiSchedule } from '@/lib/api/meets-api';
import type { TaggedAnswer } from '@/lib/api/revalidated-reads';
import { fetchApiRecentResultsByNames, fetchAthlete, searchApi, type AthleteRequest } from '@/lib/api/results-api';

const scheduleInFlight = new Map<MeetName, Promise<Schedule>>();
const athletesWithSessionInFlight = new Map<string, Promise<LiftResult[]>>();

/**
 * A meet's schedule, one request at a time per meet. It needs nothing from
 * the meet's details: day titles are calendar dates, read in UTC.
 */
export async function fetchSchedule(meet: MeetName): Promise<Schedule> {
  if (__DEV__ && (await isMockedMeet(meet))) {
    return getMockSchedule(meet);
  }

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
  if (__DEV__ && (await isMockedMeet(meet))) {
    return getMockAthletesWithSession(meet, sessionNumber, platform);
  }

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

const rosterInFlight = new Map<string, Promise<TaggedAnswer<LiftResult[]>>>();

export function fetchRosterTagged(meet: MeetName, knownTag: string | null): Promise<TaggedAnswer<LiftResult[]>> {
  const key = `${meet}\u0000${knownTag ?? ''}`;
  const inFlight = rosterInFlight.get(key);
  if (inFlight) return inFlight;
  const request = (async (): Promise<TaggedAnswer<LiftResult[]>> => {
    if (__DEV__ && (await isMockedMeet(meet))) {
      return { status: 'fresh', value: await getMockAthletesWithSession(meet), tag: null };
    }
    try {
      return await fetchApiRosterTagged(meet, knownTag);
    } catch (error) {
      console.error('Error fetching athletes with session, falling back to fetchAthletes', { meet, error });
      return { status: 'fresh', value: await fetchAthletes(meet), tag: null };
    }
  })().finally(() => {
    rosterInFlight.delete(key);
  });
  rosterInFlight.set(key, request);
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

export async function fetchAthleteResults(request: AthleteRequest): Promise<AthleteLookup> {
  return fetchAthlete(request);
}

export async function fetchRecentAthleteHistoryForNames(
  names: string[],
  cutoffDate?: string,
): Promise<AthleteMeetResult[]> {
  return fetchApiRecentResultsByNames(names, cutoffDate);
}
