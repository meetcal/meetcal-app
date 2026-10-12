import { LiftResult } from '@/data/types/athletes';
import { MeetName } from '@/data/types/meet';
import { fetchSchedule } from '@/lib/database/queries';
import { getMeetData } from '@/lib/database/offline-store';
import { devLog } from '@/lib/logger';
import { posthog } from '@/lib/posthog';
import {
  findLegacySessionsNeedingMigration,
  removeLegacySavedSessionsKey,
  resetLegacySavedSessions,
} from '@/lib/saved-sessions-legacy';
import {
  mergeWithStoredSession,
  revertRefusedSave,
  sessionsFromAthletes,
  upsertSession,
} from '@/lib/saved-sessions-list';
import {
  type FlushResult,
  markResetPending,
  markSessionDelete,
  markSessionPut,
  readOutbox,
} from '@/lib/saved-sessions-outbox';
import type { SerialQueue } from '@/lib/saved-sessions-queue';
import type { SavedSession } from '@/lib/saved-sessions-store';
import type { Schedule as ScheduleType } from '@/types/schedule';

/**
 * The user-facing saved-session mutations. Each one records its outbox entry
 * before the local write (so a crash in between cannot leave a local change
 * with no pending server write), then syncs through the one per-user runner.
 * Every read-modify-write of the list runs on `queue`. Session reminders
 * follow the published list (`lib/saved-sessions-reminders`), so no action
 * schedules or cancels one itself.
 */
export interface SavedSessionsActionDeps {
  /** The active user; every action fails (returns false) without one. */
  userId: string | null;
  /**
   * Every local mutation runs through this queue, so two concurrent saves
   * cannot both read the same list and have the later commit drop the
   * earlier row. Not re-entrant: batch callers loop over the leaf mutations.
   */
  queue: SerialQueue;
  readStoredSessions: () => Promise<SavedSession[]>;
  commitSessions: (nextSessions: SavedSession[]) => Promise<void>;
  syncOutbox: () => Promise<FlushResult | null>;
}

export interface SaveSessionOptions {
  /**
   * Skip the analytics event; used when re-homing rows the user saved long
   * ago (legacy migration).
   */
  silent?: boolean;
}

/** A recorded save: the row as stored, the row it replaced, its outbox rev. */
interface RecordedSave {
  updatedSession: SavedSession;
  previousSession: SavedSession | undefined;
  rev: number;
}

function captureSessionSaved(session: SavedSession, isUpdate: boolean): void {
  posthog.capture('session_saved', {
    meet: session.meet,
    session_number: session.sessionNumber,
    platform: session.platform,
    weight_class: session.weightClass,
    is_update: isUpdate,
    athlete_count: session.athleteNames?.length ?? 0,
  });
}

/**
 * Undo the saves among `saves` that the server refused in `flush` (e.g. the
 * per-user session cap), so the rows do not show as saved and then vanish.
 * A row with a newer queued save or removal is left alone: that write owns
 * it now. Returns the refused saves.
 */
async function revertRefusedSaves(
  deps: SavedSessionsActionDeps,
  userId: string,
  saves: readonly RecordedSave[],
  flush: FlushResult | null,
): Promise<RecordedSave[]> {
  const refused = saves.filter(
    (save) => flush?.rejected.get(save.updatedSession.id) === save.rev,
  );
  if (refused.length === 0) return refused;
  for (const save of refused) {
    console.error(`Saved sessions: server refused ${save.updatedSession.id}`);
  }
  await deps.queue.run(async () => {
    const outbox = await readOutbox(userId);
    let sessions = await deps.readStoredSessions();
    let changed = false;
    for (const save of refused) {
      if (outbox.sessions[save.updatedSession.id]) continue;
      const next = revertRefusedSave(sessions, save.updatedSession, save.previousSession);
      if (next) {
        sessions = next;
        changed = true;
      }
    }
    if (changed) await deps.commitSessions(sessions);
  });
  return refused;
}

/**
 * Record and sync.
 *
 * @returns false when the save failed locally or the server refused it
 * (e.g. the per-user session cap); true once it is stored and either sent
 * or queued for the next sync.
 */
