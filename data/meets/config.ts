import { MeetConfig, MeetName } from '../types/meet';
import { fetchMeetByName } from '@/lib/database/meet-manager';

// Cache for meet configs to avoid repeated fetches
const meetConfigCache: { [key: string]: MeetConfig } = {};

export async function getMeetConfig(meetName: MeetName): Promise<MeetConfig> {
  // Check cache first
  if (meetConfigCache[meetName]) {
    return meetConfigCache[meetName];
  }

  // Fetch from Supabase
  const meet = await fetchMeetByName(meetName);
  if (!meet) {
    throw new Error(`Meet not found: ${meetName}`);
  }

  // Create config from meet data
  const config: MeetConfig = {
    name: meet.name,
    venue: meet.venue,
    time: meet.time,
    dates: meet.dates,
  };

  // Cache the config
  meetConfigCache[meetName] = config;
  return config;
}

// Time zone utility functions
export function convertToUTC(
  timeStr: string,
  dateStr: string,
  meet: MeetName
): Date {
  const config = meetConfigCache[meet];
  if (!config) {
    throw new Error('Meet config not found. Make sure to call getMeetConfig first.');
  }
  
  // Parse time string (format: "8:00 AM")
  const [time, period] = timeStr.split(' ');
  const [hours, minutes] = time.split(':').map(Number);
  
  // Convert to 24-hour format
  let adjustedHours = hours;
  if (period === 'PM' && hours !== 12) {
    adjustedHours += 12;
  } else if (period === 'AM' && hours === 12) {
    adjustedHours = 0;
  }

  // Parse date string (format: "YYYY-MM-DD")
  const [year, month, day] = dateStr.split('-').map(Number);
  
  // Create Date object in UTC, adding the correct offset for the meet's time zone
  return new Date(Date.UTC(year, month - 1, day, adjustedHours + config.time.utcOffset, minutes));
}

// Convert 24-hour time to 12-hour time without seconds
function formatTo12Hour(timeStr: string): string {
  // If already in 12-hour format with AM/PM, just remove seconds
  if (timeStr.includes('AM') || timeStr.includes('PM')) {
    const [time, period] = timeStr.split(' ');
    const [hours, minutes] = time.split(':');
    return `${hours}:${minutes} ${period}`;
  }

  // Convert from 24-hour format
  const [hours, minutes] = timeStr.split(':');
  const hour = parseInt(hours, 10);
  let period = 'AM';
  let hour12 = hour;

  if (hour === 0) {
    hour12 = 12;
  } else if (hour === 12) {
    period = 'PM';
  } else if (hour > 12) {
    hour12 = hour - 12;
    period = 'PM';
  }

  return `${hour12}:${minutes} ${period}`;
}

export function formatTimeWithZone(timeStr: string, meet: MeetName): string {
  const config = meetConfigCache[meet];
  if (!config) {
    throw new Error('Meet config not found. Make sure to call getMeetConfig first.');
  }
  return `${formatTo12Hour(timeStr)} ${config.time.abbreviation}`;
}

export function getMeetVenueLocation(meet: MeetName): string {
  const config = meetConfigCache[meet];
  if (!config) {
    throw new Error('Meet config not found. Make sure to call getMeetConfig first.');
  }
  const { venue } = config;
  const { address } = venue;
  
  return `${venue.name}, ${address.street}, ${address.city}, ${address.state} ${address.zip}`;
} 