import { convertToUTC, getMeetConfig } from '@/data/meets/config';
import type { MeetName } from '@/data/types/meet';
import { getMeetSchedule } from '@/lib/database/offline-store';
import {
  readReminderPreference,
  type RemindersPolicy,
  resolveRemindersPolicy,
} from '@/lib/reminder-preference';
import { buildSessionScheduleLookup, withScheduleTimes } from '@/lib/saved-schedule-lookup';
import type { SavedSession } from '@/lib/saved-sessions-store';
import type { Schedule as ScheduleType } from '@/types/schedule';
import {
  cancelNotification,
  listScheduledNotifications,
  scheduleNotification,
  type ScheduledNotificationSummary,
} from '@/utils/notifications';

/**
 * The local "session starts in 1 hour" reminders, kept in line with the
 * saved list by one diff (`syncSessionReminders`) instead of being scheduled
 * by a save and cancelled by a removal.
 *
 * The per-action version drifted: nothing scheduled reminders for sessions
 * that arrived from another device, were migrated, or were saved before
 * reminders were turned on, and nothing cancelled them for a reset, a
 * removal on another device, the auto-unsave prune or a sign-out, so the
 * next account on the device inherited them. The sync compares what should
 * be scheduled against what is, and fixes the difference. Best effort: a
 * failure is logged and never fails a save or a load.
 */

/** A session reminder fires this long before the session's start time. */
export const NOTIFICATION_LEAD_MS = 60 * 60 * 1000;

/** `data.kind` of every reminder this module schedules. */
export const SESSION_REMINDER_KIND = 'session-reminder';

/**
 * A meet-local date older than this many days before today (UTC) cannot
 * start in the future in any time zone, so a meet whose sessions are all
 * older is skipped without looking up its zone or schedule.
 */
const PAST_DATE_SLACK_DAYS = 1;

/**
 * At most this many reminders are pending at once, the soonest first. iOS
 * keeps only 64 pending local notifications and silently drops the rest, so
 * a larger set would look "missing" to every sync and be scheduled again.
 */
export const MAX_PENDING_REMINDERS = 60;

/** When the reminder for a session starting at `sessionStart` fires. */
export function reminderTriggerDate(sessionStart: Date): Date {
  return new Date(sessionStart.getTime() - NOTIFICATION_LEAD_MS);
}

/** A reminder that should be pending: the session (with live times) and when it fires. */
export interface DesiredReminder {
  session: SavedSession;
  triggerAtMs: number;
}

/** A pending session reminder, as read back from the OS. */
export interface ScheduledReminder {
  id: string;
  /** When it was scheduled to fire; `null` for reminders from older builds. */
  triggerAtMs: number | null;
}

/**
 * The session reminders among the pending notifications. Builds before the
 * sync tagged nothing, but always used the session id as both the
 * notification identifier and `data.identifier`.
 */
export function toScheduledReminders(
  notifications: readonly ScheduledNotificationSummary[],
): ScheduledReminder[] {
  const reminders: ScheduledReminder[] = [];
  for (const { identifier, data } of notifications) {
    const isReminder =
      data.kind === SESSION_REMINDER_KIND ||
      (data.kind === undefined && data.identifier === identifier);
    if (!isReminder) continue;
    reminders.push({
      id: identifier,
      triggerAtMs:
        typeof data.triggerAtMs === 'number' && Number.isFinite(data.triggerAtMs)
          ? data.triggerAtMs
          : null,
    });
  }
  return reminders;
}

export interface ReminderPlanInput {
  policy: RemindersPolicy;
  /** Session reminders pending now. */
  scheduled: readonly ScheduledReminder[];
  /** Every saved session id. */
  savedIds: ReadonlySet<string>;
  /** Saved sessions whose reminder should be pending, by id (policy `on`). */
  desired: ReadonlyMap<string, DesiredReminder>;
  /**
   * Saved sessions whose start could not be worked out (meet zone or times
   * unknown, often just offline): their pending reminder is left alone.
   */
  unresolvedIds: ReadonlySet<string>;
}

