import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

/**
 * Scheduled jobs that only touch Convex data. (The scrapers read other
 * sites and run outside Convex; they write through `convex/ingest.ts`.)
 */
const crons = cronJobs();

// Hourly rather than the VPS job's daily run: every meet's end date is
// checked on its own calendar, so a completion lands within the hour it
// becomes true in any US zone. It reads the few not-yet-completed meets and
// writes only when one changes.
crons.hourly('complete ended meets', { minuteUTC: 15 }, internal.ingest.completeEndedMeets);

export default crons;
