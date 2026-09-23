import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LiftResult } from '@/data/types/athletes';
import { MeetName } from '@/data/types/meet';
import { calculateWeighInTime, hasSessionPassedAutoUnsaveWindow } from '@/utils/time';
import { useAuth, useUser } from '@clerk/expo';
import {
  cancelNotification,
  NOTIFICATION_ENABLED_KEY,
  scheduleNotification,
} from '@/utils/notifications';
import { getPlatformStartTime } from '@/data/types/schedule';
import { fetchSchedule } from '@/lib/database/queries'; // Import fetchSchedule
import { convertToUTC, getMeetConfig } from '@/data/meets/config'; // Import convertToUTC and getMeetConfig for proper timezone handling
import { useSelectedMeet } from '@/contexts/SelectedMeetContext';
import { syncSavedWidget, clearSavedWidget } from '@/utils/savedWidget';
import { reindexAppEntities } from '@/utils/appIntents';
import type { Schedule as ScheduleType } from '@/types/schedule';
import { getMeetData } from '@/lib/database/offline-store';
import { getCachedAuthState } from '@/lib/authCache';
import { subscribeToNetworkChanges } from '@/lib/networkUtils';
import { posthog } from '@/lib/posthog';
import { generateSessionId, getSavedSessionsKey } from '@/utils/session';
import {
  deleteSavedSessions as deleteSavedSessionsFromApi,
  fetchSavedSessions,
  fetchUserPreferences,
  putSavedSession,
  MeetCalApiError,
  MeetCalApiTimeoutError,
} from '@/lib/api/meetcal-api';
import { devLog } from '@/lib/logger';
import {
  capAthleteNames,
  classifySyncError,
  clearResetPending,
  clearSessionPending,
  countPendingWrites,
  deletePendingSession,
  markResetPending,
  markSessionPending,
  mergeServerSessions,
  readOutbox,
  replayOutbox,
  toSavedSessionBody,
} from '@/lib/saved-sessions-outbox';
import {
  findLegacySessionsNeedingMigration,
  removeLegacySavedSessionsKey,
  resetLegacySavedSessions,
} from '@/lib/saved-sessions-legacy';
import { createSerialQueue } from '@/lib/saved-sessions-queue';

export interface SavedSession {
  id: string;
  meet: MeetName;
  sessionNumber: number;
  platform: string;
  weightClass: string;
  startTime: string;
  weighInTime: string;
  date: string;
  notes?: string;
  athleteNames?: string[];
  athleteName?: string; // For backward compatibility
}

/** A session reminder fires this long before the session's start time. */
const NOTIFICATION_LEAD_MS = 60 * 60 * 1000;

/**
 * Saving a session used to emit ~15 `console.log` lines — including the same
 * instant formatted in three timezones — on every save, in production. Keep
 * the trace, keep it out of release builds.
 */
function logNotificationScheduling(step: string, detail?: unknown): void {
  if (!__DEV__) return;
  console.log(`[notifications] ${step}`, detail);
}

/**
 * Read one persisted session, normalising rather than rejecting fields that
 * older builds (or the app itself) wrote as `null`/missing.
 *
 * A row is dropped only when it has no identity: no `id`, `meet`, session
 * number or platform. Everything else defaults, the same way the API branch
 * of the reconcile does. Rejecting on e.g. `weightClass: null` used to drop
 * sessions the app had just written from an unvalidated schedule row — and if
 * the server then answered `[]`, the reconcile removed the key for good.
 */
function normalizeStoredSession(value: unknown): SavedSession | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const text = (field: unknown): string => (typeof field === 'string' ? field : '');

  const sessionNumber =
    typeof row.sessionNumber === 'number'
      ? row.sessionNumber
      : typeof row.sessionNumber === 'string' && row.sessionNumber.trim() !== ''
        ? Number(row.sessionNumber)
        : NaN;
  if (
    typeof row.id !== 'string' || row.id.trim().length === 0 ||
    typeof row.meet !== 'string' || row.meet.trim().length === 0 ||
    !Number.isInteger(sessionNumber) || sessionNumber < 0 ||
    typeof row.platform !== 'string' || row.platform.trim().length === 0
  ) {
    return null;
  }

  const session: SavedSession = {
    ...(row as unknown as SavedSession),
    id: row.id,
    meet: row.meet,
    sessionNumber,
    platform: row.platform,
    weightClass: text(row.weightClass),
    startTime: text(row.startTime),
    weighInTime: text(row.weighInTime),
    date: text(row.date),
  };
  if (typeof row.notes === 'string') session.notes = row.notes;
  else delete session.notes;
  if (typeof row.athleteName === 'string') session.athleteName = row.athleteName;
  else delete session.athleteName;
  if (Array.isArray(row.athleteNames)) {
    session.athleteNames = row.athleteNames.filter(
      (name: unknown): name is string => typeof name === 'string',
    );
  } else {
    delete session.athleteNames;
  }
  return session;
}

