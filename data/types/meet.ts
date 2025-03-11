// Meet configuration types
export type MeetName = 'USAW Master\'s Nationals' | 'USAMW Master\'s Nationals';

export interface VenueConfig {
  name: string;
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
}

export interface TimeConfig {
  timeZone: string;
  timeZoneIdentifier: string; // e.g., 'America/New_York'
}

export interface MeetConfig {
  name: MeetName;
  venue: VenueConfig;
  time: TimeConfig;
  dates: {
    start: string;
    end: string;
  };
  // Additional meet-specific settings can be added here
  settings?: {
    [key: string]: unknown;
  };
}

// Utility type for meet-specific data
export type MeetSpecificData<T> = {
  [K in MeetName]: T;
};

// Helper type for accessing meet-specific data
export type MeetDataAccessor<T> = (meetName: MeetName) => T; 