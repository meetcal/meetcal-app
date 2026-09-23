import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SavedSession } from '@/hooks/useSavedSessions';
import {
  deleteSavedSession,
  deleteSavedSessions,
  MeetCalApiError,
  putSavedSession,
} from '@/lib/api/meetcal-api';
import { devWarn } from '@/lib/logger';

/**
 * Pending-writes outbox for saved sessions.
 *
 * `saveSession` / `removeSession` / `resetAllSessions` write locally first and
 * then call the API. When that call fails (offline, timeout, 5xx, no token)
 * the local row used to be the only record of the change, and the next
 * successful reconcile replaced local state with the server's list — so a
 * session saved on the train was deleted the moment the user got signal.
 *
 * Every local mutation now records what still has to reach the server here,
 * keyed by session id. `mergeServerSessions` keeps dirty rows through a
 * reconcile and `replayOutbox` re-issues them; a flag is cleared only on a
 * 2xx. The backend upsert is idempotent, so replaying twice is harmless.
 */

/**
 * Mirrors `MAX_SAVED_SESSION_ATHLETE_NAMES` in the backend
 * (`app/src/common/query.rs`). A PUT with more names is a 400, which the
 * client used to swallow and then report as a successful save.
 */
export const MAX_SAVED_SESSION_ATHLETE_NAMES = 64;

/** `resets` key meaning "delete every meet", as `DELETE /users/me/saved-sessions` without `meet`. */
export const RESET_ALL_MEETS = '*';

export type PendingSessionOp = 'put' | 'delete';

export interface PendingSessionEntry {
  op: PendingSessionOp;
  /** Monotonic per outbox; a clear only lands when the rev still matches. */
  rev: number;
}

export interface SavedSessionsOutbox {
  sessions: Record<string, PendingSessionEntry>;
  /** Meet name (or `RESET_ALL_MEETS`) → rev of the pending bulk delete. */
  resets: Record<string, number>;
  nextRev: number;
}

export interface ReplayOutboxResult {
  /** The server answered 401: the Clerk session no longer authorises writes. */
  authExpired: boolean;
  /** Entries still pending after this pass (network / server failures). */
  remaining: number;
  /** Entries the server refused with a non-retryable 4xx; dropped from the outbox. */
  rejected: number;
}

const EMPTY_OUTBOX: SavedSessionsOutbox = { sessions: {}, resets: {}, nextRev: 1 };

export function getSavedSessionsOutboxKey(userId: string): string {
  return `@saved_sessions_outbox_${userId}`;
}

/**
 * Tail of the serialized read-modify-write chain. Two overlapping marks
 * (a save racing an auto-unsave) must not each read the same snapshot and
 * have the loser overwrite the winner's entry.
 */
let writeChain: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = writeChain.then(task, task);
  writeChain = run.catch(() => undefined);
  return run;
}

function parseOutbox(raw: string | null): SavedSessionsOutbox {
  if (!raw) return { ...EMPTY_OUTBOX, sessions: {}, resets: {} };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...EMPTY_OUTBOX, sessions: {}, resets: {} };
    }
    const record = parsed as Record<string, unknown>;
    const sessions: Record<string, PendingSessionEntry> = {};
    if (record.sessions && typeof record.sessions === 'object' && !Array.isArray(record.sessions)) {
      for (const [id, entry] of Object.entries(record.sessions as Record<string, unknown>)) {
        if (!entry || typeof entry !== 'object') continue;
        const { op, rev } = entry as Record<string, unknown>;
        if ((op === 'put' || op === 'delete') && typeof rev === 'number' && Number.isInteger(rev)) {
          sessions[id] = { op, rev };
        }
      }
    }
    const resets: Record<string, number> = {};
    if (record.resets && typeof record.resets === 'object' && !Array.isArray(record.resets)) {
      for (const [meet, rev] of Object.entries(record.resets as Record<string, unknown>)) {
        if (typeof rev === 'number' && Number.isInteger(rev)) resets[meet] = rev;
      }
    }
    const nextRev =
      typeof record.nextRev === 'number' && Number.isInteger(record.nextRev) && record.nextRev > 0
        ? record.nextRev
        : 1;
    return { sessions, resets, nextRev };
  } catch {
    return { ...EMPTY_OUTBOX, sessions: {}, resets: {} };
  }
}

export function isOutboxEmpty(outbox: SavedSessionsOutbox): boolean {
  return countPendingWrites(outbox) === 0;
}

export function countPendingWrites(outbox: SavedSessionsOutbox): number {
  return Object.keys(outbox.sessions).length + Object.keys(outbox.resets).length;
}

