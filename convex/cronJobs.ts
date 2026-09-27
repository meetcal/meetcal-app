import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';
import type { FunctionReference } from 'convex/server';
import { checkIn, monitorConfig } from './lib/sentryCrons';

/**
 * Every scheduled job: its Sentry monitor slug (the backend's job names),
 * its UTC schedule, and what it runs. `crons.ts` schedules each through
 * `run` below, which wraps the job in Sentry Crons check-ins.
 */
type Job = {
  schedule: string;
  run: { kind: 'action'; fn: FunctionReference<'action', 'internal', { dryRun?: boolean }> } | { kind: 'mutation'; fn: FunctionReference<'mutation', 'internal', Record<string, never>> };
  note: string;
};

export const JOBS: Record<string, Job> = {
  // Hourly rather than the VPS job's daily run: each meet's end date is
  // checked on its own calendar, so a completion lands within the hour.
  'complete-ended-meets': { schedule: '15 * * * *', run: { kind: 'mutation', fn: internal.ingest.completeEndedMeets }, note: 'meets whose end date has passed' },
  urlwatch: { schedule: '0 * * * *', run: { kind: 'action', fn: internal.scrapers.urlwatch.run }, note: 'usamasters.net pages; changes emailed' },
  standards: { schedule: '15 3 * * *', run: { kind: 'action', fn: internal.scrapers.standards.run }, note: 'VPS 23:15 EDT' },
  records: { schedule: '35 3 * * *', run: { kind: 'action', fn: internal.scrapers.records.run }, note: 'VPS 23:35 EDT' },
  'umwf-records': { schedule: '55 3 * * *', run: { kind: 'action', fn: internal.scrapers.umwf.run }, note: 'VPS 23:55 EDT' },
  'usamw-national-records': { schedule: '5 4 * * *', run: { kind: 'action', fn: internal.scrapers.usamw.run }, note: 'VPS 00:05 EDT' },
  'iwf-world-records': { schedule: '15 4 * * *', run: { kind: 'action', fn: internal.scrapers.iwfRecords.run }, note: "Wikipedia's lists; iwf.sport is behind a bot challenge" },
  'intl-rankings': { schedule: '35 4 * * *', run: { kind: 'action', fn: internal.scrapers.intlRankings.run }, note: 'VPS 00:35 EDT' },
  'meet-sync': { schedule: '5 5 * * *', run: { kind: 'action', fn: internal.scrapers.meets.run }, note: 'VPS 01:05 EDT' },
  'usamw-events': { schedule: '35 5 * * *', run: { kind: 'action', fn: internal.scrapers.usamwEvents.run }, note: 'VPS 01:35 EDT' },
  'results-sport80': { schedule: '5 6 * * *', run: { kind: 'action', fn: internal.scrapers.sport80.run }, note: 'VPS 02:05 EDT' },
  'wso-records': { schedule: '40 6 * * *', run: { kind: 'action', fn: internal.scrapers.wsoRecords.run }, note: 'VPS 02:40 EDT' },
  entries: { schedule: '25 7 * * *', run: { kind: 'action', fn: internal.scrapers.entries.run }, note: "VPS 03:25 EDT; Sport80's JSON endpoint" },
};

export const run = internalAction({
  args: { job: v.string() },
  handler: async (ctx, { job }): Promise<void> => {
    const spec = JOBS[job];
    if (!spec) throw new Error(`unknown cron job ${job}`);
    const started = Date.now();
    const checkInId = await checkIn(job, { status: 'in_progress', monitor_config: monitorConfig(spec.schedule) });
    const finish = (status: 'ok' | 'error') =>
      checkIn(job, { status, duration: (Date.now() - started) / 1000, ...(checkInId ? { check_in_id: checkInId } : {}) });
    try {
      if (spec.run.kind === 'mutation') await ctx.runMutation(spec.run.fn, {});
      else await ctx.runAction(spec.run.fn, {});
    } catch (error) {
      await finish('error');
      throw error;
    }
    await finish('ok');
  },
});