export interface ReminderPlan {
  cancel: string[];
  schedule: DesiredReminder[];
}

/**
 * What to cancel and what to (re)schedule so the pending reminders match
 * the saved list. A reminder whose fire time moved is scheduled again under
 * the same identifier, which replaces it.
 */
export function planReminderSync({
  policy,
  scheduled,
  savedIds,
  desired,
  unresolvedIds,
}: ReminderPlanInput): ReminderPlan {
  if (policy === 'off') {
    return { cancel: scheduled.map((reminder) => reminder.id), schedule: [] };
  }

  const cancel: string[] = [];
  const pending = new Map<string, ScheduledReminder>();
  for (const reminder of scheduled) {
    if (!savedIds.has(reminder.id)) {
      cancel.push(reminder.id);
      continue;
    }
    if (policy === 'unknown' || unresolvedIds.has(reminder.id)) continue;
    if (!desired.has(reminder.id)) {
      // Saved, but already started (or about to): nothing left to remind.
      cancel.push(reminder.id);
      continue;
    }
    pending.set(reminder.id, reminder);
  }
  if (policy === 'unknown') return { cancel, schedule: [] };

  const schedule: DesiredReminder[] = [];
  for (const [id, reminder] of desired) {
    if (pending.get(id)?.triggerAtMs === reminder.triggerAtMs) continue;
    schedule.push(reminder);
  }
  return { cancel, schedule };
}

export interface ReminderSyncDeps {
  now: () => Date;
  /** The meet's IANA zone, or null when it cannot be resolved. */
  timeZoneFor: (meet: MeetName) => Promise<string | null>;
  /** The latest schedule the device has for the meet (may be empty). */
  readSchedule: (meet: MeetName) => Promise<ScheduleType>;
}

const defaultDeps: ReminderSyncDeps = {
  now: () => new Date(),
  timeZoneFor: async (meet) => {
    try {
      const config = await getMeetConfig(meet);
      return config?.time?.timeZoneIdentifier || null;
    } catch {
      return null;
    }
  },
  // The offline copy, which the schedule resource rewrites on every fetch:
  // no network request per sync.
  readSchedule: (meet) => getMeetSchedule(meet),
};

/** `YYYY-MM-DD` dates before this cannot be upcoming anywhere. */
function pastDateCutoff(now: Date): string {
  const cutoff = new Date(now.getTime() - PAST_DATE_SLACK_DAYS * 24 * 60 * 60 * 1000);
  return cutoff.toISOString().slice(0, 10);
}

/**
 * The reminder each saved session should have: one hour before its start,
 * read from the meet's current schedule (falling back to the saved copy) in
 * the meet's zone, while that moment is still ahead.
 */