export async function readOutbox(userId: string): Promise<SavedSessionsOutbox> {
  try {
    return parseOutbox(await AsyncStorage.getItem(getSavedSessionsOutboxKey(userId)));
  } catch (error) {
    console.error('Saved sessions outbox: read failed', error);
    return { ...EMPTY_OUTBOX, sessions: {}, resets: {} };
  }
}

async function writeOutbox(userId: string, outbox: SavedSessionsOutbox): Promise<void> {
  const key = getSavedSessionsOutboxKey(userId);
  if (isOutboxEmpty(outbox)) {
    await AsyncStorage.removeItem(key);
    return;
  }
  await AsyncStorage.setItem(key, JSON.stringify(outbox));
}

async function updateOutbox<T>(
  userId: string,
  mutate: (outbox: SavedSessionsOutbox) => T,
): Promise<T> {
  return enqueue(async () => {
    const outbox = await readOutbox(userId);
    const result = mutate(outbox);
    await writeOutbox(userId, outbox);
    return result;
  });
}

/** Record that `sessionId` needs `op` on the server. Returns the entry's rev. */
export function markSessionPending(
  userId: string,
  sessionId: string,
  op: PendingSessionOp,
): Promise<number> {
  return updateOutbox(userId, (outbox) => {
    const rev = outbox.nextRev++;
    outbox.sessions[sessionId] = { op, rev };
    return rev;
  });
}

/**
 * Record a pending bulk delete. A reset supersedes every per-session entry it
 * covers: a queued PUT for a session in that meet must not resurrect it.
 */
export function markResetPending(userId: string, meet: string | null): Promise<number> {
  return updateOutbox(userId, (outbox) => {
    const rev = outbox.nextRev++;
    const key = meet ?? RESET_ALL_MEETS;
    outbox.resets[key] = rev;
    if (meet === null) {
      outbox.sessions = {};
      outbox.resets = { [RESET_ALL_MEETS]: rev };
    }
    return rev;
  });
}

/**
 * Drop the entry for `sessionId` — but only if it is still the one that was
 * marked with `rev`. A PUT that succeeds after the user has since removed the
 * session must not erase the newer pending DELETE.
 */
export function clearSessionPending(userId: string, sessionId: string, rev: number): Promise<void> {
  return updateOutbox(userId, (outbox) => {
    if (outbox.sessions[sessionId]?.rev === rev) {
      delete outbox.sessions[sessionId];
    }
  });
}

export function clearResetPending(userId: string, meet: string | null, rev: number): Promise<void> {
  return updateOutbox(userId, (outbox) => {
    const key = meet ?? RESET_ALL_MEETS;
    if (outbox.resets[key] === rev) {
      delete outbox.resets[key];
    }
  });
}

export async function clearOutbox(userId: string): Promise<void> {
  await enqueue(() => AsyncStorage.removeItem(getSavedSessionsOutboxKey(userId)));
}

/** First `MAX_SAVED_SESSION_ATHLETE_NAMES` names; `undefined` stays `undefined`. */
export function capAthleteNames(names: string[] | undefined): string[] | undefined {
  if (!names) return undefined;
  if (names.length <= MAX_SAVED_SESSION_ATHLETE_NAMES) return names;
  devWarn(
    `Saved sessions: athlete_names capped at ${MAX_SAVED_SESSION_ATHLETE_NAMES} (had ${names.length})`,
  );
  return names.slice(0, MAX_SAVED_SESSION_ATHLETE_NAMES);
}

/** The PUT body for a session; one mapper so every caller sends the same shape. */
export function toSavedSessionBody(session: SavedSession): Parameters<typeof putSavedSession>[2] {
  return {
    meet: session.meet,
    session_number: session.sessionNumber,
    platform: session.platform,
    weight_class: session.weightClass,
    start_time: session.startTime,
    date: session.date,
    notes: session.notes,
    athlete_names: capAthleteNames(session.athleteNames),
  };
}

function isCoveredByReset(session: SavedSession, outbox: SavedSessionsOutbox): boolean {
  return outbox.resets[RESET_ALL_MEETS] !== undefined || outbox.resets[session.meet] !== undefined;
}

/**
 * Reconcile the server's list with local rows that still have unsent writes.
 *
 * Server rows are the base. A row the outbox says is pending DELETE (or that
 * a pending reset covers) is dropped; a local row pending PUT replaces its
 * server twin or is appended. Everything else is the server's word, so a
 * session removed on another device disappears here too.
 */
