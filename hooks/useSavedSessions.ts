import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { LiftResult } from '@/data/types/athletes';
import { MeetName } from '@/data/types/meet';
import { useAuth, useUser } from '@clerk/expo';
import { getMeetConfig } from '@/data/meets/config';
import { useSelectedMeet } from '@/contexts/SelectedMeetContext';
import { syncSavedWidget, clearSavedWidget } from '@/utils/savedWidget';
import { reindexAppEntities } from '@/utils/appIntents';
import type { Schedule as ScheduleType } from '@/types/schedule';
import {
  countPendingWrites,
  flushOutbox,
  type FlushResult,
  readOutbox,
} from '@/lib/saved-sessions-outbox';
import { createSerialQueue } from '@/lib/saved-sessions-queue';
import {
  clearSavedSessionsCache,
  commitStoredSessions,
  createSavedSessionsCache,
  readStoredSessions as readStoredSessionsFor,
  type SavedSession,
  type SavedSessionsStore,
} from '@/lib/saved-sessions-store';
import {
  createLoadChain,
  loadSavedSessionsFor,
  savedSessionsLoadKey,
} from '@/lib/saved-sessions-load';
import { pruneStartedSessions as pruneStartedSessionsFor } from '@/lib/saved-sessions-prune';
import {
  migrateLegacySessions as migrateLegacySessionsFor,
  removeSession as removeSessionFor,
  resetAllSessions as resetAllSessionsFor,
  saveSession as saveSessionFor,
  saveSessionsFromAthletes as saveSessionsFromAthletesFor,
  type SaveSessionOptions,
  type SavedSessionsActionDeps,
} from '@/lib/saved-sessions-actions';
import { useStorageUser } from '@/hooks/saved-sessions/useStorageUser';
import { useReconnectReplay } from '@/hooks/saved-sessions/useReconnectReplay';

export type { SavedSession } from '@/lib/saved-sessions-store';

/**
 * The signed-in user's saved sessions: the list on screen, kept in
 * AsyncStorage per user and synced with `/users/me/saved-sessions` through
 * the pending-writes outbox.
 *
 * This hook only wires React state and the per-user refs to the plain
 * functions that do the work:
 * - `lib/saved-sessions-store` — the stored list, its parsing and cache;
 * - `lib/saved-sessions-actions` — save / remove / reset / migrate;
 * - `lib/saved-sessions-load` — hydrate, reconcile with the server;
 * - `lib/saved-sessions-prune` — the auto-unsave preference;
 * - `lib/saved-sessions-reminders` — the session reminder notification.
 */
