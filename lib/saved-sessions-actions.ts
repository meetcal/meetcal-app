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
import {
  cancelSavedSessionReminder,
  readNotificationsEnabled,
  scheduleSavedSessionReminder,
} from '@/lib/saved-sessions-reminders';
import type { SavedSession } from '@/lib/saved-sessions-store';
import type { Schedule as ScheduleType } from '@/types/schedule';

/**
 * The user-facing saved-session mutations. Each one records its outbox entry
 * before the local write (so a crash in between cannot leave a local change
 * with no pending server write), then syncs through the one per-user runner.
 * Every read-modify-write of the list runs on `queue`.
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
   * The meet's schedule when the caller already has it. The reminder needs
   * the session's day, and `fetchSchedule` only de-duplicates *concurrent*
   * callers — so the sequential save loop in `saveSessionsFromAthletes` used
   * to issue one full `GET /meets/schedule` per saved session for the same
   * meet. Passing the already-resolved schedule collapses those back to the
   * one fetch the caller made. Must be non-empty: an empty schedule is
   * exactly the case where the fetch is still worth making.
   */
  schedule?: ScheduleType;
  /**
   * The already-read value of `NOTIFICATION_ENABLED_KEY`. The flag is a
   * single user preference that cannot change while a batch save is running,
   * so the per-session loop in `saveSessionsFromAthletes` — up to one
   * iteration per session on a meet's full roster — reads it once instead of
   * issuing one AsyncStorage round trip per saved session.
   */
  notificationsEnabled?: boolean;
  /**
   * Skip the analytics event and the reminder; used when re-homing rows the
   * user saved long ago (legacy migration).
   */
  silent?: boolean;
}

/**
 * Record, sync, schedule the reminder.
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
  return saveSessionBuiltFrom(deps, () => session, options);
}

/**
 * `saveSession` for a row that depends on the stored list: `build` receives
 * the list as read inside the mutation queue, right before the upsert that
 * publishes it. A caller that awaits between reads (the batch save awaits a
 * sync and a reminder per row) would otherwise merge against a list a
 * concurrent save or removal has already replaced, and undo that change
 * when it publishes.
 */
async function saveSessionBuiltFrom(
  deps: SavedSessionsActionDeps,
  build: (storedSessions: SavedSession[]) => SavedSession,
  options?: SaveSessionOptions,
): Promise<boolean> {
  const { userId, queue } = deps;
  if (!userId) return false;

  try {
    // 1. Update local state and AsyncStorage, and record the pending PUT.
    const { updatedSession, previousSession, isUpdate, rev } = await queue.run(async () => {
      const storedSessions = await deps.readStoredSessions();
      const upsert = upsertSession(storedSessions, build(storedSessions));
      // Outbox first: a crash before the local write still leaves the PUT
      // (with its body) queued, and the next reconcile restores the row.
      const rev = await markSessionPut(userId, upsert.updatedSession);
      await deps.commitSessions(upsert.nextSessions);
      return { ...upsert, rev };
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
    // A refusal (e.g. the server's per-user cap) is reported and undone
    // locally, so the row does not show as saved and then vanish.
    const flush = await deps.syncOutbox();
    if (flush?.rejected.get(updatedSession.id) === rev) {
      console.error(`Saved sessions: server refused ${updatedSession.id}`);
      await queue.run(async () => {
        // A newer save or removal of this session is queued: it owns the
        // row now, so leave it alone.
        if ((await readOutbox(userId)).sessions[updatedSession.id]) return;
        const next = revertRefusedSave(
          await deps.readStoredSessions(),
          updatedSession,
          previousSession,
        );
        if (next) await deps.commitSessions(next);
      });
      return false;
    }
    if (options?.silent) return true;

    // 3. Schedule the local reminder 1 hour before the session starts.
    await scheduleSavedSessionReminder(updatedSession, options);

    return true; // Indicate success
  } catch (error) {
    console.error('Error saving session:', error);
    return false;
  }
}

/** Remove one session locally, sync the removal, cancel its reminder. */
export async function removeSession(
  deps: SavedSessionsActionDeps,
  sessionId: string,
): Promise<boolean> {
  const { userId } = deps;
  if (!userId) return false;

  try {
    // 1. Update local state and AsyncStorage. The lookup for the
    // notification cancel below reads storage, not `savedSessions` state:
    // `pruneStartedSessions` runs from the load effect, whose closure over
    // state is the empty initial array, so the session was never found and
    // its reminder fired for a session the user no longer had.
    // The outbox entry is recorded before the local write, so a crash in
    // between cannot leave a local removal with no pending DELETE.
    const sessionToRemove = await deps.queue.run(async () => {
      const currentSessions = await deps.readStoredSessions();
      const found = currentSessions.find(session => session.id === sessionId);
      const meet = found?.meet ?? (await readOutbox(userId)).sessions[sessionId]?.meet;
      if (meet) await markSessionDelete(userId, sessionId, meet);
      await deps.commitSessions(currentSessions.filter(session => session.id !== sessionId));
      return found;
    });

    // 2. Delete from the API when online/authenticated.
    await deps.syncOutbox();

    // 3. Cancel the reminder, if the session was actually found.
    await cancelSavedSessionReminder(sessionId, sessionToRemove);

    return true; // Indicate success
  } catch (error) {
    console.error('Error removing session:', error);
    return false;
  }
}

/**
 * Save one session per (session, platform) the athletes are entered in,
 * merged over any stored row. The meet's schedule is resolved once for the
 * whole batch: `scheduleOverride`, else a fetch, else the offline copy.
 */
export async function saveSessionsFromAthletes(
  deps: SavedSessionsActionDeps,
  athletes: LiftResult[],
  meet: MeetName,
  scheduleOverride?: ScheduleType,
): Promise<boolean> {
  if (!deps.userId) return false;

  try {
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

    const uniqueSessionsToSave = sessionsFromAthletes(athletes, meet, schedule);

    // One read for the whole batch. `saveSession` otherwise re-reads this
    // single boolean preference from AsyncStorage once per session, and a
    // full national-meet roster produces one session per platform-session
    // on the schedule.
    const notificationsEnabled = await readNotificationsEnabled();

    let allSavesSucceeded = true;
    for (const sessionToSave of uniqueSessionsToSave) {
      // Merged against the list as it is when this row is published, not a
      // snapshot from before the loop: every iteration awaits a sync and a
      // reminder, and a save or removal the user makes meanwhile must not
      // be undone (or its removed notes brought back) by a later row.
      // `schedule` is the same meet's schedule for every iteration, so hand
      // it over rather than letting each save re-fetch it.
      const success = await saveSessionBuiltFrom(
        deps,
        (storedSessions) => mergeWithStoredSession(sessionToSave, storedSessions),
        { schedule, notificationsEnabled },
      );
      if (!success) {
        allSavesSucceeded = false;
        console.error(`Failed to save session ${sessionToSave.id} from start list.`);
      }
    }

    return allSavesSucceeded; // Indicate if all individual saves were successful
  } catch (error) {
    console.error('Error saving sessions:', error);
    return false;
  }
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
