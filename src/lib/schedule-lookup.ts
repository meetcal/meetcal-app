import { isSamePlatform } from '@/lib/athletes';
import type { DaySchedule, Platform, Schedule, Session } from '@/types/schedule';
import { resolveWeighInTime } from '@/utils/time';

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

/**
 * A platform-session's start time (the platform's own, else the session's)
 * and its weigh-in by `resolveWeighInTime`: the platform row's published
 * weigh-in, else start minus 2 h. A schedule cached before platform rows kept
 * their own weigh-in has only the session's (its first row's), which holds
 * only for a platform starting when the session does.
 */
export function platformSessionTimes(
  session: Pick<Session, 'startTime' | 'weighInTime'>,
  platform: Pick<Platform, 'platformStartTime' | 'platformWeighInTime'> | null | undefined,
): { startTime: string; weighInTime: string } {
  const startTime = platform?.platformStartTime || session.startTime || '';
  const published =
    platform?.platformWeighInTime !== undefined
      ? platform.platformWeighInTime
      : startTime === session.startTime
        ? session.weighInTime
        : '';
  return { startTime, weighInTime: resolveWeighInTime(startTime, published) };
}
