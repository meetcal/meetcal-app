import type { Doc } from '../_generated/dataModel';
import { meetLocalDate, type ZoneFormatters } from './meetData';

export type MeetStatus = Doc<'meets'>['status'];

/**
 * A meet's status, worked out from its dates on its own calendar rather
 * than kept: `completed` once its end date has passed, `ongoing` from its
 * first day through its last, `upcoming` before. So a meet whose dates move
 * into the future (a corrected typo, a postponement) is upcoming again, and
 * a meet in progress says so, without each client re-deriving it.
 */
export function meetStatusOn(meet: Pick<Doc<'meets'>, 'startDate' | 'endDate'>, localToday: string): MeetStatus {
  if (meet.endDate < localToday) return 'completed';
  if (meet.startDate <= localToday) return 'ongoing';
  return 'upcoming';
}

/** `meetStatusOn` at `instant`, on the wall calendar of the meet's time zone. */
export function meetStatusAt(
  meet: Pick<Doc<'meets'>, 'startDate' | 'endDate'> & { timeZone?: string },
  instant: number,
  formatters: ZoneFormatters = new Map(),
): MeetStatus {
  return meetStatusOn(meet, meetLocalDate(instant, meet.timeZone ?? '', formatters));
}

/**
 * The earliest calendar date any place is on at `instant` (UTC-12 is the
 * furthest behind): a meet ending on or after it may not have ended yet.
 */
export function earliestLocalDate(instant: number): string {
  return new Date(instant - 12 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
