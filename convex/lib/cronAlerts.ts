import { ConvexError } from 'convex/values';
import { errorMessage } from './errors';
import { isRecord } from './json';

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

export type SourceFailure = { source: string; error: string; notReached?: boolean };
type FailureRecord = { source: string; error: string; notReached: boolean };
type SourcesFailedData = { message: string; failedSources: string[]; failures: FailureRecord[] };
export type RunFailure = { error: string; failedSources?: string[]; failures?: FailureRecord[] };

export function sourcesFailed(summary: string, failures: readonly SourceFailure[]): ConvexError<SourcesFailedData> {
  const message = `${summary}: ${failures.map(({ source, error }) => `${source}: ${error}`).join('; ')}`;
  const error = new ConvexError<SourcesFailedData>({
    message,
    failedSources: [...new Set(failures.map((f) => f.source))].sort(),
    failures: failures.map(({ source, error: text, notReached }) => ({ source, error: text, notReached: notReached === true })),
  });
  error.message = message;
  return error;
}

const isFailureRecord = (value: unknown): value is FailureRecord =>
  isRecord(value) && typeof value.source === 'string' && typeof value.error === 'string' && typeof value.notReached === 'boolean';

function isSourcesFailedData(data: unknown): data is SourcesFailedData {
  if (!isRecord(data)) return false;
  const { message, failedSources, failures } = data;
  return typeof message === 'string' && Array.isArray(failedSources) && failedSources.every((s) => typeof s === 'string') && Array.isArray(failures) && failures.every(isFailureRecord);
}

export function describeFailure(failure: unknown): RunFailure {
  const data = isRecord(failure) ? failure.data : undefined;
  if (isSourcesFailedData(data)) return { error: data.message, failedSources: data.failedSources, failures: data.failures };
  return { error: errorMessage(failure) };
}

export const MAX_CONTINUATIONS = 5;

export type NextLink = { notReached: string[]; failed: SourceFailure[] };

export function nextLink(failure: RunFailure | undefined, asked: readonly string[] | undefined, continuations: number): NextLink | null {
  const failures = failure?.failures ?? [];
  const notReached = failures.filter((f) => f.notReached).map((f) => f.source);
  if (notReached.length === 0 || continuations >= MAX_CONTINUATIONS) return null;
  if (asked !== undefined && notReached.length >= asked.length) return null;
  return { notReached, failed: failures.filter((f) => !f.notReached).map(({ source, error }) => ({ source, error })) };
}

export function chainOutcome(
  job: string,
  carried: readonly SourceFailure[],
  failure: RunFailure | undefined,
  pending: readonly string[] = [],
): RunFailure | undefined {
  if (failure === undefined) return carried.length === 0 ? undefined : describeFailure(sourcesFailed(`${job}: failed earlier in this run`, carried));
  if (failure.failures !== undefined) {
    return carried.length === 0 ? failure : describeFailure(sourcesFailed(`${job}: failed in this run and its continuations`, [...carried, ...failure.failures]));
  }
  const left = [...carried, ...pending.map((source) => ({ source, error: `not reached: ${failure.error}` }))];
  if (left.length === 0) return failure;
  const named = describeFailure(sourcesFailed(`${job}: failed earlier in this run or not reached`, left));
  return { error: `${failure.error}\n\n${named.error}`, failedSources: named.failedSources };
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
