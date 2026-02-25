import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
const savedSessionsSyncRunRef = (
  internal as unknown as { savedSessionsSync: { run: never } }
).savedSessionsSync.run;

// Matches the GitHub Actions cron schedule: '10 3 * * *'
crons.daily(
  "update-past-meet-status",
  { hourUTC: 3, minuteUTC: 10 },
  internal.meetStatusJob.run
);

crons.interval(
  "sync-saved-sessions-from-supabase",
  { hours: 1 },
  savedSessionsSyncRunRef
);

export default crons;
