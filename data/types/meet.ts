// Meet configuration types
export type MeetName = 'USAW Master\'s Nationals' | 'Florida WSO Champs';

interface Address {
  street: string;
  city: string;
  state: string;
  zip: string;
}

interface Venue {
  name: string;
  address: Address;
}

interface TimeConfig {
  timeZone: string;
  timeZoneIdentifier: string;
  abbreviation: string;
  utcOffset: number;
}

interface DateRange {
  start: string;
  end: string;
}

export interface MeetConfig {
  name: MeetName;
  venue: Venue;
  time: TimeConfig;
  dates: DateRange;
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