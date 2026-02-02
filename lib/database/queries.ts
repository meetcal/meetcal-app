import { supabase } from '@/lib/supabase';
import type { Schedule, Session } from '@/types/schedule';
import type { Platform, SupabaseLiftResult } from '@/data/types/athletes';
import { MeetName } from '@/data/types/meet';
import type { LiftResult } from '@/data/types/athletes';
import { getMeetConfig } from '@/data/meets/config';

type DbSchedule = {
  id: number;
  date: string;
  session_id: number;
  start_time: string;
  weigh_in_time: string;
  platform: string;
  weight_class: string;
  meet: string;
};

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
  
  try {
    // First check what meet names we have in the database
    const { data: allRecords, error: meetError } = await supabase
      .from('session_schedule')
      .select('meet');
    
    if (meetError) {
      console.error('Error fetching meet names:', meetError);
    } else {
      const uniqueMeets = [...new Set(allRecords.map(r => r.meet))];
    }

    // Now try to fetch all records without any filters first
    const { data: sampleRecords, error: sampleError } = await supabase
      .from('session_schedule')
      .select('*')
      .limit(1);

    if (sampleError) {
      console.error('Error fetching sample records:', sampleError);
      throw sampleError;
    }

    // Now fetch the actual schedule with filters
    const { data, error } = await supabase
      .from('session_schedule')
      .select('*')
      .eq('meet', meet)
      .order('date')
      .order('session_id')
      .order('platform');

    if (error) {
      console.error('Error fetching schedule:', error);
      throw error;
    }

    if (!data || data.length === 0) {
      console.log('No schedule data found for meet:', meet);
      return [];
    }

    return data;
  } catch (error) {
    console.error('Error in fetchScheduleFromDb:', error);
    throw error;
  }
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
    if (!dayData.sessions.has(row.session_id)) {
      dayData.sessions.set(row.session_id, {
        id: row.session_id.toString(),
        number: row.session_id,
        startTime: formatTo12Hour(row.start_time),
        weighInTime: formatTo12Hour(row.weigh_in_time),
        platforms: []
      });
    }

    const session = dayData.sessions.get(row.session_id)!;
    session.platforms.push({
      platform: validatePlatform(row.platform),
      weightClass: row.weight_class,
      platformStartTime: formatTo12Hour(row.start_time) // Format platform-specific time
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
    const dbSchedule = await fetchScheduleFromDb(meet);
    return transformScheduleData(dbSchedule);
  } catch (error) {
    console.error('Error in fetchSchedule:', error);
    throw error;
  }
}

type AthleteWithSessionRow = {
  member_id: string;
  name: string;
  age: number;
  club: string;
  gender: string;
  weight_class: string;
  entry_total: number;
  adaptive: boolean;
  session_number: number | null;
  session_platform: string | null;
  meet: string;
  session_date: string | null;
  session_start_time: string | null;
  session_weigh_in_time: string | null;
  session_weight_class: string | null;
};

export async function fetchAthletesWithSession(meet: MeetName): Promise<LiftResult[]> {
  const { data, error } = await supabase
    .from('athletes_with_session')
    .select('*')
    .eq('meet', meet);

  if (error) {
    console.error('Error fetching athletes_with_session, falling back to fetchAthletes', { meet, error });
    return fetchAthletes(meet);
  }

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

  const rows = (data || []) as AthleteWithSessionRow[];
  const mappedData: LiftResult[] = rows.map((row) => {
    const hasSession = row.session_number != null && row.session_platform != null;
    const session = hasSession
      ? {
          number: row.session_number!,
          platform: validatePlatform(row.session_platform!),
          ...(row.session_date != null && {
            date: row.session_date,
            startTime: formatTo12Hour(row.session_start_time ?? ''),
            weighInTime: formatTo12Hour(row.session_weigh_in_time ?? ''),
            displayDate: formatDisplayDate(row.session_date) ?? undefined,
          }),
        }
      : undefined;
    return {
      memberId: row.member_id || '',
      name: row.name,
      age: row.age,
      club: row.club,
      gender: row.gender || '',
      weightClass: row.weight_class || '',
      entryTotal: row.entry_total,
      adaptive: row.adaptive || false,
      session,
    };
  });

  return mappedData;
}

export async function fetchAthletes(meet: MeetName): Promise<LiftResult[]> {
  const { data, error } = await supabase
    .from('athletes')
    .select('member_id,name,age,club,gender,weight_class,entry_total,adaptive,session_number,session_platform')
    .eq('meet', meet);

  if (error) {
    console.error('Error fetching athletes:', error);
    throw error;
  }

  const mappedData: LiftResult[] = (data || []).map(athlete => ({
    memberId: athlete.member_id || '',
    name: athlete.name,
    age: athlete.age,
    club: athlete.club,
    gender: athlete.gender || '',
    weightClass: athlete.weight_class || '',
    entryTotal: athlete.entry_total,
    adaptive: athlete.adaptive || false,
    session: athlete.session_number && athlete.session_platform ? {
      number: athlete.session_number,
      platform: validatePlatform(athlete.session_platform),
    } : undefined,
  }));

  return mappedData;
}

// Search athletes by name across all meets
export async function searchAthletesByName(query: string): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('lifting_results')
      .select('name')
      .ilike('name', `%${query}%`)
      .order('name');

    if (error) {
      console.error('Error searching athletes:', error);
      throw error;
    }

    // Extract unique names
    const uniqueNames = Array.from(new Set((data || []).map(result => result.name))).sort();
    return uniqueNames;
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

    const { data, error } = await supabase
      .from('lifting_results')
      .select('*')
      .in('name', athleteNames)
      .order('date', { ascending: false });

    if (error) {
      console.error('Error fetching lifting results for meet:', error);
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('Error in fetchLiftingResultsForMeet:', error);
    throw error;
  }
}
