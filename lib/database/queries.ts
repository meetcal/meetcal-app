import { supabase } from '@/lib/supabase';
import { Schedule, Session } from '@/types/schedule';
import { MeetName } from '@/data/types/meet';
import { Platform } from '@/data/types/athletes';
import type { LiftResult } from '@/data/types/athletes';

type DbSchedule = {
  id: number;
  date: string;
  session_id: number;
  start_time: string;
  weigh_in_time: string;
  platform: Platform;
  weight_class: string;
  meet: string;
};

export async function fetchScheduleFromDb(meet: MeetName): Promise<DbSchedule[]> {
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

  return data || [];
}

// Transform DB data to match our Schedule type
export function transformScheduleData(dbSchedule: DbSchedule[]): Schedule {
  const scheduleMap = new Map<string, {
    date: string;
    fullDate: string;
    sessions: Map<number, Session>;
  }>();

  dbSchedule.forEach(row => {
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
      platform: row.platform,
      weightClass: row.weight_class
    });
  });

  return Array.from(scheduleMap.values()).map(day => ({
    ...day,
    sessions: Array.from(day.sessions.values())
  }));
}

export async function fetchSchedule(): Promise<Schedule> {
  const response = await fetch('/api/schedule');
  if (!response.ok) {
    throw new Error('Failed to fetch schedule');
  }
  return response.json();
}

export async function fetchAthletes(): Promise<LiftResult[]> {
  const response = await fetch('/api/athletes');
  if (!response.ok) {
    throw new Error('Failed to fetch athletes');
  }
  return response.json();
} 