export function useSavedSessions() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const { selectedMeet } = useSelectedMeet();
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const clerkUserId = user?.id;
  const { storageUserId, hasResolvedUser } = useStorageUser(clerkUserId);
  /**
   * The API answered 401 to a `/users/me/*` call. The Clerk session Clerk
   * still reports as signed in no longer authorises writes, so nothing is
   * syncing; surfaced in state so a screen can say so instead of the failure
   * living only in the console.
   */
  const [authExpired, setAuthExpired] = useState(false);
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
  const activeUserId = clerkUserId ?? storageUserId;
  // Async work started for one user checks this before touching state, so a
  // load still in flight at sign-out or an account switch cannot repaint the
  // previous user's sessions.
  const activeUserIdRef = useRef(activeUserId);
  activeUserIdRef.current = activeUserId;
  // The cached list, tagged with the user it was read for. A cached list
  // must never be handed to a different user's write.
  const storeRef = useRef<SavedSessionsStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = {
      cache: createSavedSessionsCache(),
      isActive: (userId) => activeUserIdRef.current === userId,
      publish: setSavedSessions,
    };
  }
  const store = storeRef.current;

  useEffect(() => {
    if (!hasResolvedUser || activeUserId) return;
    setSavedSessions([]);
    setIsLoading(false);
    setAuthExpired(false);
    pendingWriteCountRef.current = 0;
    clearSavedWidget();
    clearSavedSessionsCache(store.cache);
  }, [hasResolvedUser, activeUserId, store]);

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

  const commitSessions = useCallback(
    (nextSessions: SavedSession[]) => commitStoredSessions(store, activeUserId, nextSessions),
    [activeUserId, store],
  );

  const readStoredSessions = useCallback(
    (forceStorageRead = false) => readStoredSessionsFor(store, activeUserId, forceStorageRead),
    [activeUserId, store],
  );

  const refreshPendingCount = useCallback(async () => {
    if (!activeUserId) return;
    try {
      const count = countPendingWrites(await readOutbox(activeUserId));
      if (activeUserIdRef.current === activeUserId) pendingWriteCountRef.current = count;
    } catch (error) {
      // Only a hint for the reconnect trigger; keep the last known count.
      console.error('Saved sessions: could not read the outbox', error);
    }
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

  const actionDeps = useMemo<SavedSessionsActionDeps>(() => ({
    userId: activeUserId,
    queue: mutationQueue,
    readStoredSessions: () => readStoredSessions(),
    commitSessions,
    syncOutbox,
  }), [activeUserId, commitSessions, mutationQueue, readStoredSessions, syncOutbox]);

  const removeSession = useCallback(
    (sessionId: string) => removeSessionFor(actionDeps, sessionId),
    [actionDeps],
  );

  // Removes saved sessions that started more than 2 hours ago, but only when the
  // user has the "auto-remove started sessions" preference enabled. Runs on load.
  const pruneStartedSessions = useCallback(() => pruneStartedSessionsFor({
    clerkUserId,
    isActive: store.isActive,
    getToken: () => getTokenRef.current(),
    readStoredSessions: () => readStoredSessions(),
    removeSession,
  }), [clerkUserId, readStoredSessions, removeSession, store]);

  const runLoad = useCallback(() => loadSavedSessionsFor({
    userId: activeUserId,
    verified: Boolean(clerkUserId),
    store,
    queue: mutationQueue,
    getToken: () => getTokenRef.current(),
    readStoredSessions,
    commitSessions,
    refreshPendingCount,
    syncOutbox,
    pruneStartedSessions,
    setIsLoading,
    setAuthExpired,
  }), [
    activeUserId,
    clerkUserId,
    commitSessions,
    mutationQueue,
    pruneStartedSessions,
    readStoredSessions,
    refreshPendingCount,
    store,
    syncOutbox,
  ]);

  /**
   * Single-flight per load mode: a focus refresh while a load for the same
   * user and auth state is running shares it instead of running a second
   * replay, fetch and prune in parallel. A load for a new mode (Clerk
   * confirming the cached user) queues behind the running one.
   */
  const loadChain = useRef(createLoadChain()).current;
  const loadSavedSessions = useCallback(
    (): Promise<void> =>
      loadChain.run(savedSessionsLoadKey(activeUserId, Boolean(clerkUserId)), runLoad),
    [activeUserId, clerkUserId, loadChain, runLoad],
  );

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
    const loadKey = savedSessionsLoadKey(activeUserId, Boolean(clerkUserId));
    if (lastLoadKeyRef.current === loadKey) return;
    lastLoadKeyRef.current = loadKey;
    void loadSavedSessions();
  }, [activeUserId, clerkUserId, hasResolvedUser, loadSavedSessions]);

  useReconnectReplay(clerkUserId, pendingWriteCountRef, syncOutbox);

  /** See `SaveSessionOptions` in `lib/saved-sessions-actions`. */
  const saveSession = useCallback(
    (session: SavedSession, options?: SaveSessionOptions) =>
      saveSessionFor(actionDeps, session, options),
    [actionDeps],
  );

  const saveSessionsFromAthletes = useCallback(
    (athletes: LiftResult[], meet: MeetName, scheduleOverride?: ScheduleType) =>
      saveSessionsFromAthletesFor(actionDeps, athletes, meet, scheduleOverride),
    [actionDeps],
  );

  const isSessionSaved = useCallback((sessionId: string) => {
    if (!activeUserId) return false;
    return savedSessions.some(session => session.id === sessionId);
  }, [activeUserId, savedSessions]);

  const resetAllSessions = useCallback(
    (meet?: MeetName) => resetAllSessionsFor(actionDeps, meet),
    [actionDeps],
  );

  const migrateLegacySessions = useCallback(
    (currentMeet: MeetName) => migrateLegacySessionsFor(actionDeps, currentMeet),
    [actionDeps],
  );

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
