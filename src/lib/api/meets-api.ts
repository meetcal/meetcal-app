import { filterSessionAthletes } from '@/lib/athletes';
import { LiftResult } from '@/data/types/athletes';
import { Meet, MeetName } from '@/data/types/meet';
import type { Schedule } from '@/types/schedule';
import { getTrustedNow } from '@/lib/api/server-clock';
import { getRevalidated, revalidateTagged, type TaggedAnswer } from '@/lib/api/revalidated-reads';
import { mapApiMeet, mapApiSchedule, validateApiMeetDetails, validateApiMeets, validateApiSchedule } from '@/lib/api/api-meet-mappers';
import { MeetCalApiError, decodeJsonText, readQuery } from '@/lib/api/meetcal-api';
import { assertArray } from '@/lib/api/api-validators';
import { mapApiAthletes } from '@/lib/api/api-athlete-mappers';

function meetsWindowNow(): number {
  const hourMs = 60 * 60 * 1000;
  const now = getTrustedNow()?.getTime() ?? Date.now();
  return Math.floor(now / hourMs) * hourMs;
}

export async function fetchApiMeets(): Promise<Meet[]> {
  const rows = await getRevalidated('/meets', 'meets:list', { now: meetsWindowNow() }, validateApiMeets, {});
  return rows.map((row) => mapApiMeet(row));
}

export async function fetchApiMeetByName(meet: string): Promise<Meet | null> {
  try {
    const row = await getRevalidated('/meets/details', 'meets:details', { meet }, validateApiMeetDetails);
    return row ? mapApiMeet(row) : null;
  } catch (error) {
    if (error instanceof MeetCalApiError && error.status === 404) return null;
    throw error;
  }
}

export async function fetchApiSchedule(meet: MeetName): Promise<Schedule> {
  const rows = await getRevalidated('/meets/schedule', 'meets:schedule', { meet }, validateApiSchedule);
  return mapApiSchedule(rows);
}

export async function fetchApiAthletes(meet: MeetName): Promise<LiftResult[]> {
  const rows = assertArray(
    decodeJsonText(await readQuery('/meets/athletes', 'meets:athletes', { meet }), '/meets/athletes'),
    '/meets/athletes',
  );
  return mapApiAthletes(rows, '/meets/athletes');
}

function validateApiAthletesWithSession(json: unknown): unknown[] {
  return assertArray(json, '/meets/athletes-sessions');
}

export async function fetchApiRosterTagged(meet: MeetName, knownTag: string | null): Promise<TaggedAnswer<LiftResult[]>> {
  const answer = await revalidateTagged(
    '/meets/athletes-sessions',
    'meets:athletesSessions',
    { meet },
    validateApiAthletesWithSession,
    { knownTag, acceptsBareValue: true },
  );
  if (answer.status === 'unchanged') return answer;
  return { status: 'fresh', value: mapApiAthletes(answer.value, '/meets/athletes-sessions'), tag: answer.tag };
}

export async function fetchApiAthletesWithSession(
  meet: MeetName,
  sessionNumber?: number,
  platform?: string,
): Promise<LiftResult[]> {
  const filterLocally = sessionNumber != null && !!platform;
  const rows = await getRevalidated(
    '/meets/athletes-sessions',
    'meets:athletesSessions',
    {
      meet,
      sessionNumber: sessionNumber ?? undefined,
      platform: filterLocally ? undefined : platform,
    },
    validateApiAthletesWithSession,
    undefined,
    true,
  );
  const athletes = mapApiAthletes(rows, '/meets/athletes-sessions');
  return filterLocally ? filterSessionAthletes(athletes, sessionNumber, platform) : athletes;
}
