import { Platform } from './athletes';
import { calculateWeighInTime } from '@/utils/time';

export interface PlatformSession {
  platform: Platform;
  weightClass: string;
  platformStartTime?: string;  // Optional platform-specific start time
}

export interface Session {
  id: string;
  number: number;
  startTime: string;
  weighInTime: string;
  platforms: PlatformSession[];
}

export interface ScheduleDay {
  date: string;
  fullDate: string;
  sessions: Session[];
}

export type Schedule = ScheduleDay[];

// Re-export calculateWeighInTime from utils for backwards compatibility
export { calculateWeighInTime };

// Helper functions
export function getSessionTimeRange(session: Session): { start: string; end: string } | null {
  const hasCustomTimes = session.platforms.some(p => p.platformStartTime);
  if (!hasCustomTimes) {
    return null;
  }

  const times = session.platforms.map(p => p.platformStartTime || session.startTime);
  
  const convertTo24h = (timeStr: string) => {
    const [time, period] = timeStr.split(' ');
    const [hours, minutes] = time.split(':').map(Number);
    let hour = hours;
    
    if (period === 'PM' && hours !== 12) {
      hour += 12;
    } else if (period === 'AM' && hours === 12) {
      hour = 0;
    }
    
    return { hour, minutes };
  };

  const sortedTimes = times.sort((a, b) => {
    const timeA = convertTo24h(a);
    const timeB = convertTo24h(b);
    if (timeA.hour === timeB.hour) {
      return timeA.minutes - timeB.minutes;
    }
    return timeA.hour - timeB.hour;
  });

  return {
    start: sortedTimes[0],
    end: sortedTimes[sortedTimes.length - 1]
  };
}

export function getPlatformStartTime(session: Session, platformName: string): string {
  const platform = session.platforms.find(p => p.platform === platformName);
  return platform?.platformStartTime || session.startTime;
}

export function formatTimeRange(timeRange: { start: string; end: string }): string {
  if (timeRange.start === timeRange.end) {
    return timeRange.start;
  }
  return `${timeRange.start}-${timeRange.end}`;
} 