function parseStoredSessions(raw: string | null): SavedSession[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const sessions: SavedSession[] = [];
    for (const value of parsed) {
      const session = normalizeStoredSession(value);
      if (session) sessions.push(session);
    }
    return sessions;
  } catch {
    return [];
  }
}

export function useSavedSessions() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const { selectedMeet } = useSelectedMeet();
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [storageUserId, setStorageUserId] = useState<string | null>(null);
  const [hasResolvedUser, setHasResolvedUser] = useState(false);
  /**
   * The API answered 401 to a `/users/me/*` call. The Clerk session Clerk
   * still reports as signed in no longer authorises writes, so nothing is
   * syncing; surfaced in state so a screen can say so instead of the failure
   * living only in the console.
   */
  const [authExpired, setAuthExpired] = useState(false);
  /** Writes recorded in the outbox that have not yet reached the server. */
  const [pendingWriteCount, setPendingWriteCount] = useState(0);
  const sessionsRawRef = useRef<string | null>(null);
  const sessionsRef = useRef<SavedSession[]>([]);
  const pendingWriteCountRef = useRef(0);
  // Clerk's `getToken` identity is not something the effects below should
  // re-run on; they read the latest one through this ref instead.
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  // Every local mutation runs through this queue, so two concurrent saves
  // cannot both read the same list and have the later commit drop the
  // earlier row. Not re-entrant: batch callers loop over the leaf mutations.
  const mutationQueue = useRef(createSerialQueue()).current;
  const clerkUserId = user?.id;
  const activeUserId = clerkUserId ?? storageUserId;

  useEffect(() => {
    let cancelled = false;

    const resolveUser = async () => {
      if (clerkUserId) {
        if (!cancelled) {
          setStorageUserId(clerkUserId);
          setHasResolvedUser(true);
        }
        return;
      }

      const cachedAuthState = await getCachedAuthState().catch(() => null);
      if (cancelled) return;

      if (cachedAuthState?.isSignedIn && cachedAuthState.userId) {
        setStorageUserId(cachedAuthState.userId);
      } else {
        setStorageUserId(null);
      }
      setHasResolvedUser(true);
    };

    resolveUser();
    return () => {
      cancelled = true;
    };
  }, [clerkUserId]);

  useEffect(() => {
    if (!hasResolvedUser || activeUserId) return;
    setSavedSessions([]);
    setIsLoading(false);
    setAuthExpired(false);
    setPendingWriteCount(0);
    pendingWriteCountRef.current = 0;
    clearSavedWidget();
    sessionsRawRef.current = null;
    sessionsRef.current = [];
  }, [hasResolvedUser, activeUserId]);

  useEffect(() => {
    if (!selectedMeet) {
      syncSavedWidget(null, savedSessions);
      void reindexAppEntities();
      return;
    }
    getMeetConfig(selectedMeet)
      .then(config =>
        syncSavedWidget(selectedMeet, savedSessions, config?.time?.timeZoneIdentifier ?? 'UTC')
      )
      .catch(() => syncSavedWidget(selectedMeet, savedSessions, 'UTC'))
      .finally(() => {
        void reindexAppEntities();
      });
  }, [selectedMeet, savedSessions]);

  const commitSessions = useCallback(async (nextSessions: SavedSession[]) => {
    if (!activeUserId) return;
    const serialized = JSON.stringify(nextSessions);
    if (sessionsRawRef.current !== serialized) {
      await AsyncStorage.setItem(getSavedSessionsKey(activeUserId), serialized);
      sessionsRawRef.current = serialized;
    }
    sessionsRef.current = nextSessions;
    setSavedSessions(nextSessions);
  }, [activeUserId]);

  const readStoredSessions = useCallback(async (forceStorageRead = false): Promise<SavedSession[]> => {
    if (!activeUserId) return [];
    if (!forceStorageRead && sessionsRawRef.current !== null) {
      return sessionsRef.current;
    }
    const raw = await AsyncStorage.getItem(getSavedSessionsKey(activeUserId));
    if (raw && raw === sessionsRawRef.current) {
      return sessionsRef.current;
    }

    const parsedSessions = parseStoredSessions(raw).filter((session) => session.meet);
    sessionsRawRef.current = raw;
    sessionsRef.current = parsedSessions;
    return parsedSessions;
  }, [activeUserId]);

  const refreshPendingCount = useCallback(async () => {
    if (!activeUserId) return;
    const count = countPendingWrites(await readOutbox(activeUserId));
    pendingWriteCountRef.current = count;
    setPendingWriteCount(count);
  }, [activeUserId]);

  /**
   * Send one queued write now. The outbox entry is cleared only on a 2xx;
   * offline, timeout, 5xx and a missing token leave it for `replayOutbox` on
   * the next load or reconnect. A 401 flips `authExpired`; any other 4xx is
   * a payload the server will never accept, so the entry is dropped.
   */
  const pushPendingWrite = useCallback(async (
    label: string,
    request: (token: string) => Promise<unknown>,
    clear: () => Promise<void>,
  ) => {
    if (!clerkUserId) {
      await refreshPendingCount();
      return;
    }
    let token: string | null = null;
    try {
      token = await getTokenRef.current();
    } catch (tokenError) {
      console.error(`Saved sessions: Clerk getToken() failed; ${label} queued`, tokenError);
    }
    if (token) {
      try {
        await request(token);
        await clear();
        setAuthExpired(false);
      } catch (error) {
        const kind = classifySyncError(error);
        if (kind === 'auth') {
          setAuthExpired(true);
        } else if (kind === 'rejected') {
          console.error(`Saved sessions: server rejected ${label}; dropping`, error);
          await clear();
        } else {
          console.error(`Saved sessions: ${label} failed; queued for retry`, error);
        }
      }
    }
    await refreshPendingCount();
  }, [clerkUserId, refreshPendingCount]);

  const removeSession = useCallback(async (sessionId: string) => {
    if (!activeUserId) return false;

    try {
      // 1. Update local state and AsyncStorage. The lookup for the
      // notification cancel below reads storage, not `savedSessions` state:
      // `pruneStartedSessions` runs from the load effect, whose closure over
      // state is the empty initial array, so the session was never found and
      // its reminder fired for a session the user no longer had.
      const { sessionToRemove, rev } = await mutationQueue.run(async () => {
        const currentSessions = await readStoredSessions();
        const found = currentSessions.find(session => session.id === sessionId);
        await commitSessions(currentSessions.filter(session => session.id !== sessionId));
        const rev = await markSessionPending(activeUserId, sessionId, 'delete');
        return { sessionToRemove: found, rev };
      });

      // 2. Delete from the API when online/authenticated.
      await pushPendingWrite(
        `delete ${sessionId}`,
        (token) => deletePendingSession(token, sessionId),
        () => clearSessionPending(activeUserId, sessionId, rev),
      );

      // *** Cancel notification ***
      if (sessionToRemove) {
        // Only attempt to cancel if the session was actually found
        try {
          const notificationsEnabled = await AsyncStorage.getItem(NOTIFICATION_ENABLED_KEY);
          if (notificationsEnabled === 'true') {
             // Only cancel if notifications were potentially scheduled
            await cancelNotification(sessionToRemove.id);
          }
        } catch (cancelError) {
          console.error(`removeSession: Failed to cancel notification for ${sessionToRemove.id}:`, cancelError);
          // Continue with removal even if cancellation fails
        }
      } else {
          console.warn(`removeSession: Could not find session ${sessionId} in storage before removal to cancel notification.`);
      }

      return true; // Indicate success
    } catch (error) {
      console.error('Error removing session:', error);
      return false;
    }
  }, [activeUserId, commitSessions, mutationQueue, pushPendingWrite, readStoredSessions]);

  // Removes saved sessions that started more than 2 hours ago, but only when the
  // user has the "auto-remove started sessions" preference enabled. Runs on load.
  const pruneStartedSessions = useCallback(async () => {
    if (!clerkUserId) return;

    let token: string | null = null;
    try {
      token = await getTokenRef.current();
    } catch (tokenError) {
      // Pruning is destructive, so a token failure must skip it rather than
      // guess at the preference (PoT #7).
      console.error('pruneStartedSessions: Clerk getToken() failed', tokenError);
      return;
    }
    if (!token) return;

    let autoUnsaveEnabled = false;
    try {
      const prefs = await fetchUserPreferences(token);
      autoUnsaveEnabled = prefs.auto_unsave_started_sessions;
    } catch (error) {
      console.error('pruneStartedSessions: failed to fetch preferences', error);
      return;
    }
    if (!autoUnsaveEnabled) return;

    const sessions = await readStoredSessions();
    if (sessions.length === 0) return;

    const now = new Date();
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

    for (const id of expiredIds) {
      await removeSession(id);
    }
  }, [clerkUserId, readStoredSessions, removeSession]);

  const loadSavedSessions = useCallback(async () => {
    if (!activeUserId) {
      setSavedSessions([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true); // Set loading true at the start
    try {
      // Hydrate from local storage first so navigation to Saved shows data immediately.
      const localSessions = await readStoredSessions(true);
      setSavedSessions(localSessions);
      await refreshPendingCount();

      // Fetch from the API when Clerk can provide a fresh token.
      if (clerkUserId) {
        // PoT #7: "Clerk threw" and "Clerk has no token" are different
        // failures, and neither is "the server says you have nothing saved".
        // `.catch(() => null)` used to flatten all three into one falsy value.
        // Both no-token paths return *before* the reconcile below, so an auth
        // or network failure can never reach the branch that clears storage.
        let token: string | null;
        try {
          token = await getTokenRef.current();
        } catch (tokenError) {
          console.error(
            'Saved sessions: Clerk getToken() failed; keeping local sessions',
            tokenError,
          );
          return;
        }
        if (!token) {
          devLog('Saved sessions: no Clerk token; keeping local sessions');
          return;
        }

        // Replay writes the device still owes the server before asking it
        // what it has, so an offline save is on the list the reconcile reads.
        // The snapshot from before the replay still counts as dirty for the
        // merge below: a read that lags the PUT it just accepted must not
        // drop the row the replay has only just delivered.
        const outboxBeforeReplay = await readOutbox(activeUserId);
        const replay = await replayOutbox(activeUserId, token, sessionsRef.current);
        if (replay.authExpired) {
          setAuthExpired(true);
          await refreshPendingCount();
          return;
        }

        // `fetchSavedSessions` throws on timeout, HTTP error, and malformed
        // body, so reaching here means the server answered authoritatively.
        // Only an authoritative answer is allowed to shrink local state.
        const apiSessions = await fetchSavedSessions(token);
        setAuthExpired(false);

        const serverSessions: SavedSession[] = apiSessions.map(s => ({
          id: s.session_id,
          meet: s.meet as MeetName,
          sessionNumber: s.session_number,
          platform: s.platform,
          weightClass: s.weight_class ?? '',
          startTime: s.start_time ?? '',
          weighInTime: calculateWeighInTime(s.start_time ?? ''),
          date: s.date ?? '',
          notes: s.notes ?? undefined,
          athleteNames: s.athlete_names,
        }));

        // The merge runs on the mutation queue and re-reads local state and
        // the outbox there: a save that landed while the fetch was in flight
        // is still dirty, so it survives the reconcile instead of being
        // overwritten by the pre-fetch snapshot.
        await mutationQueue.run(async () => {
          const currentLocal = await readStoredSessions(true);
          if (serverSessions.length > 0) {
            const outboxNow = await readOutbox(activeUserId);
            const outbox = {
              sessions: { ...outboxBeforeReplay.sessions, ...outboxNow.sessions },
              resets: { ...outboxBeforeReplay.resets, ...outboxNow.resets },
              nextRev: outboxNow.nextRev,
            };
            await commitSessions(mergeServerSessions(serverSessions, currentLocal, outbox));
          } else if (currentLocal.length === 0) {
            // Server and device agree there is nothing saved: drop the empty
            // key so a stale `[]` blob does not linger.
            await AsyncStorage.removeItem(getSavedSessionsKey(activeUserId));
            sessionsRawRef.current = null;
            sessionsRef.current = [];
            setSavedSessions([]);
          } else {
            // Server says empty but the device has rows. Rows written before
            // the outbox existed never had a pending flag, so local wins
            // rather than being deleted.
            setSavedSessions(currentLocal);
          }
        });
        await refreshPendingCount();
      }

      // Enforce the "auto-remove saved sessions 2 hours after they start"
      // preference. The backend stores the flag; the client applies it on load.
      await pruneStartedSessions();
    } catch (error) {
      console.error('Error loading saved sessions:', error);

      // Keep the three failure modes distinct. Sniffing `error.message` for
      // "network"/"fetch" matched nothing the API client actually throws, so
      // every failure read as an unexplained one.
      if (error instanceof MeetCalApiTimeoutError) {
        console.error('Saved sessions request timed out, falling back to local storage');
      } else if (error instanceof MeetCalApiError) {
        console.error('Saved sessions request rejected, falling back to local storage', {
          status: error.status,
        });
        if (error.status === 401) setAuthExpired(true);
      } else {
        console.error('Network or storage failure, falling back to local storage');
      }

      // Attempt to load from local storage as a final fallback
      try {
        const saved = await AsyncStorage.getItem(getSavedSessionsKey(activeUserId));
        const validSessions = parseStoredSessions(saved).filter((session) => session.meet);
        sessionsRawRef.current = saved;
        sessionsRef.current = validSessions;
        setSavedSessions(validSessions);
      } catch (localError) {
        console.error('Error loading saved sessions from AsyncStorage fallback:', localError);
        setSavedSessions([]);
      }
    } finally {
      setIsLoading(false);
    }
  }, [
    activeUserId,
    clerkUserId,
    commitSessions,
    mutationQueue,
    pruneStartedSessions,
    readStoredSessions,
    refreshPendingCount,
  ]);

  // Load on every step of user resolution that changes what a load can do:
  // the cached id (local only) and then Clerk's id (server reconcile). Keyed
  // so that `hasResolvedUser` flipping, or Clerk confirming the id the cache
  // already gave, runs the load once and not twice — but Clerk resolving the
  // *same* id after a cache-only load still triggers the reconcile that the
  // cache-only pass could not do.
  const lastLoadKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeUserId) {
      lastLoadKeyRef.current = null;
      if (hasResolvedUser) {
        setSavedSessions([]);
        setIsLoading(false);
      }
      return;
    }
    const loadKey = `${activeUserId}:${clerkUserId ? 'verified' : 'cached'}`;
    if (lastLoadKeyRef.current === loadKey) return;
    lastLoadKeyRef.current = loadKey;
    void loadSavedSessions();
  }, [activeUserId, clerkUserId, hasResolvedUser, loadSavedSessions]);

  // Outbox replay on reconnect: a load does the replay, and only a device
  // with something queued and a Clerk session that can sign the calls needs one.
  const loadSavedSessionsRef = useRef(loadSavedSessions);
  loadSavedSessionsRef.current = loadSavedSessions;
  useEffect(() => {
    if (!clerkUserId) return;
    const unsubscribe = subscribeToNetworkChanges((isConnected) => {
      if (isConnected && pendingWriteCountRef.current > 0) {
        void loadSavedSessionsRef.current();
      }
    });
    return unsubscribe;
  }, [clerkUserId]);

  /**
   * @param options.schedule The meet's schedule when the caller already has
   * it. Notification scheduling (step 3 below) needs the session's day, and
   * `fetchSchedule` only de-duplicates *concurrent* callers — so the
   * sequential save loop in `saveSessionsFromAthletes` used to issue one full
   * `GET /meets/schedule` per saved session for the same meet. Passing the
   * already-resolved schedule collapses those back to the one fetch the
   * caller made. Must be non-empty: an empty schedule is exactly the case
   * where the fetch below is still worth making.
   *
   * @param options.notificationsEnabled The already-read value of
   * `NOTIFICATION_ENABLED_KEY`. The flag is a single user preference that
   * cannot change while a batch save is running, so the per-session loop in
   * `saveSessionsFromAthletes` — up to one iteration per session on a meet's
   * full roster — reads it once instead of issuing one AsyncStorage round
   * trip per saved session.
   */
  const saveSession = useCallback(async (
    session: SavedSession,
    options?: { schedule?: ScheduleType; notificationsEnabled?: boolean },
  ) => {
    if (!activeUserId) return false;

    try {
      if (!session.meet) {
        console.error('Cannot save session without meet information');
        return false;
      }

      // 1. Update local state and AsyncStorage, and record the pending PUT.
      const { updatedSession, isUpdate, rev } = await mutationQueue.run(async () => {
        const currentSessions = await readStoredSessions();
        const nextSessions = [...currentSessions];

        const existingSessionIndex = nextSessions.findIndex(s => s.id === session.id);
        let updatedSession: SavedSession;
        if (existingSessionIndex >= 0) {
          const existingSession = nextSessions[existingSessionIndex];
          updatedSession = { ...existingSession, ...session }; // Merge new data over existing
        } else {
          updatedSession = { ...session };
        }
        // Same cap on both sides of the sync, so what the device shows is what
        // the server holds. The backend answers 400 above the limit.
        if (updatedSession.athleteNames) {
          updatedSession.athleteNames = capAthleteNames(updatedSession.athleteNames);
        }
        if (existingSessionIndex >= 0) {
          nextSessions[existingSessionIndex] = updatedSession;
        } else {
          nextSessions.push(updatedSession);
        }

        await commitSessions(nextSessions);
        const rev = await markSessionPending(activeUserId, updatedSession.id, 'put');
        return { updatedSession, isUpdate: existingSessionIndex >= 0, rev };
      });

      posthog.capture('session_saved', {
        meet: updatedSession.meet,
        session_number: updatedSession.sessionNumber,
        platform: updatedSession.platform,
        weight_class: updatedSession.weightClass,
        is_update: isUpdate,
        athlete_count: updatedSession.athleteNames?.length ?? 0,
      });

      // 2. Upsert to the API when online/authenticated. The local save is the
      // source of truth until the PUT lands; the outbox entry survives a
      // failure and is replayed on the next load or reconnect.
      await pushPendingWrite(
        `put ${updatedSession.id}`,
        (token) => putSavedSession(token, updatedSession.id, toSavedSessionBody(updatedSession)),
        () => clearSessionPending(activeUserId, updatedSession.id, rev),
      );

      // 3. Schedule local notification 1 hour before session start time if notifications are enabled
      try {
        const notificationsEnabled =
          options?.notificationsEnabled ??
          ((await AsyncStorage.getItem(NOTIFICATION_ENABLED_KEY)) === 'true');
        logNotificationScheduling('enabled', notificationsEnabled);

        if (notificationsEnabled) {
          const meetName = updatedSession.meet;
          const sessionNumber = updatedSession.sessionNumber;
          const platform = updatedSession.platform;
          const providedSchedule =
            options?.schedule && options.schedule.length > 0
              ? options.schedule
              : null;
          logNotificationScheduling(
            providedSchedule ? 'reusing caller schedule' : 'fetching schedule',
            {
              meetName,
              sessionNumber,
              platform,
            },
          );
          const schedule = providedSchedule ?? (await fetchSchedule(meetName));
          logNotificationScheduling('schedule days', schedule?.length ?? 0);

          if (!schedule || schedule.length === 0) {
             console.error(`Notification Scheduling - Could not fetch or schedule is empty for meet: ${meetName}`);
             return true; // Still return true as the session was saved
          }

          let foundSession = null;
          let sessionDayDate = '';
          for (const day of schedule) {
            const session = day.sessions.find(s => s.number === sessionNumber);
            if (session) {
              foundSession = session;
              sessionDayDate = day.fullDate; // YYYY-MM-DD from transformed data
              break;
            }
          }
          logNotificationScheduling(
            'session found',
            foundSession ? sessionDayDate : false,
          );

          if (foundSession && sessionDayDate) {
            const startTime = getPlatformStartTime(foundSession, platform);

            // Get meet config for timezone information
            const meetConfig = await getMeetConfig(meetName);

            // Convert times to UTC using the meet's time zone (same as calendar events)
            const sessionDate = convertToUTC(
              startTime,
              sessionDayDate,
              meetConfig.time.timeZoneIdentifier,
            );

            const triggerDate = new Date(
              sessionDate.getTime() - NOTIFICATION_LEAD_MS,
            );
            const now = new Date();

            logNotificationScheduling('trigger', {
              sessionUtc: sessionDate.toISOString(),
              triggerUtc: triggerDate.toISOString(),
              meetZone: meetConfig.time.timeZoneIdentifier,
              willSchedule: triggerDate > now,
            });

            if (triggerDate > now) {
              const notificationId = await scheduleNotification(
                `Session Reminder`,
                `Session ${updatedSession.sessionNumber} ${updatedSession.platform} starts in 1 hour.`,
                triggerDate,
                updatedSession.id,
                {
                  id: updatedSession.id,
                  meet: updatedSession.meet,
                  sessionNumber: updatedSession.sessionNumber,
                  platform: updatedSession.platform,
                  weightClass: updatedSession.weightClass,
                  startTime,
                  weighInTime: calculateWeighInTime(startTime),
                  date: sessionDayDate,
                },
              );
              logNotificationScheduling('scheduled', notificationId);
            }
          }
        }
      } catch (notifError) {
        console.error('Notification Scheduling - Error caught during scheduling block:', notifError);
      }

      return true; // Indicate success
    } catch (error) {
      console.error('Error saving session:', error);
      return false;
    }
  }, [activeUserId, commitSessions, mutationQueue, pushPendingWrite, readStoredSessions]);

  const saveSessionsFromAthletes = useCallback(async (
    athletes: LiftResult[],
    meet: MeetName,
    scheduleOverride?: ScheduleType,
  ) => {
    if (!activeUserId) return false;

    try {
      const sessionMap = new Map<string, { session: SavedSession, athletes: string[] }>();
      let schedule = scheduleOverride ?? [];

      if (schedule.length === 0) {
        try {
          schedule = await fetchSchedule(meet);
        } catch (fetchError) {
          console.warn('saveSessionsFromAthletes: fetchSchedule failed, falling back to cached schedule', fetchError);
          const meetData = await getMeetData(meet).catch(() => null);
          schedule = meetData?.schedule ?? [];
        }
      }

      athletes
        .filter(athlete => athlete.session)
        .forEach(athlete => {
          const sessionId = generateSessionId(meet, athlete.session!.number, athlete.session!.platform);

          if (!sessionMap.has(sessionId)) {
            // Find session details in schedule
            const sessionDay = schedule.find(day =>
              day.sessions.some(s => s.number === athlete.session?.number)
            );

            const scheduleSession = sessionDay?.sessions.find(s =>
              s.number === athlete.session?.number
            );

            const platform = scheduleSession?.platforms.find(p =>
              p.platform === athlete.session?.platform
            );

            if (sessionDay && scheduleSession && platform) {
              const startTime = platform.platformStartTime || scheduleSession.startTime;
              const weighInTime = calculateWeighInTime(startTime);
              sessionMap.set(sessionId, {
                session: {
                  id: sessionId,
                  meet,
                  sessionNumber: athlete.session!.number,
                  platform: athlete.session!.platform,
                  weightClass: platform.weightClass,
                  startTime,
                  weighInTime,
                  date: sessionDay.fullDate,
                  athleteNames: []
                },
                athletes: []
              });
            } else {
              const fallbackStartTime = athlete.session?.startTime ?? '';
              sessionMap.set(sessionId, {
                session: {
                  id: sessionId,
                  meet,
                  sessionNumber: athlete.session!.number,
                  platform: athlete.session!.platform,
                  weightClass: athlete.weightClass ?? '',
                  startTime: fallbackStartTime,
                  weighInTime: calculateWeighInTime(fallbackStartTime),
                  date: athlete.session?.date ?? '',
                  athleteNames: []
                },
                athletes: []
              });
            }
          }

          const sessionData = sessionMap.get(sessionId);
          if (sessionData) {
            sessionData.athletes.push(athlete.name);
          }
        });

      const uniqueSessionsToSave = Array.from(sessionMap.values()).map(({ session, athletes }) => {
        // Ensure athleteNames has unique values
        return {
          ...session,
          athleteNames: [...new Set(athletes)]
        };
      });

      // Merge against what is stored, not the `savedSessions` render snapshot.
      const storedSessions = await readStoredSessions();

      // One read for the whole batch. `saveSession` otherwise re-reads this
      // single boolean preference from AsyncStorage once per session, and a
      // full national-meet roster produces one session per platform-session
      // on the schedule.
      const notificationsEnabled =
        (await AsyncStorage.getItem(NOTIFICATION_ENABLED_KEY)) === 'true';

      // Loop through generated sessions and save each one (which handles local + API)
      let allSavesSucceeded = true;
      for (const sessionToSave of uniqueSessionsToSave) {
        // Find existing local session to potentially merge *before* calling saveSession
        const existingLocalSession = storedSessions.find(s => s.id === sessionToSave.id);
        let sessionWithMergedData = { ...sessionToSave };

        if (existingLocalSession) {
          // Merge athlete names from local and new data
          const combinedNames = [...new Set([...(existingLocalSession.athleteNames || []), ...(sessionToSave.athleteNames || [])])];
          sessionWithMergedData = {
            ...existingLocalSession, // Keep existing notes, etc.
            ...sessionToSave, // Overwrite with new schedule data (like time)
            athleteNames: combinedNames, // Use the merged names
          };
        }

        // Call saveSession for each session to handle upsert and local state.
        // `schedule` is the same meet's schedule for every iteration, so hand
        // it over rather than letting each save re-fetch it.
        const success = await saveSession(sessionWithMergedData, {
          schedule,
          notificationsEnabled,
        });
        if (!success) {
          allSavesSucceeded = false;
          console.error(`Failed to save session ${sessionWithMergedData.id} from start list.`);
          // Decide if you want to stop or continue saving others
        }
      }

      // Note: saveSession already updates the main savedSessions state and AsyncStorage,
      // so no need to call setSavedSessions or setItem here directly.

      return allSavesSucceeded; // Indicate if all individual saves were successful
    } catch (error) {
      console.error('Error saving sessions:', error);
      return false;
    }
  }, [activeUserId, readStoredSessions, saveSession]);

  const isSessionSaved = useCallback((sessionId: string) => {
    if (!activeUserId) return false;
    return savedSessions.some(session => session.id === sessionId);
  }, [activeUserId, savedSessions]);

  /**
   * Remove every saved session for `meet`, or every session when no meet is
   * given. Sweeps the legacy storage keys too; the Saved screen used to do
   * that itself, behind this hook's back.
   */
  const resetAllSessions = useCallback(async (meet?: MeetName) => {
    if (!activeUserId) return false;
    const target = meet ?? null;
    try {
      const rev = await mutationQueue.run(async () => {
        const currentSessions = await readStoredSessions();
        await commitSessions(target ? currentSessions.filter(s => s.meet !== target) : []);
        await resetLegacySavedSessions(activeUserId, target);
        return markResetPending(activeUserId, target);
      });
      await pushPendingWrite(
        target ? `reset ${target}` : 'reset all',
        (token) => deleteSavedSessionsFromApi(token, target ?? undefined),
        () => clearResetPending(activeUserId, target, rev),
      );
      return true;
    } catch (error) {
      console.error('Error resetting sessions:', error);
      return false;
    }
  }, [activeUserId, commitSessions, mutationQueue, pushPendingWrite, readStoredSessions]);

  /**
   * Fold sessions stored before they were namespaced by meet into the
   * current list, assigning them to `currentMeet`. Each row goes through
   * `saveSession`, so the writes are serialised and the PUTs are queued like
   * any other save; a legacy key is dropped once its rows are in.
   */
  const migrateLegacySessions = useCallback(async (currentMeet: MeetName) => {
    if (!activeUserId) return false;
    try {
      const batches = await findLegacySessionsNeedingMigration(activeUserId, currentMeet);
      if (batches.length === 0) return true;
      devLog('Saved sessions: migrating legacy rows', batches.map(b => [b.key, b.sessions.length]));
      let allSaved = true;
      for (const batch of batches) {
        for (const session of batch.sessions) {
          if (!(await saveSession(session))) allSaved = false;
        }
        if (allSaved) await removeLegacySavedSessionsKey(activeUserId, batch.key);
      }
      return allSaved;
    } catch (error) {
      console.error('Error during session migration:', error);
      return false;
    }
  }, [activeUserId, saveSession]);

  return useMemo(() => ({
    savedSessions,
    isLoading,
    authExpired,
    pendingWriteCount,
    loadSavedSessions,
    saveSessionsFromAthletes,
    saveSession,
    removeSession,
    isSessionSaved,
    resetAllSessions,
    migrateLegacySessions,
  }), [
    savedSessions,
    isLoading,
    authExpired,
    pendingWriteCount,
    loadSavedSessions,
    saveSessionsFromAthletes,
    saveSession,
    removeSession,
    isSessionSaved,
    resetAllSessions,
    migrateLegacySessions,
  ]);
}
