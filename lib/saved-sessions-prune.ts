import { convertToUTC, getMeetConfig } from '@/data/meets/config';
import { MeetName } from '@/data/types/meet';
import {
  fetchUserPreferences,
  getServerClockSample,
  MAX_PLAUSIBLE_CLOCK_SKEW_MS,
} from '@/lib/api/meetcal-api';
import { devLog } from '@/lib/logger';
import { tokenBelongsTo } from '@/lib/saved-sessions-outbox';
import type { SavedSession } from '@/lib/saved-sessions-store';
import { hasSessionPassedAutoUnsaveWindow } from '@/utils/time';

/**
 * The "auto-remove saved sessions 2 hours after they start" preference. The
 * backend stores the flag; the client applies it after each load.
 */

/**
 * Ids of the sessions that have passed the auto-unsave window at `now`.
 * Start times are meet-local, so each meet's time zone is looked up once.
 * Rows with no start time or date, whose time does not convert, or whose
 * meet's time zone cannot be resolved are kept.
 *
 * The zone lookup used to fall back to UTC. A meet outside the cached list
 * whose `/meets/details` request failed (venue Wi-Fi) then had its wall-clock
 * times read as UTC: a 9:00 AM Los Angeles session "started" at 2:00 AM local
 * and was deleted, server copy and notes included, before it began. Pruning
 * is destructive, so an unknown zone keeps the rows until a later load can
 * resolve it.
 */
export async function findExpiredSessionIds(
  sessions: SavedSession[],
  now: Date,
): Promise<string[]> {
  // `null`: the meet's zone could not be resolved, so its rows are kept.
  const timeZoneByMeet = new Map<MeetName, string | null>();
  const expiredIds: string[] = [];

  for (const session of sessions) {
    if (!session.startTime || !session.date) continue;

    let timeZone = timeZoneByMeet.get(session.meet);
    if (timeZone === undefined) {
      try {
        const config = await getMeetConfig(session.meet);
        timeZone = config?.time?.timeZoneIdentifier || null;
      } catch {
        timeZone = null;
      }
      timeZoneByMeet.set(session.meet, timeZone);
    }
    if (timeZone === null) continue;

    let sessionStart: Date;
    try {
      sessionStart = convertToUTC(session.startTime, session.date, timeZone);
    } catch {
      continue;
    }

    if (hasSessionPassedAutoUnsaveWindow(sessionStart, now)) {
      expiredIds.push(session.id);
    }
  }
  return expiredIds;
}

export interface PruneStartedSessionsDeps {
  /** The Clerk-verified user; nothing is pruned without one. */
  clerkUserId: string | null | undefined;
  /** Whether `userId` is still the active user. */
  isActive: (userId: string) => boolean;
  getToken: () => Promise<string | null>;
  readStoredSessions: () => Promise<SavedSession[]>;
  removeSession: (sessionId: string) => Promise<boolean>;
}

/**
 * Remove saved sessions that started more than 2 hours ago, when the user
 * has the preference enabled.
 *
 * Destructive, and it spans several awaits: every step re-checks that the
 * signed-in user is still the one whose sessions and preference these are.
 * Otherwise an account switch mid-prune could apply user B's preference to
 * user A's list and queue deletions in A's outbox.
 */
export async function pruneStartedSessions(deps: PruneStartedSessionsDeps): Promise<void> {
  if (!deps.clerkUserId) return;
  const userId = deps.clerkUserId;
  const stillThisUser = () => deps.isActive(userId);

  let token: string | null = null;
  try {
    token = await deps.getToken();
  } catch (tokenError) {
    // Pruning is destructive, so a token failure must skip it rather than
    // guess at the preference (PoT #7).
    console.error('pruneStartedSessions: Clerk getToken() failed', tokenError);
    return;
  }
  if (!token || !stillThisUser() || !tokenBelongsTo(token, userId)) return;

  let autoUnsaveEnabled = false;
  const requestedAt = Date.now();
  try {
    const prefs = await fetchUserPreferences(token);
    autoUnsaveEnabled = prefs.auto_unsave_started_sessions;
  } catch (error) {
    console.error('pruneStartedSessions: failed to fetch preferences', error);
    return;
  }
  if (!autoUnsaveEnabled || !stillThisUser()) return;

  // "Started two hours ago" on the server's clock, not the device's: a
  // device clock two hours fast deleted today's sessions, notes and server
  // copy included, before they began. The preferences request just made is
  // the sample; without one, or with the device implausibly far off, skip.
  const clock = getServerClockSample();
  if (!clock || clock.sampledAt < requestedAt) {
    devLog('pruneStartedSessions: no fresh server clock sample, skipping');
    return;
  }
  if (Math.abs(clock.skewMs) > MAX_PLAUSIBLE_CLOCK_SKEW_MS) {
    devLog('pruneStartedSessions: device clock is off by', clock.skewMs, 'ms, skipping');
    return;
  }

  const sessions = await deps.readStoredSessions();
  if (sessions.length === 0 || !stillThisUser()) return;

  const expiredIds = await findExpiredSessionIds(sessions, new Date(Date.now() + clock.skewMs));

  for (const id of expiredIds) {
    if (!stillThisUser()) return;
    await deps.removeSession(id);
  }
}
