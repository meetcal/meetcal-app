import { MeetConfig, MeetName } from '../types/meet';

export const meetConfigs: { [K in MeetName]: MeetConfig } = {
  'USAW Master\'s Nationals': {
    name: 'USAW Master\'s Nationals',
    venue: {
      name: 'Georgia International Convention Center',
      address: {
        street: '2000 Convention Center Concourse',
        city: 'College Park',
        state: 'GA',
        zip: '30337',
      },
    },
    time: {
      timeZone: 'Eastern Time',
      timeZoneIdentifier: 'America/New_York',
      abbreviation: 'EDT',
      utcOffset: 4, // EDT (UTC-4)
    },
    dates: {
      start: '2025-04-03',
      end: '2025-04-06',
    },
  },
  'USAMW Master\'s Nationals': {
    name: 'USAMW Master\'s Nationals',
    venue: {
      name: 'Boise Expo Center',
      address: {
        street: '5610 North Glenwood Street',
        city: 'Boise',
        state: 'ID',
        zip: '83714',
      },
    },
    time: {
      timeZone: 'Mountain Time',
      timeZoneIdentifier: 'America/Boise',
      abbreviation: 'MDT',
      utcOffset: 6, // MDT (UTC-6)
    },
    dates: {
      start: '2025-03-26',
      end: '2025-03-30',
    },
  },
};

export function getMeetConfig(meetName: MeetName): MeetConfig {
  return meetConfigs[meetName];
}

export function getDefaultMeet(): MeetName {
  return 'USAW Master\'s Nationals';
}

export function isValidMeet(meetName: string): meetName is MeetName {
  return meetName in meetConfigs;
}

// Time zone utility functions
export function convertToUTC(
  timeStr: string,
  dateStr: string,
  meet: MeetName
): Date {
  const config = getMeetConfig(meet);
  
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
  const config = getMeetConfig(meet);
  return `${formatTo12Hour(timeStr)} ${config.time.abbreviation}`;
}

export function getMeetVenueLocation(meet: MeetName): string {
  const config = getMeetConfig(meet);
  const { venue } = config;
  const { address } = venue;
  
  return `${venue.name}, ${address.street}, ${address.city}, ${address.state} ${address.zip}`;
} 