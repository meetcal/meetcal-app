import { Platform } from './athletes';

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

// Helper functions
export function calculateWeighInTime(startTime: string): string {
  const [time, period] = startTime.split(' ');
  const [hours, minutes] = time.split(':').map(Number);
  
  let weighInHour = hours - 2;
  let weighInPeriod = period;
  
  if (period === 'PM' && hours !== 12) {
    weighInHour = hours + 12 - 2;
  } else if (period === 'AM' && hours === 12) {
    weighInHour = 10;
    weighInPeriod = 'PM';
  } else if (weighInHour < 0) {
    weighInHour = 12 + weighInHour;
    weighInPeriod = period === 'AM' ? 'PM' : 'AM';
  } else if (weighInHour === 0) {
    weighInHour = 12;
    weighInPeriod = 'AM';
  }
  
  return `${weighInHour}:${minutes.toString().padStart(2, '0')} ${weighInPeriod}`;
}

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