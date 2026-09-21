import { MeetConfig, MeetName } from '../types/meet';
import { fetchMeetByName } from '@/lib/database/meet-manager';
import { convertZonedLocalToUTC } from '@/utils/timezone';

/**
 * How long a resolved `MeetConfig` is reused before it is re-derived.
 *
 * This used to be a process-lifetime cache with no invalidation, while
 * `SelectedMeetContext` re-fetches the meets list every five minutes and on
 * every reconnect. So an organizer correcting a meet's timezone or dates
 * server-side showed up on the schedule within five minutes, but calendar
 * exports (`utils/calendar.ts`) and session notification instants
 * (`useSavedSessions`) kept converting against the first config the process
 * ever saw — an hour off, with the wrong zone abbreviation, until the user
 * force-quit the app. Matched to the meets refresh interval so the two cannot
 * disagree for longer than one cycle.
 */
const MEET_CONFIG_TTL_MS = 5 * 60 * 1000;

type CachedMeetConfig = { config: MeetConfig; fetchedAt: number };

const meetConfigCache = new Map<string, CachedMeetConfig>();

/** Drop cached configs so the next read re-derives them. Test seam + reset. */
export function clearMeetConfigCache(meetName?: MeetName): void {
  if (meetName === undefined) {
    meetConfigCache.clear();
    return;
  }
  meetConfigCache.delete(meetName);
}

export async function getMeetConfig(meetName: MeetName): Promise<MeetConfig> {
  const cached = meetConfigCache.get(meetName);
  if (cached && Date.now() - cached.fetchedAt < MEET_CONFIG_TTL_MS) {
    return cached.config;
  }

  const meet = await fetchMeetByName(meetName);
  if (!meet) {
    // Offline, or the meet has been withdrawn. A stale config is still the
    // right answer for an already-saved session's timezone — far better than
    // throwing and taking down the auto-unsave sweep and calendar export.
    if (cached) return cached.config;
    throw new Error(`Meet not found: ${meetName}`);
  }

  const config: MeetConfig = {
    name: meet.name,
    venue: meet.venue,
    time: meet.time,
    dates: meet.dates,
  };

  meetConfigCache.set(meetName, { config, fetchedAt: Date.now() });
  return config;
}

// Time zone utility functions
export function convertToUTC(
  timeStr: string,
  dateStr: string,
  timeZoneIdentifier: string,
): Date {
  return convertZonedLocalToUTC(dateStr, timeStr, timeZoneIdentifier);
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
  const config = meetConfigCache.get(meet)?.config;
  if (!config) {
    throw new Error('Meet config not found. Make sure to call getMeetConfig first.');
  }
  return `${formatTo12Hour(timeStr)} ${config.time.abbreviation}`;
}

export function getMeetVenueLocation(meet: MeetName): string {
  const config = meetConfigCache.get(meet)?.config;
  if (!config) {
    throw new Error('Meet config not found. Make sure to call getMeetConfig first.');
  }
  const { venue } = config;
  const { address } = venue;
  
  return `${venue.name}, ${address.street}, ${address.city}, ${address.state} ${address.zip}`;
} 