export async function saveSession(
  deps: SavedSessionsActionDeps,
  session: SavedSession,
  options?: SaveSessionOptions,
): Promise<boolean> {
  if (!session.meet) {
    if (deps.userId) console.error('Cannot save session without meet information');
    return false;
  }
  const { userId, queue } = deps;
  if (!userId) return false;

  try {
    // 1. Update local state and AsyncStorage, and record the pending PUT.
    const { isUpdate, ...save } = await queue.run(async () => {
      const storedSessions = await deps.readStoredSessions();
      const upsert = upsertSession(storedSessions, session);
      // Outbox first: a crash before the local write still leaves the PUT
      // (with its body) queued, and the next reconcile restores the row.
      const rev = await markSessionPut(userId, upsert.updatedSession);
      await deps.commitSessions(upsert.nextSessions);
      return {
        updatedSession: upsert.updatedSession,
        previousSession: upsert.previousSession,
        isUpdate: upsert.isUpdate,
        rev,
      };
    });

    if (!options?.silent) captureSessionSaved(save.updatedSession, isUpdate);

    // 2. Upsert to the API when online/authenticated. The outbox entry
    // survives a network failure and is sent on the next load or reconnect.
    // A refusal (e.g. the server's per-user cap) is reported and undone.
    const flush = await deps.syncOutbox();
    const refused = await revertRefusedSaves(deps, userId, [save], flush);
    return refused.length === 0;
  } catch (error) {
    console.error('Error saving session:', error);
    return false;
  }
}

/** Remove one session locally and sync the removal. */
export async function removeSession(
  deps: SavedSessionsActionDeps,
  sessionId: string,
): Promise<boolean> {
  const { userId } = deps;
  if (!userId) return false;

  try {
    // 1. Update local state and AsyncStorage. The list is read from
    // storage, not `savedSessions` state: `pruneStartedSessions` runs from
    // the load effect, whose closure over state is the empty initial array.
    // The outbox entry is recorded before the local write, so a crash in
    // between cannot leave a local removal with no pending DELETE.
    await deps.queue.run(async () => {
      const currentSessions = await deps.readStoredSessions();
      const found = currentSessions.find(session => session.id === sessionId);
      const meet = found?.meet ?? (await readOutbox(userId)).sessions[sessionId]?.meet;
      if (meet) await markSessionDelete(userId, sessionId, meet);
      await deps.commitSessions(currentSessions.filter(session => session.id !== sessionId));
    });

    // 2. Delete from the API when online/authenticated.
    await deps.syncOutbox();

    return true; // Indicate success
  } catch (error) {
    console.error('Error removing session:', error);
    return false;
  }
}

/** How a batch save went: `saved` of the `total` sessions it tried to save. */
export interface SaveSessionsResult {
  total: number;
  saved: number;
}

/**
 * Save one session per (session, platform) the athletes are entered in,
 * merged over any stored row. The meet's schedule is resolved once for the
 * whole batch: `scheduleOverride`, else a fetch, else the offline copy.
 *
 * Every row is recorded (list and outbox) in one step, then the outbox is
 * sent once. Each row used to await its own full sync and reminder, so a
 * club's dozen sessions on venue Wi-Fi could take minutes with no feedback,
 * and one refused row reported the whole batch as failed. Rows queued
 * offline count as saved: they are on the device and sent on the next sync.
 */
