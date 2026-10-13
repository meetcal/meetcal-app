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
  /** The zone as the API sent it (blank when the meet has none). */
  timeZone: string;
  /**
   * The IANA zone every meet-local time is read in: any zone the device's
   * `Intl` knows ("America/Chicago", "Asia/Tokyo", "Australia/Sydney"), or
   * the fallback when the API's is blank or unknown (`timeZoneUnknown`).
   */
  timeZoneIdentifier: string;
  /** The label shown after a time: "EDT", or "GMT+9" for a zone with no lettered name. */
  abbreviation: string;
  /** Hours west of UTC on the meet's start date (4 for EDT, -5.5 for India). */
  utcOffset: number;
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
  /**
   * `time` is the mapper's fallback zone, not the meet's (see `Meet`). Read
   * it through `resolvedMeetTimeZone` (utils/timezone.ts) before computing an
   * instant.
   */
  timeZoneUnknown?: boolean;
}

export interface Meet {
  id: string;
  name: MeetName;
  venue: Venue;
  venueMapPdfUrl?: string | null;
  venueMapAppleUrl?: string | null;
  time: TimeConfig;
  dates: DateRange;
  status: 'upcoming' | 'ongoing' | 'completed';
  /**
   * True when the API sent a time zone the app does not recognise and the
   * mapper fell back to a default, so this meet's times may be off. Set by
   * `mapApiMeet`; absent on meets from other sources.
   */
  timeZoneUnknown?: boolean;
  // Additional meet-specific settings can be added here
  settings?: {
    [key: string]: unknown;
  };
}

/**
 * Type guard to check if a string is a valid MeetName
 */
export function isMeetName(
  meet: string | null,
  allowedNames?: ReadonlySet<string>,
): meet is MeetName {
  if (meet === null || typeof meet !== "string") return false;
  if (allowedNames !== undefined) return allowedNames.has(meet);
  return true;
} 