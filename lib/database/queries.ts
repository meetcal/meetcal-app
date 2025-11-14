import { supabase } from '@/lib/supabase';
import type { Schedule, Session } from '@/types/schedule';
import type { Platform } from '@/data/types/athletes';
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
      // Create a date object in UTC
      const utcDate = new Date(row.date);
      
      // Format the date in the meet's timezone
      const meetConfig = await getMeetConfig(row.meet as MeetName);
      const meetDate = new Date(utcDate.getTime() + (meetConfig.time.utcOffset * 60 * 60 * 1000));
      
      scheduleMap.set(row.date, {
        date: meetDate.toLocaleDateString('en-US', { 
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

export async function fetchAthletes(meet: MeetName): Promise<LiftResult[]> {
  
  const { data, error } = await supabase
    .from('athletes')
    .select('*')
    .eq('meet', meet);

  if (error) {
    console.error('Error fetching athletes:', error);
    throw error;
  }

  // Explicitly map Supabase snake_case fields to LiftResult camelCase fields
  const mappedData: LiftResult[] = (data || []).map(athlete => ({
    memberId: athlete.member_id || '',
    name: athlete.name,
    age: athlete.age,
    club: athlete.club,
    gender: athlete.gender || '',
    weightClass: athlete.weight_class || '', // Map weight_class to weightClass
    entryTotal: athlete.entry_total,
    adaptive: athlete.adaptive || false,
    session: athlete.session_number && athlete.session_platform ? {
      number: athlete.session_number,
      platform: validatePlatform(athlete.session_platform), // Also validate platform here
    } : undefined,
    // Add any other fields from LiftResult that need mapping
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