import { isSamePlatform } from '@/lib/athletes';
import type { DaySchedule, Platform, Schedule, Session } from '@/types/schedule';

export interface SessionPlatformMatch {
  /** The first day that schedules a session with this number. */
  day: DaySchedule;
  session: Session;
  /** The session's row for the platform, or `null` when it has none. */
  platform: Platform | null;
}

/**
 * The schedule's session numbered `sessionNumber`, the day it is on, and its
 * row for `platform` (matched the way every platform comparison in the app
 * is, via `isSamePlatform`). `null` when no day schedules that session.
 *
 * The session details screen used to repeat this walk three times, once per
 * value it needed from the result.
 */
export function findSessionPlatform(
  schedule: Schedule,
  sessionNumber: number,
  platform: string | null | undefined,
): SessionPlatformMatch | null {
  for (const day of schedule) {
    const session = day.sessions.find((s) => s.number === sessionNumber);
    if (!session) continue;
    const platformRow =
      session.platforms.find((p) => isSamePlatform(p.platform, platform)) ?? null;
    return { day, session, platform: platformRow };
  }
  return null;
}
