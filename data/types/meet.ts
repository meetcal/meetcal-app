// Meet configuration types
export type MeetName = string;

export interface Venue {
  name: string;
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
}

// US timezone identifiers
export type USTimeZoneIdentifier = 
  | 'America/New_York'    // Eastern
  | 'America/Chicago'     // Central
  | 'America/Denver'      // Mountain
  | 'America/Phoenix'     // Mountain (no DST)
  | 'America/Los_Angeles' // Pacific
  | 'America/Anchorage'   // Alaska
  | 'Pacific/Honolulu';   // Hawaii

// Mapping of timezone identifiers to their UTC offsets
export const timezoneOffsets: { [K in USTimeZoneIdentifier]: { standard: number; dst: number } } = {
  'America/New_York': { standard: 5, dst: 4 },     // EST/EDT
  'America/Chicago': { standard: 6, dst: 5 },      // CST/CDT
  'America/Denver': { standard: 7, dst: 6 },       // MST/MDT
  'America/Phoenix': { standard: 7, dst: 7 },      // MST (no DST)
  'America/Los_Angeles': { standard: 8, dst: 7 },  // PST/PDT
  'America/Anchorage': { standard: 9, dst: 8 },    // AKST/AKDT
  'Pacific/Honolulu': { standard: 10, dst: 10 },   // HST (no DST)
};

export interface TimeConfig {
  timeZone: string;
  timeZoneIdentifier: USTimeZoneIdentifier;
  abbreviation: string;
  utcOffset: number; // Current offset (either standard or DST)
}

export interface DateRange {
  start: string;
  end: string;
}

export interface MeetConfig {
  name: MeetName;
  venue: Venue;
  time: TimeConfig;
  dates: DateRange;
}

export interface Meet {
  id: string;
  name: MeetName;
  venue: Venue;
  time: TimeConfig;
  dates: DateRange;
  status: 'upcoming' | 'ongoing' | 'completed';
  // Additional meet-specific settings can be added here
  settings?: {
    [key: string]: unknown;
  };
}

// Utility type for meet-specific data
export type MeetSpecificData<T> = {
  [key: string]: T;
};

// Helper type for accessing meet-specific data
export type MeetDataAccessor<T> = (meetName: MeetName) => T; 