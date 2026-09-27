import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

/**
 * Every scheduled job. Scrapers are ported from the retired VPS crontab
 * (`meetcal-backend/scrapers/run_scraper_job.sh`) at the same UTC times the
 * VPS ran them (its clock was US Eastern, EDT).
 */
const crons = cronJobs();

// Hourly rather than the VPS job's daily run: every meet's end date is
// checked on its own calendar, so a completion lands within the hour it
// becomes true in any US zone. It reads the few not-yet-completed meets and
// writes only when one changes.
crons.hourly('complete ended meets', { minuteUTC: 15 }, internal.ingest.completeEndedMeets);

// VPS: `15 23 * * *` EDT.
crons.daily('standards', { hourUTC: 3, minuteUTC: 15 }, internal.scrapers.standards.run, {});

// VPS: `35 23 * * *` EDT.
crons.daily('usaw records', { hourUTC: 3, minuteUTC: 35 }, internal.scrapers.records.run, {});

// VPS: `55 23 * * *` EDT.
crons.daily('umwf records', { hourUTC: 3, minuteUTC: 55 }, internal.scrapers.umwf.run, {});

// VPS: `5 0 * * *` EDT.
crons.daily('usamw national records', { hourUTC: 4, minuteUTC: 5 }, internal.scrapers.usamw.run, {});

// VPS: `35 0 * * *` EDT.
crons.daily('intl rankings', { hourUTC: 4, minuteUTC: 35 }, internal.scrapers.intlRankings.run, {});

// VPS: `5 1 * * *` EDT.
crons.daily('meet sync', { hourUTC: 5, minuteUTC: 5 }, internal.scrapers.meets.run, {});

// USA Masters events from usamasters.net (the VPS's usamw-events job).
crons.daily('usamw events', { hourUTC: 5, minuteUTC: 35 }, internal.scrapers.usamwEvents.run, {});

// VPS: `5 2 * * *` EDT.
crons.daily('results (sport80)', { hourUTC: 6, minuteUTC: 5 }, internal.scrapers.sport80.run, {});

// VPS: `40 2 * * *` EDT.
crons.daily('wso records', { hourUTC: 6, minuteUTC: 40 }, internal.scrapers.wsoRecords.run, {});

// VPS: `25 3 * * *` EDT (the entries job; Sport80's JSON endpoint instead of a headless browser).
crons.daily('entries', { hourUTC: 7, minuteUTC: 25 }, internal.scrapers.entries.run, {});

export default crons;
