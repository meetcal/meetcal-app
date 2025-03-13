import { supabase } from '@/lib/supabase';
import type { Schedule, Session } from '@/types/schedule';
import type { Platform } from '@/data/types/athletes';
import { MeetName } from '@/data/types/meet';
import type { LiftResult } from '@/data/types/athletes';

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
  const validPlatforms: Platform[] = ['Red', 'White', 'Blue', 'Stars', 'Stripes', 'Rogue'];
  const normalizedPlatform = platform.charAt(0).toUpperCase() + platform.slice(1).toLowerCase();
  
  if (validPlatforms.includes(normalizedPlatform as Platform)) {
    return normalizedPlatform as Platform;
  }
  console.warn(`Invalid platform "${platform}", defaulting to "Blue"`);
  return 'Blue';
}

export async function fetchScheduleFromDb(meet: MeetName): Promise<DbSchedule[]> {
  console.log('Fetching schedule from Supabase for meet:', meet);
  
  try {
    // First check what meet names we have in the database
    const { data: allRecords, error: meetError } = await supabase
      .from('session_schedule')
      .select('meet');
    
    if (meetError) {
      console.error('Error fetching meet names:', meetError);
    } else {
      const uniqueMeets = [...new Set(allRecords.map(r => r.meet))];
      console.log('Available meets in database:', uniqueMeets);
    }

    // Now try to fetch all records without any filters first
    console.log('Fetching sample records...');
    const { data: sampleRecords, error: sampleError } = await supabase
      .from('session_schedule')
      .select('*')
      .limit(1);

    if (sampleError) {
      console.error('Error fetching sample records:', sampleError);
      throw sampleError;
    }
    console.log('Sample records:', sampleRecords);

    // Now fetch the actual schedule with filters
    console.log('Fetching filtered schedule for meet:', meet);
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

    console.log('Successfully fetched schedule. Records:', data?.length || 0);
    return data || [];
  } catch (error) {
    console.error('Error in fetchScheduleFromDb:', error);
    throw error;
  }
}

// Transform DB data to match our Schedule type
export function transformScheduleData(dbSchedule: DbSchedule[]): Schedule {
  console.log('Transforming schedule data, received records:', dbSchedule.length);
  
  const platformOrder: Platform[] = ['Red', 'White', 'Blue', 'Stars', 'Stripes', 'Rogue'];
  
  const scheduleMap = new Map<string, {
    date: string;
    fullDate: string;
    sessions: Map<number, Session>;
  }>();

  dbSchedule.forEach(row => {
    console.log('Processing row:', row);
    if (!scheduleMap.has(row.date)) {
      scheduleMap.set(row.date, {
        date: new Date(row.date).toLocaleDateString('en-US', { 
          month: 'long', 
          day: 'numeric', 
          year: 'numeric' 
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
        startTime: row.start_time,
        weighInTime: row.weigh_in_time,
        platforms: []
      });
    }

    const session = dayData.sessions.get(row.session_id)!;
    session.platforms.push({
      platform: validatePlatform(row.platform),
      weightClass: row.weight_class,
      platformStartTime: row.start_time // Include platform-specific start time
    });
  });

  const transformedSchedule = Array.from(scheduleMap.values()).map(day => {
    // Sort sessions by their platforms
    const sortedSessions = Array.from(day.sessions.values()).map(session => {
      // Sort platforms according to platformOrder
      const sortedPlatforms = session.platforms.sort((a, b) => {
        const indexA = platformOrder.indexOf(a.platform);
        const indexB = platformOrder.indexOf(b.platform);
        return indexA - indexB;
      });
      
      return {
        ...session,
        platforms: sortedPlatforms
      };
    });
    
    return {
      ...day,
      sessions: sortedSessions
    };
  });

  console.log('Transformed schedule:', transformedSchedule);
  return transformedSchedule;
}

export async function fetchSchedule(meet: MeetName): Promise<Schedule> {
  console.log('fetchSchedule called for meet:', meet);
  try {
    const dbSchedule = await fetchScheduleFromDb(meet);
    return transformScheduleData(dbSchedule);
  } catch (error) {
    console.error('Error in fetchSchedule:', error);
    throw error;
  }
}

export async function fetchAthletes(meet: MeetName): Promise<LiftResult[]> {
  console.log('Fetching athletes for meet:', meet);
  
  const { data, error } = await supabase
    .from('athletes')
    .select('*')
    .eq('meet', meet);

  if (error) {
    console.error('Error fetching athletes:', error);
    throw error;
  }

  console.log('Fetched athletes:', data);
  return data || [];
} 