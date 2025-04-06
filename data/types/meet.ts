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

export interface TimeConfig {
  timeZone: string;
  timeZoneIdentifier: string;
}

export interface DateRange {
  start: string;
  end: string;
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