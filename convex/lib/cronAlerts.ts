/**
 * When a scheduled job's state is worth an email. One incident sends one
 * alert and its recovery one more: a job failing every hour does not email
 * every hour.
 */
export type Alerting = 'failed' | 'missed' | 'stuck';
export type Notice = { kind: Alerting | 'recovered'; job: string; detail: string };

/** After a run ends: alert on the first failure, and on the first success after any alert. */
export function afterRun(job: string, alerting: Alerting | undefined, outcome: { ok: true } | { ok: false; error: string }): { alerting: Alerting | undefined; notice?: Notice } {
  if (!outcome.ok) {
    if (alerting === 'failed') return { alerting };
    return { alerting: 'failed', notice: { kind: 'failed', job, detail: outcome.error } };
  }
  if (alerting) return { alerting: undefined, notice: { kind: 'recovered', job, detail: `ran successfully again after being ${alerting}` } };
  return { alerting: undefined };
}

// A run should have started within this long of its scheduled time.
export const START_MARGIN_MS = 30 * 60_000;
// Convex stops an action after 10 minutes; a run still "running" after this is stuck.
export const STUCK_AFTER_MS = 20 * 60_000;

type Status = { startedAt: number; status: 'running' | 'ok' | 'error'; alerting?: Alerting };

/**
 * The watchdog's view of one job: missed when the run that was due at least
 * START_MARGIN_MS ago never started, stuck when the latest run has been
 * running for over STUCK_AFTER_MS. A job that has never run is not judged
 * (a fresh deployment would otherwise report every job missed).
 */
export function watch(job: string, status: Status | null, due: number, now: number): Notice | undefined {
  if (!status) return undefined;
  if (status.status === 'running' && now - status.startedAt > STUCK_AFTER_MS) {
    if (status.alerting === 'stuck') return undefined;
    return { kind: 'stuck', job, detail: `started ${new Date(status.startedAt).toISOString()} and has not finished` };
  }
  // Cron starts can land a moment before the minute; allow a minute of slack.
  if (status.startedAt < due - 60_000) {
    if (status.alerting === 'missed') return undefined;
    return { kind: 'missed', job, detail: `was due at ${new Date(due).toISOString()} and has not run since ${new Date(status.startedAt).toISOString()}` };
  }
  return undefined;
}
