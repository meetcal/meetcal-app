import AsyncStorage from '@react-native-async-storage/async-storage';
import { MeetName } from '@/data/types/meet';
import { getSavedSessionsKey } from '@/utils/session';

/**
 * The device's saved-sessions list: its row type, how a persisted row is
 * read back, and the per-user AsyncStorage read/commit with the in-memory
 * copy that avoids re-reading and re-parsing an unchanged list.
 *
 * Re-exported from `hooks/useSavedSessions`, which is where callers import it.
 */
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
export function normalizeStoredSession(value: unknown): SavedSession | null {
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

/** Parse a stored list; a missing, non-JSON or non-array value is empty. */
export function parseStoredSessions(raw: string | null): SavedSession[] {
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

/**
 * The last list read from or written to storage, and which user it belongs
 * to. A cached list must never be handed to a different user's write, so
 * every use checks `owner` first.
 */
export interface SavedSessionsCache {
  owner: string | null;
  raw: string | null;
  sessions: SavedSession[];
}

export function createSavedSessionsCache(): SavedSessionsCache {
  return { owner: null, raw: null, sessions: [] };
}

/** Forget the cached list (sign-out). */
export function clearSavedSessionsCache(cache: SavedSessionsCache): void {
  cache.raw = null;
  cache.sessions = [];
  cache.owner = null;
}

/** What the storage functions need from the hook that owns the list. */
export interface SavedSessionsStore {
  cache: SavedSessionsCache;
  /**
   * Whether `userId` is still the active user. Async work started for one
   * user checks this before touching the cache or state, so work in flight
   * at sign-out or an account switch cannot repaint the previous user's list.
   */
  isActive: (userId: string) => boolean;
  /** Publish a list to React state. */
  publish: (sessions: SavedSession[]) => void;
}

/**
 * The user's stored list. Served from the cache when it holds this user's
 * list, unless `forceStorageRead`; a storage value identical to the cached
 * raw string reuses the already-parsed list.
 */
export async function readStoredSessions(
  store: SavedSessionsStore,
  userId: string | null,
  forceStorageRead = false,
): Promise<SavedSession[]> {
  if (!userId) return [];
  const { cache } = store;
  const sameOwner = cache.owner === userId;
  if (!forceStorageRead && sameOwner && cache.raw !== null) {
    return cache.sessions;
  }
  const raw = await AsyncStorage.getItem(getSavedSessionsKey(userId));
  if (sameOwner && raw && raw === cache.raw) {
    return cache.sessions;
  }

  const parsedSessions = parseStoredSessions(raw).filter((session) => session.meet);
  if (store.isActive(userId)) {
    cache.owner = userId;
    cache.raw = raw;
    cache.sessions = parsedSessions;
  }
  return parsedSessions;
}

/**
 * Write `nextSessions` as the user's list and publish it. Skips the storage
 * write when the cache already holds exactly this list for this user, and
 * does nothing once `userId` is no longer the active user.
 */
export async function commitStoredSessions(
  store: SavedSessionsStore,
  userId: string | null,
  nextSessions: SavedSession[],
): Promise<void> {
  if (!userId || !store.isActive(userId)) return;
  const { cache } = store;
  const serialized = JSON.stringify(nextSessions);
  const sameOwner = cache.owner === userId;
  if (!sameOwner || cache.raw !== serialized) {
    await AsyncStorage.setItem(getSavedSessionsKey(userId), serialized);
    if (!store.isActive(userId)) return;
    cache.raw = serialized;
  }
  cache.owner = userId;
  cache.sessions = nextSessions;
  store.publish(nextSessions);
}

/** Remove the user's list from storage and publish an empty one. */
export async function removeStoredSessions(
  store: SavedSessionsStore,
  userId: string,
): Promise<void> {
  await AsyncStorage.removeItem(getSavedSessionsKey(userId));
  if (!store.isActive(userId)) return;
  const { cache } = store;
  cache.owner = userId;
  cache.raw = null;
  cache.sessions = [];
  store.publish([]);
}

/**
 * Re-read the user's list straight from storage and publish it; the last
 * resort when a load failed. Anything that fails here publishes an empty list.
 */
export async function reloadStoredSessionsFallback(
  store: SavedSessionsStore,
  userId: string,
): Promise<void> {
  try {
    const saved = await AsyncStorage.getItem(getSavedSessionsKey(userId));
    if (!store.isActive(userId)) return;
    const validSessions = parseStoredSessions(saved).filter((session) => session.meet);
    const { cache } = store;
    cache.owner = userId;
    cache.raw = saved;
    cache.sessions = validSessions;
    store.publish(validSessions);
  } catch (localError) {
    console.error('Error loading saved sessions from AsyncStorage fallback:', localError);
    // Only for the user this load was for: a newer user's list must not be
    // blanked by the previous user's failed read.
    if (store.isActive(userId)) store.publish([]);
  }
}
