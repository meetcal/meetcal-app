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
  fetchSavedSessions,
  fetchUserPreferences,
  MeetCalApiError,
  MeetCalApiTimeoutError,
} from '@/lib/api/meetcal-api';
import { reconnectRefetchDelayMs } from '@/lib/data/mutable-resource';
import { devLog } from '@/lib/logger';
import {
  adoptPreOutboxSessions,
  capAthleteNames,
  countPendingWrites,
  currentDeliverySeq,
  deliveriesSince,
  flushOutbox,
  type FlushResult,
  markResetPending,
  markSessionDelete,
  markSessionPut,
  mergeServerSessions,
  readOutbox,
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
  const sessionsRawRef = useRef<string | null>(null);
  const sessionsRef = useRef<SavedSession[]>([]);
  // Which user `sessionsRef` / `sessionsRawRef` were read for. A cached list
  // must never be handed to a different user's write.
  const sessionsOwnerRef = useRef<string | null>(null);
  /** Writes recorded in the outbox that have not yet reached the server. */
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
  // Async work started for one user checks this before touching state, so a
  // load still in flight at sign-out or an account switch cannot repaint the
  // previous user's sessions.
  const activeUserIdRef = useRef(activeUserId);
  activeUserIdRef.current = activeUserId;

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
    pendingWriteCountRef.current = 0;
    clearSavedWidget();
    sessionsRawRef.current = null;
    sessionsRef.current = [];
    sessionsOwnerRef.current = null;
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
    if (!activeUserId || activeUserIdRef.current !== activeUserId) return;
    const serialized = JSON.stringify(nextSessions);
    const sameOwner = sessionsOwnerRef.current === activeUserId;
    if (!sameOwner || sessionsRawRef.current !== serialized) {
      await AsyncStorage.setItem(getSavedSessionsKey(activeUserId), serialized);
      if (activeUserIdRef.current !== activeUserId) return;
      sessionsRawRef.current = serialized;
    }
    sessionsOwnerRef.current = activeUserId;
    sessionsRef.current = nextSessions;
    setSavedSessions(nextSessions);
  }, [activeUserId]);

  const readStoredSessions = useCallback(async (forceStorageRead = false): Promise<SavedSession[]> => {
    if (!activeUserId) return [];
    const sameOwner = sessionsOwnerRef.current === activeUserId;
    if (!forceStorageRead && sameOwner && sessionsRawRef.current !== null) {
      return sessionsRef.current;
    }
    const raw = await AsyncStorage.getItem(getSavedSessionsKey(activeUserId));
    if (sameOwner && raw && raw === sessionsRawRef.current) {
      return sessionsRef.current;
    }

    const parsedSessions = parseStoredSessions(raw).filter((session) => session.meet);
    if (activeUserIdRef.current === activeUserId) {
      sessionsOwnerRef.current = activeUserId;
      sessionsRawRef.current = raw;
      sessionsRef.current = parsedSessions;
    }
    return parsedSessions;
  }, [activeUserId]);

  const refreshPendingCount = useCallback(async () => {
    if (!activeUserId) return;
    const count = countPendingWrites(await readOutbox(activeUserId));
    if (activeUserIdRef.current === activeUserId) pendingWriteCountRef.current = count;
  }, [activeUserId]);

  /**
   * Send everything the outbox holds, through the one per-user sync runner.
   * Immediate writes and replays share it, so requests reach the server in
   * the order the user made them. Entries are cleared only on a 2xx;
   * offline, timeout, 5xx and a missing token leave them queued for the next
   * load or reconnect. A 401 flips `authExpired`.
   */
  const syncOutbox = useCallback(async (): Promise<FlushResult | null> => {
    if (!clerkUserId || activeUserId !== clerkUserId) {
      await refreshPendingCount();
      return null;
    }
    // Only hand the flush a token while the user it is flushing for is still
    // the signed-in one; `flushOutbox` also checks the token's subject.
    const flushingUserId = clerkUserId;
    const result = await flushOutbox(flushingUserId, async () => {
      if (activeUserIdRef.current !== flushingUserId) return null;
      const token = (await getTokenRef.current()) ?? null;
      return activeUserIdRef.current === flushingUserId ? token : null;
    });
    if (activeUserIdRef.current === clerkUserId) {
      pendingWriteCountRef.current = result.remaining;
      if (result.authExpired) setAuthExpired(true);
      else if (result.delivered > 0) setAuthExpired(false);
    }
    return result;
  }, [activeUserId, clerkUserId, refreshPendingCount]);

  const removeSession = useCallback(async (sessionId: string) => {
    if (!activeUserId) return false;

    try {
      // 1. Update local state and AsyncStorage. The lookup for the
      // notification cancel below reads storage, not `savedSessions` state:
      // `pruneStartedSessions` runs from the load effect, whose closure over
      // state is the empty initial array, so the session was never found and
      // its reminder fired for a session the user no longer had.
      // The outbox entry is recorded before the local write, so a crash in
      // between cannot leave a local removal with no pending DELETE.
      const sessionToRemove = await mutationQueue.run(async () => {
        const currentSessions = await readStoredSessions();
        const found = currentSessions.find(session => session.id === sessionId);
        const meet = found?.meet ?? (await readOutbox(activeUserId)).sessions[sessionId]?.meet;
        if (meet) await markSessionDelete(activeUserId, sessionId, meet);
        await commitSessions(currentSessions.filter(session => session.id !== sessionId));
        return found;
      });

      // 2. Delete from the API when online/authenticated.
      await syncOutbox();

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
  }, [activeUserId, commitSessions, mutationQueue, readStoredSessions, syncOutbox]);

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

  const runLoad = useCallback(async () => {
    const userId = activeUserId;
    if (!userId) {
      setSavedSessions([]);
      setIsLoading(false);
      return;
    }
    // Every await below re-checks this: a load for a user who has since
    // signed out, or been replaced by another account, must not touch state.
    const isCurrent = () => activeUserIdRef.current === userId;

    setIsLoading(true);
    try {
      // Hydrate from local storage first so navigation to Saved shows data immediately.
      const localSessions = await readStoredSessions(true);
      if (!isCurrent()) return;
      setSavedSessions(localSessions);
      await refreshPendingCount();

      // Fetch from the API when Clerk can provide a fresh token.
      if (clerkUserId) {
        // PoT #7: "Clerk threw" and "Clerk has no token" are different
        // failures, and neither is "the server says you have nothing saved".
        // Both no-token paths return *before* the reconcile below, so an auth
        // or network failure can never reach the branch that shrinks storage.
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
        if (!isCurrent()) return;
        if (!token) {
          devLog('Saved sessions: no Clerk token; keeping local sessions');
          return;
        }

        // Send what the device still owes the server before asking it what
        // it has, so an offline save is on the list the reconcile reads.
        const flush = await syncOutbox();
        if (!isCurrent() || flush?.authExpired) return;

        // `fetchSavedSessions` throws on timeout, HTTP error, and malformed
        // body, so reaching here means the server answered authoritatively.
        // Only an authoritative answer is allowed to shrink local state.
        const fetchStartedAt = currentDeliverySeq();
        const apiSessions = await fetchSavedSessions(token);
        if (!isCurrent()) return;
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

        // The merge runs on the mutation queue and reads the outbox there: a
        // save that landed while the fetch was in flight is still pending,
        // so it survives the reconcile. Every local write records its outbox
        // entry first, so a row that is neither on the server nor pending was
        // removed elsewhere and goes here too, whether or not the list is empty.
        const adopted = await mutationQueue.run(async () => {
          if (!isCurrent()) return 0;
          const currentLocal = await readStoredSessions(true);
          const adoptedCount = await adoptPreOutboxSessions(
            userId,
            serverSessions.length === 0,
            currentLocal,
          );
          const merged = mergeServerSessions(
            serverSessions,
            await readOutbox(userId),
            deliveriesSince(userId, fetchStartedAt),
          );
          if (!isCurrent()) return adoptedCount;
          if (merged.length === 0) {
            await AsyncStorage.removeItem(getSavedSessionsKey(userId));
            if (!isCurrent()) return adoptedCount;
            sessionsOwnerRef.current = userId;
            sessionsRawRef.current = null;
            sessionsRef.current = [];
            setSavedSessions([]);
          } else {
            await commitSessions(merged);
          }
          return adoptedCount;
        });
        if (!isCurrent()) return;
        // Rows adopted from a pre-outbox build are queued now; send them.
        if (adopted > 0) await syncOutbox();
        await refreshPendingCount();
      }

      // Enforce the "auto-remove saved sessions 2 hours after they start"
      // preference. The backend stores the flag; the client applies it on load.
      if (isCurrent()) await pruneStartedSessions();
    } catch (error) {
      if (!isCurrent()) return;
      console.error('Error loading saved sessions:', error);

      // Keep the three failure modes distinct.
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
        const saved = await AsyncStorage.getItem(getSavedSessionsKey(userId));
        if (!isCurrent()) return;
        const validSessions = parseStoredSessions(saved).filter((session) => session.meet);
        sessionsOwnerRef.current = userId;
        sessionsRawRef.current = saved;
        sessionsRef.current = validSessions;
        setSavedSessions(validSessions);
      } catch (localError) {
        console.error('Error loading saved sessions from AsyncStorage fallback:', localError);
        setSavedSessions([]);
      }
    } finally {
      if (isCurrent()) setIsLoading(false);
    }
  }, [
    activeUserId,
    clerkUserId,
    commitSessions,
    mutationQueue,
    pruneStartedSessions,
    readStoredSessions,
    refreshPendingCount,
    syncOutbox,
  ]);

  /**
   * Single-flight per load mode: a focus refresh while a load for the same
   * user and auth state is running shares it instead of running a second
   * replay, fetch and prune in parallel. A load for a new mode (Clerk
   * confirming the cached user) queues behind the running one.
   */
  const loadChainRef = useRef<{ key: string; promise: Promise<void> } | null>(null);
  const loadSavedSessions = useCallback((): Promise<void> => {
    const key = `${activeUserId ?? ''}:${clerkUserId ? 'verified' : 'cached'}`;
    const running = loadChainRef.current;
    if (running && running.key === key) return running.promise;
    const previous = running?.promise ?? Promise.resolve();
    const promise = previous.catch(() => undefined).then(() => runLoad());
    const entry = { key, promise };
    loadChainRef.current = entry;
    const release = () => {
      if (loadChainRef.current === entry) loadChainRef.current = null;
    };
    promise.then(release, release);
    return promise;
  }, [activeUserId, clerkUserId, runLoad]);

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

  // Send queued writes when the device comes back online: only on a real
  // offline → online edge (NetInfo also reports the current state on
  // subscribe, and on every Wi-Fi/cellular change), only when something is
  // queued, and after a small jitter so a venue-wide flap does not arrive at
  // the API all at once.
  const syncOutboxRef = useRef(syncOutbox);
  syncOutboxRef.current = syncOutbox;
  useEffect(() => {
    if (!clerkUserId) return;
    let lastConnected: boolean | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeToNetworkChanges((isConnected) => {
      const previous = lastConnected;
      lastConnected = isConnected;
      if (!isConnected || previous !== false || timer !== null) return;
      if (pendingWriteCountRef.current === 0) return;
      timer = setTimeout(() => {
        timer = null;
        void syncOutboxRef.current();
      }, reconnectRefetchDelayMs());
    });
    return () => {
      if (timer !== null) clearTimeout(timer);
      unsubscribe();
    };
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
   *
   * @param options.silent Skip the analytics event and the reminder; used when
   * re-homing rows the user saved long ago (legacy migration).
   *
   * @returns false when the save failed locally or the server refused it
   * (e.g. the per-user session cap); true once it is stored and either sent
   * or queued for the next sync.
   */
  const saveSession = useCallback(async (
    session: SavedSession,
    options?: { schedule?: ScheduleType; notificationsEnabled?: boolean; silent?: boolean },
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

        // Outbox first: a crash before the local write still leaves the PUT
        // (with its body) queued, and the next reconcile restores the row.
        const rev = await markSessionPut(activeUserId, updatedSession);
        await commitSessions(nextSessions);
        return { updatedSession, isUpdate: existingSessionIndex >= 0, rev };
      });

      if (!options?.silent) {
        posthog.capture('session_saved', {
          meet: updatedSession.meet,
          session_number: updatedSession.sessionNumber,
          platform: updatedSession.platform,
          weight_class: updatedSession.weightClass,
          is_update: isUpdate,
          athlete_count: updatedSession.athleteNames?.length ?? 0,
        });
      }

      // 2. Upsert to the API when online/authenticated. The outbox entry
      // survives a network failure and is sent on the next load or reconnect.
      // A refusal (e.g. the server's per-user cap) is reported, not hidden:
      // the next reconcile brings the server's view back.
      const flush = await syncOutbox();
      if (flush?.rejected.get(updatedSession.id) === rev) {
        console.error(`Saved sessions: server refused ${updatedSession.id}`);
        return false;
      }
      if (options?.silent) return true;

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
  }, [activeUserId, commitSessions, mutationQueue, readStoredSessions, syncOutbox]);

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
      await mutationQueue.run(async () => {
        const currentSessions = await readStoredSessions();
        await markResetPending(activeUserId, target);
        await commitSessions(target ? currentSessions.filter(s => s.meet !== target) : []);
        await resetLegacySavedSessions(activeUserId, target);
      });
      await syncOutbox();
      return true;
    } catch (error) {
      console.error('Error resetting sessions:', error);
      return false;
    }
  }, [activeUserId, commitSessions, mutationQueue, readStoredSessions, syncOutbox]);

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
      const stored = await readStoredSessions();
      const storedIds = new Set(stored.map((session) => session.id));
      let allSaved = true;
      for (const batch of batches) {
        let batchSaved = true;
        for (const session of batch.sessions) {
          // A row already on the current list is newer than its legacy copy;
          // merging the legacy row over it would roll back notes and names.
          if (storedIds.has(session.id)) continue;
          if (await saveSession(session, { silent: true })) {
            storedIds.add(session.id);
          } else {
            batchSaved = false;
          }
        }
        if (batchSaved) await removeLegacySavedSessionsKey(activeUserId, batch.key);
        else allSaved = false;
      }
      return allSaved;
    } catch (error) {
      console.error('Error during session migration:', error);
      return false;
    }
  }, [activeUserId, readStoredSessions, saveSession]);

  return useMemo(() => ({
    savedSessions,
    isLoading,
    authExpired,
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
    loadSavedSessions,
    saveSessionsFromAthletes,
    saveSession,
    removeSession,
    isSessionSaved,
    resetAllSessions,
    migrateLegacySessions,
  ]);
}
