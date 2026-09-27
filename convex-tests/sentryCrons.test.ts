import { JOBS } from '../convex/cronJobs';
import { monitorConfig, parseDsn } from '../convex/lib/sentryCrons';

describe('Sentry Crons check-ins', () => {
  it('builds the check-in URL from a DSN', () => {
    expect(parseDsn('https://abc123@o456.ingest.us.sentry.io/789').checkInUrl('wso-records')).toBe('https://o456.ingest.us.sentry.io/api/789/cron/wso-records/abc123/');
    expect(() => parseDsn('https://o456.ingest.us.sentry.io/789')).toThrow('not a valid DSN');
  });

  it('describes each monitor from its UTC schedule', () => {
    expect(monitorConfig('40 6 * * *')).toEqual({
      schedule: { type: 'crontab', value: '40 6 * * *' },
      timezone: 'UTC',
      checkin_margin: 5,
      max_runtime: 15,
      failure_issue_threshold: 1,
      recovery_threshold: 1,
    });
  });

  it('keeps the backend job names as monitor slugs, each with a valid schedule', () => {
    expect(Object.keys(JOBS).sort()).toEqual(
      ['complete-ended-meets', 'entries', 'intl-rankings', 'iwf-world-records', 'meet-sync', 'records', 'results-sport80', 'standards', 'umwf-records', 'urlwatch', 'usamw-events', 'usamw-national-records', 'wso-records'].sort(),
    );
    for (const [slug, job] of Object.entries(JOBS)) {
      expect(slug).toMatch(/^[a-z0-9_-]{1,50}$/);
      expect(job.schedule.split(' ')).toHaveLength(5);
    }
  });
});
