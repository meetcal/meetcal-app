import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';
import { JOBS, WATCHDOG_SCHEDULE } from './cronJobs';

/**
 * Every scheduled job, from the table in `cronJobs.ts` (schedules in UTC).
 * Each runs through `cronJobs:run`, which emails an alert when it fails; the
 * watchdog emails when one misses its run or never finishes.
 */
const crons = cronJobs();

for (const [job, { schedule }] of Object.entries(JOBS)) {
  crons.cron(job, schedule, internal.cronJobs.run, { job });
}
crons.cron('cron-watchdog', WATCHDOG_SCHEDULE, internal.cronJobs.watchdog, {});

export default crons;
