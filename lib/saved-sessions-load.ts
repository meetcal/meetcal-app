import { MeetName } from '@/data/types/meet';
import {
  type ApiSavedSession,
  fetchSavedSessions,
  MeetCalApiError,
  MeetCalApiTimeoutError,
} from '@/lib/api/meetcal-api';
import { devLog, devWarn } from '@/lib/logger';
import {
  adoptPreOutboxSessions,
  currentDeliverySeq,
  deliveriesSince,
  describeTokenClaims,
  type FlushResult,
  mergeServerSessions,
  readOutbox,
  tokenBelongsTo,
} from '@/lib/saved-sessions-outbox';
import type { SerialQueue } from '@/lib/saved-sessions-queue';
import {
  reloadStoredSessionsFallback,
  removeStoredSessions,
  type SavedSession,
  type SavedSessionsStore,
} from '@/lib/saved-sessions-store';
import { calculateWeighInTime } from '@/utils/time';

/**
 * Loading the saved-sessions list: hydrate from storage, then (with a
 * verified Clerk user) send the outbox, fetch the server's list and
 * reconcile the two, then apply the auto-unsave preference.
 */

/** Map the API's rows into the app's saved-session shape. */
export function sessionsFromApi(apiSessions: ApiSavedSession[]): SavedSession[] {
  return apiSessions.map(s => ({
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
}

/**
 * What a load can do depends on the user and on whether Clerk has verified
 * them (server reconcile) or only the cache has (local only).
 */
export function savedSessionsLoadKey(userId: string | null | undefined, verified: boolean): string {
  return `${userId ?? ''}:${verified ? 'verified' : 'cached'}`;
}

export interface LoadChain {
  run(key: string, task: () => Promise<void>): Promise<void>;
}

/**
 * Single-flight per key: a call while a task for the same key is running
 * shares it instead of starting a second one. A call for a new key queues
 * behind the running task.
 */
export function createLoadChain(): LoadChain {
  let current: { key: string; promise: Promise<void> } | null = null;
  return {
    run(key, task) {
      const running = current;
      if (running && running.key === key) return running.promise;
      const previous = running?.promise ?? Promise.resolve();
      const promise = previous.catch(() => undefined).then(() => task());
      const entry = { key, promise };
      current = entry;
      const release = () => {
        if (current === entry) current = null;
      };
      promise.then(release, release);
      return promise;
    },
  };
}

export interface LoadSavedSessionsDeps {
  /** The active user (Clerk's, or the cached one while Clerk loads). */
  userId: string | null;
  /** Clerk has confirmed `userId`, so the server can be asked. */
  verified: boolean;
  store: SavedSessionsStore;
  queue: SerialQueue;
  getToken: () => Promise<string | null>;
  readStoredSessions: (forceStorageRead?: boolean) => Promise<SavedSession[]>;
  commitSessions: (nextSessions: SavedSession[]) => Promise<void>;
  refreshPendingCount: () => Promise<void>;
  syncOutbox: () => Promise<FlushResult | null>;
  pruneStartedSessions: () => Promise<void>;
  setIsLoading: (isLoading: boolean) => void;
  setAuthExpired: (authExpired: boolean) => void;
}

/**
 * Bring the local list in line with the server's. Returns true once the
 * reconcile ran to the end, false when it stopped early (no usable token,
 * a user switch, an expired session) and the rest of the load is skipped.
 */
async function reconcileWithServer(
  deps: LoadSavedSessionsDeps,
  userId: string,
): Promise<boolean> {
  const isCurrent = () => deps.store.isActive(userId);

  // PoT #7: "Clerk threw" and "Clerk has no token" are different
  // failures, and neither is "the server says you have nothing saved".
  // Both no-token paths return *before* the reconcile below, so an auth
  // or network failure can never reach the branch that shrinks storage.
  let token: string | null;
  try {
    token = await deps.getToken();
  } catch (tokenError) {
    console.error(
      'Saved sessions: Clerk getToken() failed; keeping local sessions',
      tokenError,
    );
    return false;
  }
  if (!isCurrent()) return false;
  if (!token) {
    devLog('Saved sessions: no Clerk token; keeping local sessions');
    return false;
  }
  // Clerk can already be on another account while this load is still
  // keyed to `userId`; that account's list must never be merged into
  // this user's store.
  if (!tokenBelongsTo(token, userId)) {
    devLog('Saved sessions: token is for another user; keeping local sessions');
    return false;
  }

  // Send what the device still owes the server before asking it what
  // it has, so an offline save is on the list the reconcile reads.
  const flush = await deps.syncOutbox();
  if (!isCurrent() || flush?.authExpired) return false;

  // `fetchSavedSessions` throws on timeout, HTTP error, and malformed
  // body, so reaching here means the server answered authoritatively.
  // Only an authoritative answer is allowed to shrink local state.
  const fetchStartedAt = currentDeliverySeq();
  let apiSessions: Awaited<ReturnType<typeof fetchSavedSessions>>;
  try {
    apiSessions = await fetchSavedSessions(token);
  } catch (error) {
    if (error instanceof MeetCalApiError && error.status === 401) {
      devWarn('Saved sessions: API rejected the sign-in token (401)', describeTokenClaims(token));
    }
    throw error;
  }
  if (!isCurrent()) return false;
  deps.setAuthExpired(false);

  const serverSessions = sessionsFromApi(apiSessions);

  // The merge runs on the mutation queue and reads the outbox there: a
  // save that landed while the fetch was in flight is still pending,
  // so it survives the reconcile. Every local write records its outbox
  // entry first, so a row that is neither on the server nor pending was
  // removed elsewhere and goes here too, whether or not the list is empty.
  const adopted = await deps.queue.run(async () => {
    if (!isCurrent()) return 0;
    const currentLocal = await deps.readStoredSessions(true);
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
      await removeStoredSessions(deps.store, userId);
    } else {
      await deps.commitSessions(merged);
    }
    return adoptedCount;
  });
  if (!isCurrent()) return false;
  // Rows adopted from a pre-outbox build are queued now; send them.
  if (adopted > 0) await deps.syncOutbox();
  await deps.refreshPendingCount();
  return true;
}

/** Report a failed load; the three failure modes stay distinct. */
function reportLoadFailure(
  error: unknown,
  setAuthExpired: (authExpired: boolean) => void,
): void {
  console.error('Error loading saved sessions:', error);

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
}

/**
 * One full load for `deps.userId`. Every await re-checks that the user is
 * still the active one: a load for a user who has since signed out, or been
 * replaced by another account, must not touch state.
 */
export async function loadSavedSessionsFor(deps: LoadSavedSessionsDeps): Promise<void> {
  const { userId, store } = deps;
  if (!userId) {
    store.publish([]);
    deps.setIsLoading(false);
    return;
  }
  const isCurrent = () => store.isActive(userId);

  deps.setIsLoading(true);
  try {
    // Hydrate from local storage first so navigation to Saved shows data immediately.
    const localSessions = await deps.readStoredSessions(true);
    if (!isCurrent()) return;
    store.publish(localSessions);
    await deps.refreshPendingCount();

    // Fetch from the API when Clerk can provide a fresh token.
    if (deps.verified && !(await reconcileWithServer(deps, userId))) return;

    // Enforce the "auto-remove saved sessions 2 hours after they start"
    // preference. The backend stores the flag; the client applies it on load.
    if (isCurrent()) await deps.pruneStartedSessions();
  } catch (error) {
    if (!isCurrent()) return;
    reportLoadFailure(error, deps.setAuthExpired);
    // Attempt to load from local storage as a final fallback
    await reloadStoredSessionsFallback(store, userId);
  } finally {
    if (isCurrent()) deps.setIsLoading(false);
  }
}