export function mergeServerSessions(
  serverSessions: SavedSession[],
  localSessions: SavedSession[],
  outbox: SavedSessionsOutbox,
): SavedSession[] {
  const dirtyPuts = new Map<string, SavedSession>();
  for (const session of localSessions) {
    if (outbox.sessions[session.id]?.op === 'put' && !isCoveredByReset(session, outbox)) {
      dirtyPuts.set(session.id, session);
    }
  }

  const merged: SavedSession[] = [];
  const seen = new Set<string>();
  for (const session of serverSessions) {
    const entry = outbox.sessions[session.id];
    if (entry?.op === 'delete' || isCoveredByReset(session, outbox)) continue;
    seen.add(session.id);
    merged.push(dirtyPuts.get(session.id) ?? session);
  }
  for (const [id, session] of dirtyPuts) {
    if (!seen.has(id)) merged.push(session);
  }
  return merged;
}

export type SyncErrorKind = 'auth' | 'rejected' | 'retry';

/**
 * How a failed write should be treated.
 *
 * - `auth`: 401. The Clerk session no longer authorises writes; keep the
 *   entry and tell the user.
 * - `rejected`: any other 4xx except 408/429. The server understood the
 *   request and refused it, so sending the identical payload again can never
 *   succeed; the entry is dropped and the server's view wins on the next
 *   reconcile.
 * - `retry`: timeout, network, 5xx, missing token. Keep the entry.
 */
export function classifySyncError(error: unknown): SyncErrorKind {
  if (!(error instanceof MeetCalApiError)) return 'retry';
  if (error.status === 401) return 'auth';
  if (error.status === 408 || error.status === 429) return 'retry';
  return error.status >= 400 && error.status < 500 ? 'rejected' : 'retry';
}

/** `DELETE` one session, treating 404 as done: already gone is the outcome wanted. */
export async function deletePendingSession(token: string, sessionId: string): Promise<void> {
  try {
    await deleteSavedSession(token, sessionId);
  } catch (error) {
    if (!(error instanceof MeetCalApiError && error.status === 404)) throw error;
  }
}

/**
 * Re-issue every pending write. Resets go first (a PUT for a session in a
 * meet that is being reset would otherwise be undone by the reset); then
 * per-session PUT/DELETE in rev order. Stops at the first 401: the token is
 * dead, so every later call would fail the same way.
 */
export async function replayOutbox(
  userId: string,
  token: string,
  localSessions: SavedSession[],
): Promise<ReplayOutboxResult> {
  const outbox = await readOutbox(userId);
  const result: ReplayOutboxResult = { authExpired: false, remaining: 0, rejected: 0 };
  if (isOutboxEmpty(outbox)) return result;

  const localById = new Map(localSessions.map((session) => [session.id, session]));

  const settle = async (
    label: string,
    request: () => Promise<unknown>,
    clear: () => Promise<void>,
  ): Promise<boolean> => {
    try {
      await request();
      await clear();
      return true;
    } catch (error) {
      const kind = classifySyncError(error);
      if (kind === 'auth') {
        result.authExpired = true;
        return false;
      }
      if (kind === 'rejected') {
        console.error(`Saved sessions outbox: server rejected ${label}; dropping`, error);
        result.rejected += 1;
        await clear();
        return true;
      }
      devWarn(`Saved sessions outbox: ${label} still pending`, error);
      result.remaining += 1;
      return true;
    }
  };

  const resets = Object.entries(outbox.resets).sort(([, a], [, b]) => a - b);
  for (const [key, rev] of resets) {
    const meet = key === RESET_ALL_MEETS ? null : key;
    const ok = await settle(
      `reset ${key}`,
      () => deleteSavedSessions(token, meet ?? undefined),
      () => clearResetPending(userId, meet, rev),
    );
    if (!ok) return result;
  }

  const sessions = Object.entries(outbox.sessions).sort(([, a], [, b]) => a.rev - b.rev);
  for (const [sessionId, entry] of sessions) {
    let request: () => Promise<unknown>;
    if (entry.op === 'delete') {
      request = () => deletePendingSession(token, sessionId);
    } else {
      const session = localById.get(sessionId);
      if (!session) {
        // Marked PUT but no longer stored locally: nothing to send.
        await clearSessionPending(userId, sessionId, entry.rev);
        continue;
      }
      request = () => putSavedSession(token, sessionId, toSavedSessionBody(session));
    }
    const ok = await settle(
      `${entry.op} ${sessionId}`,
      request,
      () => clearSessionPending(userId, sessionId, entry.rev),
    );
    if (!ok) return result;
  }

  return result;
}
