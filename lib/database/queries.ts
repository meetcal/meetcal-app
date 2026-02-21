import { convex } from '@/lib/convex';
import { api } from '@/convex/_generated/api';
import type { Schedule, Session } from '@/types/schedule';
import type { Platform, SupabaseLiftResult } from '@/data/types/athletes';
import { MeetName } from '@/data/types/meet';
import type { LiftResult } from '@/data/types/athletes';
import { getMeetConfig } from '@/data/meets/config';

const INITIAL_LOAD_TIMEOUT_MS = 4000;

async function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([Promise.resolve(promise), timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

type DbSchedule = {
  date: string;
  sessionId: number;
  startTime: string;
  weighInTime: string;
  platform: string;
  weightClass: string;
  meet: string;
};

const scheduleCache = new Map<MeetName, DbSchedule[]>();
const scheduleInFlight = new Map<MeetName, Promise<DbSchedule[]>>();
const transformedScheduleCache = new Map<MeetName, Schedule>();
const transformedScheduleInFlight = new Map<MeetName, Promise<Schedule>>();

// Validate and convert platform string to Platform type
function validatePlatform(platform: string): Platform {
  const validPlatforms: Platform[] = ['Red', 'White', 'White', 'Blue', 'Stars', 'Stripes', 'Rogue'];
  const normalizedPlatform = platform.charAt(0).toUpperCase() + platform.slice(1).toLowerCase();
  
  if (!validPlatforms.includes(normalizedPlatform as Platform)) {
    console.warn(`Invalid platform name: ${platform}, using Red as default`);
    return 'Red';
  }
  
  return normalizedPlatform as Platform;
}

// Convert 24-hour time to 12-hour time without seconds
function formatTo12Hour(time: string): string {
  if (!time) return '';
  
  try {
    // Split time into hours and minutes
    const [hours, minutes] = time.split(':').map(Number);
    
    // Determine period
    const period = hours >= 12 ? 'PM' : 'AM';
    
    // Convert hours to 12-hour format
    const displayHours = hours % 12 || 12;
    
    // Format the time string
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
  } catch (error) {
    console.error('Error formatting time:', error);
    return time;
  }
}

export async function fetchScheduleFromDb(meet: MeetName): Promise<DbSchedule[]> {
  const cachedSchedule = scheduleCache.get(meet);
  if (cachedSchedule) {
    return cachedSchedule;
  }

  const inFlight = scheduleInFlight.get(meet);
  if (inFlight) {
    return inFlight;
  }

  const request = (async () => {
  try {
    const data = await withTimeout(
      convex.query(api.schedule.getByMeet, { meet: meet as string }),
      INITIAL_LOAD_TIMEOUT_MS,
      'fetchScheduleFromDb:schedule'
    );

    if (!data || data.length === 0) {
      console.log('No schedule data found for meet:', meet);
      return [];
    }

    const sorted = [...data].sort((a, b) => {
      const d = a.date.localeCompare(b.date);
      if (d !== 0) return d;
      const s = a.sessionId - b.sessionId;
      if (s !== 0) return s;
      return a.platform.localeCompare(b.platform);
    }) as DbSchedule[];

    scheduleCache.set(meet, sorted);
    return sorted;
  } catch (error) {
    console.error('Error in fetchScheduleFromDb:', error);
    throw error;
  } finally {
    scheduleInFlight.delete(meet);
  }
  })();

  scheduleInFlight.set(meet, request);
  return request;
}

async function fetchAndTransformSchedule(meet: MeetName): Promise<Schedule> {
  const cached = transformedScheduleCache.get(meet);
  if (cached) {
    return cached;
  }

  const inFlight = transformedScheduleInFlight.get(meet);
  if (inFlight) {
    return inFlight;
  }

  const request = (async () => {
    const dbSchedule = await fetchScheduleFromDb(meet);
    const transformed = await transformScheduleData(dbSchedule);
    transformedScheduleCache.set(meet, transformed);
    return transformed;
  })().finally(() => {
    transformedScheduleInFlight.delete(meet);
  });

  transformedScheduleInFlight.set(meet, request);
  return request;
}

// Transform DB data to match our Schedule type
export async function transformScheduleData(dbSchedule: DbSchedule[]): Promise<Schedule> {
  
  const platformOrder: Platform[] = ['Red', 'White', 'Blue', 'Stars', 'Stripes', 'Rogue'];
  
  const scheduleMap = new Map<string, {
    date: string;
    fullDate: string;
    sessions: Map<number, Session>;
  }>();

  for (const row of dbSchedule) {
    if (!scheduleMap.has(row.date)) {
      // Format the date in the meet's timezone without double-applying offsets.
      const meetConfig = await getMeetConfig(row.meet as MeetName);
      const [datePart] = row.date.split('T');
      const [year, month, day] = datePart.split('-').map(Number);
      const safeUtcDate = Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)
        ? new Date(row.date)
        : new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

      scheduleMap.set(row.date, {
        date: safeUtcDate.toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
          timeZone: meetConfig.time.timeZoneIdentifier
        }),
        fullDate: row.date,
        sessions: new Map()
      });
    }

    const dayData = scheduleMap.get(row.date)!;
    if (!dayData.sessions.has(row.sessionId)) {
      dayData.sessions.set(row.sessionId, {
        id: row.sessionId.toString(),
        number: row.sessionId,
        startTime: formatTo12Hour(row.startTime),
        weighInTime: formatTo12Hour(row.weighInTime),
        platforms: []
      });
    }

    const session = dayData.sessions.get(row.sessionId)!;
    session.platforms.push({
      platform: validatePlatform(row.platform),
      weightClass: row.weightClass,
      platformStartTime: formatTo12Hour(row.startTime)
    });
  }

  // Convert map to array and sort sessions
  const schedule: Schedule = [];
  for (const [_, dayData] of scheduleMap) {
    const sessions = Array.from(dayData.sessions.values()).sort((a, b) => a.number - b.number);
    schedule.push({
      date: dayData.date,
      fullDate: dayData.fullDate,
      sessions
    });
  }

  return schedule;
}

