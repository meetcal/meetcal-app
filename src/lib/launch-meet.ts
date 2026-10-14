import type { Meet } from '@/data/types/meet';
import {
  getAnywhereOnEarthDate,
  getCalendarDateInTimeZone,
  toMeetCalendarDate,
} from '@/utils/dateTime';
import { resolvedMeetTimeZone } from '@/utils/timezone';

type CompletionSource = Pick<Meet, 'status' | 'dates' | 'time' | 'timeZoneUnknown'>;

/**
 * Whether a meet is over at `now`: the server says so, or its last day has
 * passed on its own calendar (`meetStatusAt` in `convex/lib/meetStatus.ts`,
 * the rule the server's status comes from). The date check covers a copy
 * whose status was fetched before the meet ended: the cached `/meets` list,
 * or details persisted for an offline start. A meet with no known zone is
 * read on the last calendar on Earth (UTC-12), so it is never over early.
 */
export function isMeetCompleted(meet: CompletionSource, now: Date): boolean {
  if (meet.status === 'completed') return true;
  const end = toMeetCalendarDate(meet.dates?.end) || toMeetCalendarDate(meet.dates?.start);
  if (!end) return false;
  const zone = resolvedMeetTimeZone(meet);
  const today = zone ? getCalendarDateInTimeZone(zone, now) : getAnywhereOnEarthDate(now);
  return end < today;
}

/**
 * The meet to open the app on: the stored (last selected) meet while it is
 * not over, else the first meet in `meets` that is not over. `meets` is the
 * `/meets` list, soonest first, as the meet picker shows it. When every meet
 * is over (a stale cache offline) the stored meet, then the first, still
 * beats an empty schedule.
 */
export function chooseLaunchMeet(
  meets: readonly Meet[],
  stored: string | null,
  now: Date,
): Meet | null {
  const storedMeet = stored ? meets.find((meet) => meet.name === stored) : undefined;
  if (storedMeet && !isMeetCompleted(storedMeet, now)) return storedMeet;
  return meets.find((meet) => !isMeetCompleted(meet, now)) ?? storedMeet ?? meets[0] ?? null;
}
