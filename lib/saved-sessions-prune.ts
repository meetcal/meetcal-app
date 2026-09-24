import { convertToUTC, getMeetConfig } from '@/data/meets/config';
import { MeetName } from '@/data/types/meet';
import { fetchUserPreferences } from '@/lib/api/meetcal-api';
import { tokenBelongsTo } from '@/lib/saved-sessions-outbox';
import type { SavedSession } from '@/lib/saved-sessions-store';
import { hasSessionPassedAutoUnsaveWindow } from '@/utils/time';

/**
 * The "auto-remove saved sessions 2 hours after they start" preference. The
 * backend stores the flag; the client applies it after each load.
 */

/**
 * Ids of the sessions that have passed the auto-unsave window at `now`.
 * Start times are meet-local, so each meet's time zone is looked up once
 * (UTC when its config cannot be read). Rows with no start time or date, or
 * whose time does not convert, are kept.
 */
export async function findExpiredSessionIds(
  sessions: SavedSession[],
  now: Date,
): Promise<string[]> {
  const timeZoneByMeet = new Map<MeetName, string>();
  const expiredIds: string[] = [];

  for (const session of sessions) {
    if (!session.startTime || !session.date) continue;

    let timeZone = timeZoneByMeet.get(session.meet);
    if (timeZone === undefined) {
      try {
        const config = await getMeetConfig(session.meet);
        timeZone = config?.time?.timeZoneIdentifier ?? 'UTC';
      } catch {
        timeZone = 'UTC';
      }
      timeZoneByMeet.set(session.meet, timeZone);
    }

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
  try {
    const prefs = await fetchUserPreferences(token);
    autoUnsaveEnabled = prefs.auto_unsave_started_sessions;
  } catch (error) {
    console.error('pruneStartedSessions: failed to fetch preferences', error);
    return;
  }
  if (!autoUnsaveEnabled || !stillThisUser()) return;

  const sessions = await deps.readStoredSessions();
  if (sessions.length === 0 || !stillThisUser()) return;

  const expiredIds = await findExpiredSessionIds(sessions, new Date());

  for (const id of expiredIds) {
    if (!stillThisUser()) return;
    await deps.removeSession(id);
  }
}
