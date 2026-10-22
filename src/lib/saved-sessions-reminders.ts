import { convertToUTC, getMeetConfig } from '@/data/meets/config';
import type { MeetName } from '@/data/types/meet';
import {
  getServerClockSample,
  MAX_PLAUSIBLE_CLOCK_SKEW_MS,
  type ServerClockSample,
} from '@/lib/api/meetcal-api';
import { exactAlarmsFromStatus, readExactAlarmStatus } from '@/lib/exact-alarms';
import { devLog } from '@/lib/logger';
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
import { resolvedMeetTimeZone } from '@/utils/timezone';

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
 * older (on its current schedule) is skipped without looking up its zone.
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

/**
 * A scheduled reminder whose device-clock fire time is within this of the
 * wanted one is left alone: each clock sample moves the skew by a few ms, and
 * rescheduling for that would churn every reminder on every sync.
 */
export const REMINDER_FIRE_TOLERANCE_MS = 60 * 1000;

/**
 * How old a server clock sample may be and still correct reminders. The app
 * resamples every `SERVER_CLOCK_RESAMPLE_MS` (10 minutes) while it talks to
 * the backend, so an hour covers a normal session without trusting a sample
 * from before a clock change.
 */
export const REMINDER_CLOCK_SAMPLE_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Server time minus device time to correct reminders by: the last sample's
 * skew, or `null` before this process has one.
 *
 * Reminders used the raw device clock, while the prune measures "now" on the
 * server's: with the device two hours fast, a 2:00 PM session's reminder
 * fired at 11:00 AM and sessions in the next two hours got none. Unlike the
 * prune, a large skew is still applied (a late or early reminder is the
 * failure it corrects, and nothing is deleted on it), but it is logged.
 *
 * `null` is not 0: a cold start offline (at a venue) has no sample, and
 * reading that as "the device clock is right" rescheduled every corrected
 * reminder on the wrong clock and cancelled those due within the skew.
 */
export function reminderClockSkewMs(
  sample: ServerClockSample | null,
  deviceNowMs: number = Date.now(),
): number | null {
  if (!sample || !Number.isFinite(sample.skewMs)) return null;
  // A sample measures the device clock as it was then. One taken in the
  // device's future (the clock was set back since) or long ago (it may have
  // jumped since, by NTP or by hand) says nothing reliable about it now:
  // unknown, which keeps pending reminders rather than moving them.
  const ageMs = deviceNowMs - sample.sampledAt;
  if (ageMs < 0 || ageMs > REMINDER_CLOCK_SAMPLE_MAX_AGE_MS) return null;
  if (Math.abs(sample.skewMs) > MAX_PLAUSIBLE_CLOCK_SKEW_MS) {
    devLog('Session reminders: device clock is off by', sample.skewMs, 'ms; correcting for it');
  }
  return sample.skewMs;
}

/** A reminder that should be pending: the session (with live times) and when it fires. */
export interface DesiredReminder {
  session: SavedSession;
  /** When it should fire, on the server's clock. */
  triggerAtMs: number;
  /** The same moment on the device's clock, which the OS fires by. */
  fireAtMs: number;
  /**
   * The device clock's skew is not known yet (no server clock sample), so
   * `fireAtMs` is only the device clock's reading of `triggerAtMs`. A
   * pending reminder for the same moment is kept as it is: it may already
   * carry a correction this sync cannot check.
   */
  skewUnknown?: boolean;
}

/** A pending session reminder, as read back from the OS. */
export interface ScheduledReminder {
  id: string;
  /** When it was scheduled to fire; `null` for reminders from older builds. */
  triggerAtMs: number | null;
  /**
   * The device-clock instant it was scheduled for; `null` for reminders from
   * builds that scheduled on the device clock (so it equals `triggerAtMs`).
   */
  fireAtMs?: number | null;
  /**
   * Whether Android set it as an exact alarm; `null` where that is not
   * tracked (iOS, Android before 12, older builds).
   */
  exact?: boolean | null;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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
      triggerAtMs: finiteOrNull(data.triggerAtMs),
      fireAtMs: finiteOrNull(data.fireAtMs),
      exact: typeof data.exact === 'boolean' ? data.exact : null,
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
  /**
   * Whether a reminder scheduled now is an exact alarm (Android 12+), or
   * `null` where that is not tracked. Android leaves an alarm set without
   * the permission inexact after it is granted, and cancels exact alarms
   * when it is revoked, so a pending reminder set under the other answer is
   * scheduled again.
   */
  exactAlarms?: boolean | null;
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
  exactAlarms = null,
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
    const current = pending.get(id);
    if (current && current.triggerAtMs === reminder.triggerAtMs) {
      const exactnessChanged = exactAlarms !== null && (current.exact ?? null) !== exactAlarms;
      if (exactnessChanged && reminder.skewUnknown) {
        // Set it again at the time it already has, which may carry a clock
        // correction this sync cannot check.
        schedule.push({ ...reminder, fireAtMs: current.fireAtMs ?? current.triggerAtMs });
        continue;
      }
      if (exactnessChanged) {
        schedule.push(reminder);
        continue;
      }
      if (reminder.skewUnknown) continue;
      // The device clock was corrected (or found wrong) since it was
      // scheduled: the OS would fire it by the old reading.
      const firesAt = current.fireAtMs ?? current.triggerAtMs;
      if (Math.abs(firesAt - reminder.fireAtMs) <= REMINDER_FIRE_TOLERANCE_MS) continue;
    }
    schedule.push(reminder);
  }
  return { cancel, schedule };
}

