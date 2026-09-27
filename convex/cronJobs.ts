import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';
import type { FunctionReference } from 'convex/server';
import { lastScheduled } from './lib/cronSchedule';
import { START_MARGIN_MS, watch, type Notice } from './lib/cronAlerts';
import { escapeHtml, sendEmail } from './scrapers/lib/email';

/**
 * Every scheduled job, its UTC schedule and what it runs. `crons.ts`
 * schedules each through `run` below, which records the run in
 * `cron_status` and emails `ALERT_EMAIL` (OneSignal) when a job fails, and
 * again when it recovers. The hourly `cron-watchdog` emails when a job missed
 * its run or never finished. Without `ALERT_EMAIL` (the dev deployment) the
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

/** The watchdog runs on its own schedule, outside JOBS: it is what checks them. */
export const WATCHDOG_SCHEDULE = '45 * * * *';

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
    const message = failure === undefined ? undefined : failure instanceof Error ? failure.message : String(failure);
    const notice = await ctx.runMutation(internal.cronStatus.finish, { job, error: message });
    if (notice) {
      try {
        await alert([notice]);
      } catch (error) {
        console.error(`cron alert for ${job} could not be sent: ${(error as Error).message}`);
      }
    }
    // Rethrown so the run also shows as failed in the Convex dashboard.
    if (failure !== undefined) throw failure;
  },
});

/** Hourly: a job whose due run never started, or that is still running long after starting. */
export const watchdog = internalAction({
  args: {},
  handler: async (ctx): Promise<Notice[]> => {
    const now = Date.now();
    const statuses = new Map((await ctx.runQuery(internal.cronStatus.all, {})).map((s) => [s.job, s]));
    const notices: Notice[] = [];
    for (const [job, { schedule }] of Object.entries(JOBS)) {
      const notice = watch(job, statuses.get(job) ?? null, lastScheduled(schedule, now - START_MARGIN_MS), now);
      if (notice) notices.push(notice);
    }
    await alert(notices);
    for (const n of notices) await ctx.runMutation(internal.cronStatus.markAlerting, { job: n.job, alerting: n.kind as 'missed' | 'stuck' });
    return notices;
  },
});
