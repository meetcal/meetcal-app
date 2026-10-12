import { ConvexError } from 'convex/values';

/**
 * When a scheduled job's state is worth an email. One incident sends one
 * alert and its recovery one more: a job failing every hour does not email
 * every hour. A job that reads many sources (a WSO each, a meet each) names
 * the ones that failed, and a source failing that was not failing before is
 * a new incident, emailed even while the job is already failing.
 */
export type Alerting = 'failed' | 'missed' | 'stuck';
export type Notice = { kind: Alerting | 'recovered'; job: string; detail: string };
export type RunOutcome = { ok: true } | { ok: false; error: string; failedSources?: readonly string[] };

/**
 * After a run ends: alert on the first failure, on a failure of a source
 * that was not failing in the run before (`failingBefore`), and on the
 * first success after any alert. Returns the sources to remember as failing.
 */
export function afterRun(
  job: string,
  alerting: Alerting | undefined,
  outcome: RunOutcome,
  failingBefore?: readonly string[],
): { alerting: Alerting | undefined; failedSources?: string[]; notice?: Notice } {
  if (!outcome.ok) {
    // A new incident starts the list (none failing yet when the whole job
    // failed, so a source failing next run still emails). A failure that
    // names no sources while the job already is failing says nothing about
    // which recovered, so the ones known to be failing are kept. Only a row
    // from before sources were tracked has no list, and stays quiet once.
    if (alerting !== 'failed') {
      return { alerting: 'failed', failedSources: [...(outcome.failedSources ?? [])], notice: { kind: 'failed', job, detail: outcome.error } };
    }
    const failedSources = outcome.failedSources ? [...outcome.failedSources] : failingBefore ? [...failingBefore] : undefined;
    const added = outcome.failedSources && failingBefore ? outcome.failedSources.filter((source) => !failingBefore.includes(source)) : [];
    if (!added.length) return { alerting, failedSources };
    return { alerting, failedSources, notice: { kind: 'failed', job, detail: `now also failing: ${added.join(', ')}\n\n${outcome.error}` } };
  }
  if (alerting) return { alerting: undefined, notice: { kind: 'recovered', job, detail: `ran successfully again after being ${alerting}` } };
  return { alerting: undefined };
}

export type SourceFailure = { source: string; error: string };
type SourcesFailedData = { message: string; failedSources: string[] };

/**
 * What a job throws when some of its sources failed (after storing the rest):
 * the message names each failure, for the logs and the email, and the error
 * carries the source names so `afterRun` can tell a new failure from one
 * already reported. Source names must be stable from run to run (a WSO, a
 * meet and its event id), never the error text.
 */
export function sourcesFailed(summary: string, failures: readonly SourceFailure[]): ConvexError<SourcesFailedData> {
  const message = `${summary}: ${failures.map(({ source, error }) => `${source}: ${error}`).join('; ')}`;
  const error = new ConvexError<SourcesFailedData>({ message, failedSources: [...new Set(failures.map((f) => f.source))].sort() });
  // ConvexError's own message is its data as JSON; the logs read better with the text.
  error.message = message;
  return error;
}

function isSourcesFailedData(data: unknown): data is SourcesFailedData {
  if (typeof data !== 'object' || data === null) return false;
  const { message, failedSources } = data as Record<string, unknown>;
  return typeof message === 'string' && Array.isArray(failedSources) && failedSources.every((s) => typeof s === 'string');
}

/** A failed run's error text, and its failed sources when the job threw `sourcesFailed` (the data survives `runAction`). */
export function describeFailure(failure: unknown): { error: string; failedSources?: string[] } {
  const data = typeof failure === 'object' && failure !== null && 'data' in failure ? failure.data : undefined;
  if (isSourcesFailedData(data)) return { error: data.message, failedSources: data.failedSources };
  return { error: failure instanceof Error ? failure.message : String(failure) };
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
