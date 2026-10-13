import { convertToUTC, getMeetConfig } from '@/data/meets/config';
import { MeetName } from '@/data/types/meet';
import {
  fetchUserPreferences,
  refreshServerClock,
  MAX_PLAUSIBLE_CLOCK_SKEW_MS,
} from '@/lib/api/meetcal-api';
import { devLog } from '@/lib/logger';
import { buildSessionScheduleLookup, withScheduleTimes } from '@/lib/saved-schedule-lookup';
import { tokenBelongsTo } from '@/lib/saved-sessions-outbox';
import type { SavedSession } from '@/lib/saved-sessions-store';
import type { SessionScheduleLookup } from '@/types/saved';
import type { Schedule } from '@/types/schedule';
import { hasSessionPassedAutoUnsaveWindow } from '@/utils/time';
import { resolvedMeetTimeZone } from '@/utils/timezone';

/**
 * The "auto-remove saved sessions 2 hours after they start" preference. The
 * backend stores the flag; the client applies it after each load.
 */

/**
 * Ids of the sessions that have passed the auto-unsave window at `now`.
 * Start times are meet-local, so each meet's time zone is looked up once.
 * Rows with no start time on either the saved row or the schedule, whose
 * saved time does not convert, or whose meet's time zone is unknown are kept.
 * A meet whose zone the API left blank is unknown too
 * (`resolvedMeetTimeZone`): its New York fallback deleted a Los Angeles
 * session three hours early.
 *
 * The zone lookup used to fall back to UTC. A meet outside the cached list
 * whose `/meets/details` request failed (venue Wi-Fi) then had its wall-clock
 * times read as UTC: a 9:00 AM Los Angeles session "started" at 2:00 AM local
 * and was deleted, server copy and notes included, before it began. Pruning
 * is destructive, so an unknown zone keeps the rows until a later load can
 * resolve it.
 *
 * `readSchedule` supplies the meet's current schedule. A saved row keeps the
 * start time it was saved with, so a session USAW moved from 9:00 AM to
 * 2:00 PM was deleted at 11:00 AM, notes and server copy included, before it
 * started. A row is pruned only once the later of its saved start and its
 * schedule start is past the window: the offline schedule copy can be older
 * than a row saved from a fresh fetch, and pruning is destructive, so the
 * more cautious of the two wins. A row saved before the schedule was
 * published has no saved start, and is judged by the schedule's alone, as the
 * reminders, the widget and the Saved card already did; it used to be kept
 * forever.
 */
export async function findExpiredSessionIds(
  sessions: SavedSession[],
  now: Date,
  readSchedule?: (meet: MeetName) => Promise<Schedule>,
): Promise<string[]> {
  // `null`: the meet's zone could not be resolved, so its rows are kept.
  const timeZoneByMeet = new Map<MeetName, string | null>();
  const lookupByMeet = new Map<MeetName, Map<string, SessionScheduleLookup> | null>();
  const expiredIds: string[] = [];

  const startOf = (session: SavedSession, timeZone: string): number | null => {
    if (!session.startTime || !session.date) return null;
    try {
      const startMs = convertToUTC(session.startTime, session.date, timeZone).getTime();
      return Number.isNaN(startMs) ? null : startMs;
    } catch {
      return null;
    }
  };

  for (const session of sessions) {
    const hasSavedStart = Boolean(session.startTime && session.date);
    // With no saved start and no schedule to read, there is nothing to judge.
    if (!hasSavedStart && !readSchedule) continue;

    let timeZone = timeZoneByMeet.get(session.meet);
    if (timeZone === undefined) {
      try {
        timeZone = resolvedMeetTimeZone(await getMeetConfig(session.meet));
      } catch {
        timeZone = null;
      }
      timeZoneByMeet.set(session.meet, timeZone);
    }
    if (timeZone === null) continue;

    // A saved start that is there but does not convert is a corrupt row:
    // keep it rather than trust anything else about it.
    const savedStart = hasSavedStart ? startOf(session, timeZone) : null;
    if (hasSavedStart && savedStart === null) continue;

    let lookup = lookupByMeet.get(session.meet);
    if (lookup === undefined) {
      const schedule = readSchedule
        ? await readSchedule(session.meet).catch(() => [] as Schedule)
        : [];
      lookup = schedule.length > 0 ? buildSessionScheduleLookup(schedule) : null;
      lookupByMeet.set(session.meet, lookup);
    }
    const scheduled = withScheduleTimes(session, lookup);
    const scheduleStart = scheduled === session ? null : startOf(scheduled, timeZone);
    const latestStart =
      savedStart === null ? scheduleStart : Math.max(savedStart, scheduleStart ?? savedStart);
    if (latestStart === null) continue;

    if (hasSessionPassedAutoUnsaveWindow(new Date(latestStart), now)) {
      expiredIds.push(session.id);
    }
  }
  return expiredIds;
}

export interface PruneStartedSessionsDeps {
  /** The Clerk-verified user; nothing is pruned without one. */
  clerkUserId: string | null | undefined;
  /**
   * The subscription as RevenueCat confirmed it (`null` until it answers;
   * never the cached hint). Auto-remove is a premium setting: nothing is
   * pruned unless this is `true`.
   */
  isSubscribed: () => boolean | null;
  /** Whether `userId` is still the active user. */
  isActive: (userId: string) => boolean;
  getToken: () => Promise<string | null>;
  readStoredSessions: () => Promise<SavedSession[]>;
  removeSession: (sessionId: string) => Promise<boolean>;
  /** The meet's current schedule, so a moved session is judged by its new time. */
  readSchedule?: (meet: MeetName) => Promise<Schedule>;
}

/**
 * Remove saved sessions that started more than 2 hours ago, when the user
 * has the preference enabled and is subscribed.
 *
 * The server stores the preference with no entitlement check, so it outlives
 * a lapsed subscription. Only the stored flag used to be read: a lapsed user
 * kept losing sessions (server copy and notes included) while Profile showed
 * the setting off and locked. Unconfirmed (RevenueCat still loading, or only
 * the cached hint, which can be days stale) skips too: pruning is
 * destructive, and late is harmless.
 *
 * Destructive, and it spans several awaits: every step re-checks that the
 * signed-in user is still the one whose sessions and preference these are.
 * Otherwise an account switch mid-prune could apply user B's preference to
 * user A's list and queue deletions in A's outbox.
 */
export async function pruneStartedSessions(deps: PruneStartedSessionsDeps): Promise<void> {
  if (!deps.clerkUserId || deps.isSubscribed() !== true) return;
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
  // copy included, before they began. A sample is taken now (requests no
  // longer carry the server's time); without one, or with the device
  // implausibly far off, skip.
  const clock = await refreshServerClock();
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

  const expiredIds = await findExpiredSessionIds(
    sessions,
    new Date(Date.now() + clock.skewMs),
    deps.readSchedule,
  );

  for (const id of expiredIds) {
    if (!stillThisUser() || deps.isSubscribed() !== true) return;
    await deps.removeSession(id);
  }
}
