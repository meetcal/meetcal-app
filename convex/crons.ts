import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Matches the GitHub Actions cron schedule: '10 3 * * *'
crons.daily(
  "update-past-meet-status",
  { hourUTC: 3, minuteUTC: 10 },
  internal.meetStatusJob.run
);

crons.interval(
  "auto-unsave-started-sessions",
  { minutes: 15 },
  internal.autoUnsaveSavedSessionsJob.run,
);

export default crons;
