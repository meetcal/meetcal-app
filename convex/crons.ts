import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';
import { JOBS } from './cronJobs';

/**
 * Every scheduled job, from the table in `cronJobs.ts` (schedules in UTC; the
 * scrapers keep the UTC times the retired VPS crontab ran them at). Each runs
 * through `cronJobs:run`, which checks in with Sentry Crons under the job's
 * name, the monitor slug the backend used.
 */
const crons = cronJobs();

for (const [job, { schedule }] of Object.entries(JOBS)) {
  crons.cron(job, schedule, internal.cronJobs.run, { job });
}

export default crons;