export async function fetchSchedule(meet: MeetName): Promise<Schedule> {
  try {
    return await fetchAndTransformSchedule(meet);
  } catch (error) {
    console.error('Error in fetchSchedule:', error);
    throw error;
  }
}

export async function fetchAthletesWithSession(meet: MeetName): Promise<LiftResult[]> {
  try {
    const rows = await convex.query(api.athletes.getWithSessionByMeet, { meet: meet as string });

    const meetConfig = await getMeetConfig(meet);
    const formatDisplayDate = (isoDate: string | null) => {
      if (!isoDate) return undefined;
      const [datePart] = isoDate.split('T');
      const [year, month, day] = datePart.split('-').map(Number);
      if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return undefined;
      const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
      return d.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: meetConfig.time.timeZoneIdentifier,
      });
    };

    const mappedData: LiftResult[] = rows.map((row) => {
      const hasSession = row.sessionNumber != null && row.sessionPlatform != null;
      const scheduleRow = row.scheduleRow;
      const session = hasSession
        ? {
            number: row.sessionNumber!,
            platform: validatePlatform(row.sessionPlatform!),
            ...(scheduleRow?.date != null && {
              date: scheduleRow.date,
              startTime: formatTo12Hour(scheduleRow.startTime ?? ''),
              weighInTime: formatTo12Hour(scheduleRow.weighInTime ?? ''),
              displayDate: formatDisplayDate(scheduleRow.date) ?? undefined,
            }),
          }
        : undefined;
      return {
        memberId: row.memberId || '',
        name: row.name,
        age: row.age,
        club: row.club,
        gender: row.gender || '',
        weightClass: row.weightClass || '',
        entryTotal: row.entryTotal,
        adaptive: row.adaptive || false,
        session,
      };
    });

    return mappedData;
  } catch (error) {
    console.error('Error fetching athletes_with_session, falling back to fetchAthletes', { meet, error });
    return fetchAthletes(meet);
  }
}

export async function fetchAthletes(meet: MeetName): Promise<LiftResult[]> {
  const athletes = await convex.query(api.athletes.getByMeet, { meet: meet as string });

  return athletes.map(athlete => ({
    memberId: athlete.memberId || '',
    name: athlete.name,
    age: athlete.age,
    club: athlete.club,
    gender: athlete.gender || '',
    weightClass: athlete.weightClass || '',
    entryTotal: athlete.entryTotal,
    adaptive: athlete.adaptive || false,
    session: athlete.sessionNumber && athlete.sessionPlatform ? {
      number: athlete.sessionNumber,
      platform: validatePlatform(athlete.sessionPlatform),
    } : undefined,
  }));
}

// Search athletes by name across all meets
export async function searchAthletesByName(query: string): Promise<string[]> {
  try {
    return await convex.query(api.athletes.searchByName, { query });
  } catch (error) {
    console.error('Error in searchAthletesByName:', error);
    throw error;
  }
}

// Fetch lifting results for all athletes in a meet
// This includes all historical results for these athletes (for PR calculations and "See All Meet Results")
export async function fetchLiftingResultsForMeet(meet: MeetName, athleteNames: string[]): Promise<SupabaseLiftResult[]> {
  try {
    if (athleteNames.length === 0) {
      return [];
    }

    const rows = await convex.query(api.liftingResults.getByNames, { names: athleteNames });

    // Map camelCase Convex fields to snake_case SupabaseLiftResult shape for offline store compatibility
    // TODO: update SupabaseLiftResult to camelCase after full migration
    const toSnake = (r: typeof rows[0]): SupabaseLiftResult => ({
      ...r,
      event_id: (r as any).eventId ?? r.eventId,
      body_weight: (r as any).bodyWeight ?? r.bodyWeight,
      snatch_best: (r as any).snatchBest ?? r.snatchBest,
      cj_best: (r as any).cjBest ?? r.cjBest,
    } as unknown as SupabaseLiftResult);

    if (rows.length > 0) {
      return rows.map(toSnake);
    }

    // Fallback: fetch by meet name
    const meetRows = await convex.query(api.liftingResults.getByMeet, { meet: meet as string });
    return meetRows.map(toSnake);
  } catch (error) {
    console.error('Error in fetchLiftingResultsForMeet:', error);
    throw error;
  }
}
