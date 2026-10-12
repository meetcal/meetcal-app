import { v } from 'convex/values';
import { internalAction, type ActionCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { FunctionReference } from 'convex/server';
import { lastScheduled } from './lib/cronSchedule';
import { describeFailure, START_MARGIN_MS, type Notice } from './lib/cronAlerts';
import { escapeHtml, sendEmail } from './scrapers/lib/email';
import { pingHeartbeat } from './lib/heartbeat';

/**
 * Every scheduled job, its UTC schedule and what it runs. `crons.ts`
 * schedules each through `run` below, which records the run in
 * `cron_status` and emails `ALERT_EMAIL` (OneSignal) when a job fails, when
 * a source starts failing in a job that already is, and when it recovers.
 * The hourly `cron-watchdog` emails when a job missed its run or never
 * finished, and pings `HEARTBEAT_URL` so an external monitor notices when
 * the backend goes quiet. Without `ALERT_EMAIL` (the dev deployment) the
 * alerts are only logged.
 */
type Job = {
  schedule: string;
  run:
    | { kind: 'action'; fn: FunctionReference<'action', 'internal', { dryRun?: boolean }> }
    | { kind: 'mutation'; fn: FunctionReference<'mutation', 'internal', Record<string, never>> };
};

export const JOBS: Record<string, Job> = {
  // Hourly rather than the VPS job's daily run: each meet's end date is
  // checked on its own calendar, so a completion lands within the hour.
  'complete-ended-meets': { schedule: '15 * * * *', run: { kind: 'mutation', fn: internal.ingest.completeEndedMeets } },
  urlwatch: { schedule: '0 * * * *', run: { kind: 'action', fn: internal.scrapers.urlwatch.run } },
  // Catches views up if a refresh failed or was lost, and alerts when they
  // fall hours behind (`views:refreshJob`).
  'views-refresh': { schedule: '50 * * * *', run: { kind: 'action', fn: internal.views.refreshJob } },
  // The daily scrapers keep the UTC times the VPS crontab (US Eastern) ran them at.
  standards: { schedule: '15 3 * * *', run: { kind: 'action', fn: internal.scrapers.standards.run } },
  records: { schedule: '35 3 * * *', run: { kind: 'action', fn: internal.scrapers.records.run } },
  'umwf-records': { schedule: '55 3 * * *', run: { kind: 'action', fn: internal.scrapers.umwf.run } },
  'usamw-national-records': { schedule: '5 4 * * *', run: { kind: 'action', fn: internal.scrapers.usamw.run } },
  'iwf-world-records': { schedule: '15 4 * * *', run: { kind: 'action', fn: internal.scrapers.iwfRecords.run } },
  'intl-rankings': { schedule: '35 4 * * *', run: { kind: 'action', fn: internal.scrapers.intlRankings.run } },
  'meet-sync': { schedule: '5 5 * * *', run: { kind: 'action', fn: internal.scrapers.meets.run } },
  'usamw-events': { schedule: '35 5 * * *', run: { kind: 'action', fn: internal.scrapers.usamwEvents.run } },
  'results-sport80': { schedule: '5 6 * * *', run: { kind: 'action', fn: internal.scrapers.sport80.run } },
  'wso-records': { schedule: '40 6 * * *', run: { kind: 'action', fn: internal.scrapers.wsoRecords.run } },
  entries: { schedule: '25 7 * * *', run: { kind: 'action', fn: internal.scrapers.entries.run } },
};

/**
 * The watchdog runs on its own schedule, outside JOBS: it is what checks
 * them. Its runs are recorded under WATCHDOG_JOB, and every job's run checks
 * that it ran.
 */
export const WATCHDOG_SCHEDULE = '45 * * * *';
export const WATCHDOG_JOB = 'cron-watchdog';

const SUBJECTS: Record<Notice['kind'], string> = {
  failed: 'failed',
  missed: 'missed its run',
  stuck: 'did not finish',
  recovered: 'is running again',
};

async function alert(notices: Notice[]): Promise<void> {
  if (!notices.length) return;
  for (const n of notices) console.warn(`cron alert: ${n.job} ${SUBJECTS[n.kind]}: ${n.detail}`);
  const to = process.env.ALERT_EMAIL;
  if (!to) return;
  const deployment = process.env.CONVEX_CLOUD_URL ?? '';
  const subject =
    notices.length === 1 ? `MeetCal: ${notices[0].job} ${SUBJECTS[notices[0].kind]}` : `MeetCal: ${notices.length} scheduled jobs need attention`;
  const items = notices
    .map((n) => `<li><b>${escapeHtml(n.job)}</b> ${SUBJECTS[n.kind]}<pre style="white-space:pre-wrap;margin:4px 0 12px">${escapeHtml(n.detail.slice(0, 4000))}</pre></li>`)
    .join('');
  await sendEmail(to, subject, `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif"><ul>${items}</ul><p style="color:#6e7781">${escapeHtml(deployment)} · Convex dashboard → Logs for the full run</p></div>`);
}

/** Clears emailed alerts from each job's queue. */
async function markAllSent(ctx: ActionCtx, notices: readonly Notice[]): Promise<void> {
  const byJob = new Map<string, { kind: string; detail: string }[]>();
  for (const { job, kind, detail } of notices) byJob.set(job, [...(byJob.get(job) ?? []), { kind, detail }]);
  for (const [job, sent] of byJob) await ctx.runMutation(internal.cronStatus.markSent, { job, sent });
}

/**
 * Records a run's outcome in `cron_status` and sends the alerts it queued,
 * with `extra` alerts already queued for another job. A failed send leaves
 * them queued: the watchdog sends them next hour.
 */
async function finishRun(ctx: ActionCtx, job: string, failure: unknown, extra: Notice[] = []): Promise<void> {
  const { error, failedSources } = failure === undefined ? { error: undefined, failedSources: undefined } : describeFailure(failure);
  const unsent: Notice[] = await ctx.runMutation(internal.cronStatus.finish, { job, error, failedSources });
  const notices = [...unsent, ...extra];
  if (!notices.length) return;
  try {
    await alert(notices);
    await markAllSent(ctx, notices);
  } catch (sendError) {
    console.error(`cron alert for ${job} could not be sent: ${(sendError as Error).message}`);
  }
}

export const run = internalAction({
  args: { job: v.string() },
  handler: async (ctx, { job }): Promise<void> => {
    const spec = JOBS[job];
    if (!spec) throw new Error(`unknown cron job ${job}`);
    await ctx.runMutation(internal.cronStatus.start, { job });
    let failure: unknown;
    try {
      if (spec.run.kind === 'mutation') await ctx.runMutation(spec.run.fn, {});
      else await ctx.runAction(spec.run.fn, {});
    } catch (error) {
      failure = error;
    }
    // Every job's run also checks on the watchdog, which nothing else does:
    // one that missed its run or never finished is alerted from here. A
    // check that fails must not keep this run from being recorded.
    let watchdogNotice: Notice | null = null;
    try {
      watchdogNotice = await ctx.runMutation(internal.cronStatus.raiseAlert, {
        job: WATCHDOG_JOB,
        due: lastScheduled(WATCHDOG_SCHEDULE, Date.now() - START_MARGIN_MS),
      });
    } catch (error) {
      console.error(`watchdog check from ${job} failed: ${(error as Error).message}`);
    }
    await finishRun(ctx, job, failure, watchdogNotice ? [watchdogNotice] : []);
    // Rethrown so the run also shows as failed in the Convex dashboard.
    if (failure !== undefined) throw failure;
  },
});

/**
 * Hourly: queues an alert for a job whose due run never started or that is
 * still running long after starting, then sends every queued alert (these,
 * and any whose email failed earlier), clearing each only once sent. Its own
 * runs are recorded in `cron_status` like a job's (every job's run checks it
 * ran), and a run that did all that pings the external heartbeat
 * (`lib/heartbeat.ts`), whose monitor alerts when the pings stop.
 */
export const watchdog = internalAction({
  args: {},
  handler: async (ctx): Promise<Notice[]> => {
    await ctx.runMutation(internal.cronStatus.start, { job: WATCHDOG_JOB });
    let failure: unknown;
    let sent: Notice[] = [];
    try {
      sent = await sweep(ctx);
    } catch (error) {
      failure = error;
    }
    await finishRun(ctx, WATCHDOG_JOB, failure);
    if (failure !== undefined) throw failure;
    await pingHeartbeat(process.env.HEARTBEAT_URL);
    return sent;
  },
});

/** The watchdog's check of every job, and its send of every queued alert. */
async function sweep(ctx: ActionCtx): Promise<Notice[]> {
  const now = Date.now();
  const statuses = new Map((await ctx.runQuery(internal.cronStatus.all, {})).map((s) => [s.job, s]));
  const pending: Notice[] = [];
  for (const [job, status] of statuses) {
    for (const u of status.unsent ?? []) pending.push({ job, kind: u.kind as Notice['kind'], detail: u.detail });
  }
  for (const [job, { schedule }] of Object.entries(JOBS)) {
    // Judged and queued in one mutation, against the job's current row; queued
    // before sending, so a failed send is retried rather than re-detected.
    const notice: Notice | null = await ctx.runMutation(internal.cronStatus.raiseAlert, { job, due: lastScheduled(schedule, now - START_MARGIN_MS) });
    if (notice) pending.push(notice);
  }
  if (pending.length === 0) return [];
  await alert(pending);
  await markAllSent(ctx, pending);
  return pending;
}