export async function saveAllFromAthletes(
  deps: SavedSessionsActionDeps,
  athletes: LiftResult[],
  meet: MeetName,
  scheduleOverride?: ScheduleType,
): Promise<SaveSessionsResult> {
  const { userId } = deps;
  if (!userId) return { total: 0, saved: 0 };

  let total = 0;
  try {
    let schedule = scheduleOverride ?? [];

    if (schedule.length === 0) {
      try {
        schedule = await fetchSchedule(meet);
      } catch (fetchError) {
        console.warn('saveAllFromAthletes: fetchSchedule failed, falling back to cached schedule', fetchError);
        const meetData = await getMeetData(meet).catch(() => null);
        schedule = meetData?.schedule ?? [];
      }
    }

    const rows = sessionsFromAthletes(athletes, meet, schedule);
    total = rows.length;
    if (total === 0) return { total, saved: 0 };

    // Merged against the list as it is inside the queue, so a save or
    // removal the user made while the schedule loaded is not undone (nor a
    // removed row's notes brought back).
    const recorded = await deps.queue.run(async () => {
      let sessions = await deps.readStoredSessions();
      const saves: (RecordedSave & { isUpdate: boolean })[] = [];
      for (const row of rows) {
        const upsert = upsertSession(sessions, mergeWithStoredSession(row, sessions));
        const rev = await markSessionPut(userId, upsert.updatedSession);
        saves.push({
          updatedSession: upsert.updatedSession,
          previousSession: upsert.previousSession,
          isUpdate: upsert.isUpdate,
          rev,
        });
        sessions = upsert.nextSessions;
      }
      await deps.commitSessions(sessions);
      return saves;
    });
    for (const save of recorded) captureSessionSaved(save.updatedSession, save.isUpdate);

    const flush = await deps.syncOutbox();
    const refused = await revertRefusedSaves(deps, userId, recorded, flush);
    return { total, saved: total - refused.length };
  } catch (error) {
    console.error('Error saving sessions:', error);
    return { total, saved: 0 };
  }
}

/** What to tell the user about a batch save, or null when every row was saved. */
export function describeSaveSessionsFailure(result: SaveSessionsResult): string | null {
  if (result.total > 0 && result.saved === result.total) return null;
  if (result.total === 0) return 'There are no sessions to save.';
  if (result.saved === 0) return 'Failed to save sessions.';
  return `Saved ${result.saved} of ${result.total} sessions. The rest could not be saved.`;
}

/**
 * Remove every saved session for `meet`, or every session when no meet is
 * given. Sweeps the legacy storage keys too; the Saved screen used to do
 * that itself, behind the hook's back.
 */
export async function resetAllSessions(
  deps: SavedSessionsActionDeps,
  meet?: MeetName,
): Promise<boolean> {
  const { userId } = deps;
  if (!userId) return false;
  const target = meet ?? null;
  try {
    await deps.queue.run(async () => {
      const currentSessions = await deps.readStoredSessions();
      await markResetPending(userId, target);
      await deps.commitSessions(target ? currentSessions.filter(s => s.meet !== target) : []);
      await resetLegacySavedSessions(userId, target);
    });
    await deps.syncOutbox();
    return true;
  } catch (error) {
    console.error('Error resetting sessions:', error);
    return false;
  }
}

/**
 * Fold sessions stored before they were namespaced by meet into the
 * current list, assigning them to `currentMeet`. Each row goes through
 * `saveSession`, so the writes are serialised and the PUTs are queued like
 * any other save; a legacy key is dropped once its rows are in.
 */
export async function migrateLegacySessions(
  deps: SavedSessionsActionDeps,
  currentMeet: MeetName,
): Promise<boolean> {
  const { userId } = deps;
  if (!userId) return false;
  try {
    const batches = await findLegacySessionsNeedingMigration(userId, currentMeet);
    if (batches.length === 0) return true;
    devLog('Saved sessions: migrating legacy rows', batches.map(b => [b.key, b.sessions.length]));
    const stored = await deps.readStoredSessions();
    const storedIds = new Set(stored.map((session) => session.id));
    let allSaved = true;
    for (const batch of batches) {
      let batchSaved = true;
      for (const session of batch.sessions) {
        // A row already on the current list is newer than its legacy copy;
        // merging the legacy row over it would roll back notes and names.
        if (storedIds.has(session.id)) continue;
        if (await saveSession(deps, session, { silent: true })) {
          storedIds.add(session.id);
        } else {
          batchSaved = false;
        }
      }
      if (batchSaved) await removeLegacySavedSessionsKey(userId, batch.key);
      else allSaved = false;
    }
    return allSaved;
  } catch (error) {
    console.error('Error during session migration:', error);
    return false;
  }
}