export async function resolveDesiredReminders(
  sessions: readonly SavedSession[],
  deps: ReminderSyncDeps,
): Promise<{ desired: Map<string, DesiredReminder>; unresolvedIds: Set<string> }> {
  const desired = new Map<string, DesiredReminder>();
  const unresolvedIds = new Set<string>();
  const nowMs = deps.now().getTime();
  const cutoff = pastDateCutoff(deps.now());

  const byMeet = new Map<MeetName, SavedSession[]>();
  for (const session of sessions) {
    const group = byMeet.get(session.meet);
    if (group) group.push(session);
    else byMeet.set(session.meet, [session]);
  }

  for (const [meet, meetSessions] of byMeet) {
    if (meetSessions.every((session) => session.date && session.date < cutoff)) continue;

    const schedule = await deps.readSchedule(meet).catch(() => [] as ScheduleType);
    const lookup = schedule.length > 0 ? buildSessionScheduleLookup(schedule) : null;
    const timeZone = await deps.timeZoneFor(meet);

    for (const saved of meetSessions) {
      const session = withScheduleTimes(saved, lookup);
      if (!timeZone || !session.date || !session.startTime) {
        unresolvedIds.add(session.id);
        continue;
      }
      let startMs: number;
      try {
        startMs = convertToUTC(session.startTime, session.date, timeZone).getTime();
      } catch {
        unresolvedIds.add(session.id);
        continue;
      }
      if (Number.isNaN(startMs)) {
        unresolvedIds.add(session.id);
        continue;
      }
      const triggerAtMs = reminderTriggerDate(new Date(startMs)).getTime();
      if (triggerAtMs > nowMs) desired.set(session.id, { session, triggerAtMs });
    }
  }
  if (desired.size > MAX_PENDING_REMINDERS) {
    const soonest = [...desired.values()]
      .sort((a, b) => a.triggerAtMs - b.triggerAtMs)
      .slice(0, MAX_PENDING_REMINDERS);
    return {
      desired: new Map(soonest.map((reminder) => [reminder.session.id, reminder])),
      unresolvedIds,
    };
  }
  return { desired, unresolvedIds };
}

async function scheduleReminder({ session, triggerAtMs }: DesiredReminder): Promise<void> {
  await scheduleNotification(
    'Session Reminder',
    `Session ${session.sessionNumber} ${session.platform} starts in 1 hour.`,
    new Date(triggerAtMs),
    session.id,
    {
      id: session.id,
      meet: session.meet,
      sessionNumber: session.sessionNumber,
      platform: session.platform,
      weightClass: session.weightClass,
      startTime: session.startTime,
      weighInTime: session.weighInTime,
      date: session.date,
    },
    { kind: SESSION_REMINDER_KIND, triggerAtMs },
  );
}

/**
 * Make the pending session reminders match `sessions` (the signed-in user's
 * whole saved list; `[]` when signed out) under the reminders policy for
 * `isSubscribed` and the stored preference. Never throws.
 */
export async function syncSessionReminders(
  sessions: readonly SavedSession[],
  isSubscribed: boolean | null,
  deps: ReminderSyncDeps = defaultDeps,
): Promise<void> {
  try {
    const policy = resolveRemindersPolicy(await readReminderPreference(), isSubscribed);
    const scheduled = toScheduledReminders(await listScheduledNotifications());
    const { desired, unresolvedIds } =
      policy === 'on'
        ? await resolveDesiredReminders(sessions, deps)
        : { desired: new Map<string, DesiredReminder>(), unresolvedIds: new Set<string>() };
    const plan = planReminderSync({
      policy,
      scheduled,
      savedIds: new Set(sessions.map((session) => session.id)),
      desired,
      unresolvedIds,
    });

    for (const id of plan.cancel) {
      try {
        await cancelNotification(id);
      } catch (error) {
        console.error(`Session reminders: could not cancel ${id}`, error);
      }
    }
    for (const reminder of plan.schedule) {
      try {
        await scheduleReminder(reminder);
      } catch (error) {
        console.error(`Session reminders: could not schedule ${reminder.session.id}`, error);
      }
    }
  } catch (error) {
    console.error('Session reminders: sync failed', error);
  }
}

export interface ReminderSyncRunner {
  /**
   * Run `task` after the one in flight. Calls made while a task runs are
   * coalesced: only the latest runs next, since each sync is a full diff.
   */
  run(task: () => Promise<void>): Promise<void>;
}

export function createReminderSyncRunner(): ReminderSyncRunner {
  let running: Promise<void> | null = null;
  let next: (() => Promise<void>) | null = null;

  const drain = async () => {
    try {
      while (next) {
        const task = next;
        next = null;
        await task().catch((error: unknown) => {
          console.error('Session reminders: sync task failed', error);
        });
      }
    } finally {
      running = null;
    }
  };

  return {
    run(task) {
      next = task;
      if (!running) running = drain();
      return running;
    },
  };
}