export interface ReminderSyncDeps {
  /** The device clock. */
  now: () => Date;
  /**
   * Server time minus device time (`reminderClockSkewMs`), or `null` before
   * the first server clock sample. Taken as 0 when omitted.
   */
  clockSkewMs?: () => number | null;
  /** The meet's IANA zone, or null when it cannot be resolved. */
  timeZoneFor: (meet: MeetName) => Promise<string | null>;
  /** The latest schedule the device has for the meet (may be empty). */
  readSchedule: (meet: MeetName) => Promise<ScheduleType>;
  /**
   * Whether reminders scheduled now are exact alarms (`exactAlarmsFromStatus`).
   * Taken as `null` (not tracked) when omitted.
   */
  exactAlarms?: () => Promise<boolean | null>;
}

export const defaultReminderSyncDeps: ReminderSyncDeps = {
  now: () => new Date(),
  clockSkewMs: () => reminderClockSkewMs(getServerClockSample()),
  timeZoneFor: async (meet) => {
    try {
      // `null` for a meet with no known zone, not the mapper's New York
      // fallback, which reminded a Los Angeles session three hours early.
      return resolvedMeetTimeZone(await getMeetConfig(meet));
    } catch {
      return null;
    }
  },
  // The offline copy, which the schedule resource rewrites on every fetch:
  // no network request per sync.
  readSchedule: (meet) => getMeetSchedule(meet),
  exactAlarms: async () => exactAlarmsFromStatus(await readExactAlarmStatus()),
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
  const sampledSkewMs = deps.clockSkewMs ? deps.clockSkewMs() : 0;
  const skewUnknown = sampledSkewMs === null;
  const skewMs = sampledSkewMs ?? 0;
  // Now on the server's clock (the device's, until it has been sampled):
  // what "still ahead" is measured against.
  const nowMs = deps.now().getTime() + skewMs;
  const cutoff = pastDateCutoff(new Date(nowMs));

  const byMeet = new Map<MeetName, SavedSession[]>();
  for (const session of sessions) {
    const group = byMeet.get(session.meet);
    if (group) group.push(session);
    else byMeet.set(session.meet, [session]);
  }

  for (const [meet, meetSessions] of byMeet) {
    // The schedule is read before the past-date check: a saved row keeps the
    // date it was saved with, so a session moved from an old day to an
    // upcoming one would otherwise be skipped and lose its reminder.
    const schedule = await deps.readSchedule(meet).catch(() => [] as ScheduleType);
    const lookup = schedule.length > 0 ? buildSessionScheduleLookup(schedule) : null;
    const timedSessions = meetSessions.map((saved) => withScheduleTimes(saved, lookup));
    if (timedSessions.every((session) => session.date && session.date < cutoff)) {
      // With no clock sample the cutoff is the device clock's, which may be
      // days fast: a meet past only by it keeps its pending reminders.
      if (skewUnknown) for (const session of timedSessions) unresolvedIds.add(session.id);
      continue;
    }

    const timeZone = await deps.timeZoneFor(meet);

    for (const session of timedSessions) {
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
      if (triggerAtMs > nowMs) {
        desired.set(session.id, {
          session,
          triggerAtMs,
          fireAtMs: triggerAtMs - skewMs,
          ...(skewUnknown ? { skewUnknown: true } : {}),
        });
      } else if (skewUnknown) {
        // Past by the device clock, which may be fast: on the server's it can
        // still be ahead. Its pending reminder (if any) is left alone.
        unresolvedIds.add(session.id);
      }
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

async function scheduleReminder(
  { session, triggerAtMs, fireAtMs }: DesiredReminder,
  exactAlarms: boolean | null,
): Promise<void> {
  await scheduleNotification(
    'Session Reminder',
    `Session ${session.sessionNumber} ${session.platform} starts in 1 hour.`,
    new Date(fireAtMs),
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
    {
      kind: SESSION_REMINDER_KIND,
      triggerAtMs,
      fireAtMs,
      ...(exactAlarms === null ? {} : { exact: exactAlarms }),
    },
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
  deps: ReminderSyncDeps = defaultReminderSyncDeps,
): Promise<void> {
  try {
    const policy = resolveRemindersPolicy(await readReminderPreference(), isSubscribed);
    const scheduled = toScheduledReminders(await listScheduledNotifications());
    const { desired, unresolvedIds } =
      policy === 'on'
        ? await resolveDesiredReminders(sessions, deps)
        : { desired: new Map<string, DesiredReminder>(), unresolvedIds: new Set<string>() };
    const exactAlarms = policy === 'on' && deps.exactAlarms ? await deps.exactAlarms() : null;
    const plan = planReminderSync({
      policy,
      scheduled,
      savedIds: new Set(sessions.map((session) => session.id)),
      desired,
      unresolvedIds,
      exactAlarms,
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
        await scheduleReminder(reminder, exactAlarms);
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
