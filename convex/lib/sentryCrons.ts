/**
 * Sentry Crons check-ins for the scheduled jobs (the backend's
 * `scrapers/common/sentry_cron.py`, same monitor slugs). A job checks in
 * `in_progress` when it starts, with its schedule, so Sentry creates the
 * monitor and alerts when a run is missed or runs too long, then `ok` or
 * `error` when it ends. The error itself reaches Sentry through Convex's
 * exception reporting (Dashboard → Settings → Integrations → Sentry).
 *
 * With `SENTRY_DSN` unset (the dev deployment) nothing is sent, and a Sentry
 * outage is logged but never fails a job.
 */

// Minutes after the scheduled time before Sentry marks a check-in missed.
const CHECKIN_MARGIN_MINUTES = 5;
// A Convex action stops after 10 minutes, so a run still open at 15 is stuck.
const MAX_RUNTIME_MINUTES = 15;

type Dsn = { checkInUrl: (slug: string) => string };

export function parseDsn(dsn: string): Dsn {
  const url = new URL(dsn);
  const segments = url.pathname.replace(/\/+$/, '').split('/');
  const projectId = segments.pop();
  if (!url.username || !projectId) throw new Error('SENTRY_DSN is not a valid DSN');
  const base = `${url.protocol}//${url.host}${segments.join('/')}/api/${projectId}`;
  return { checkInUrl: (slug) => `${base}/cron/${slug}/${url.username}/` };
}

export function monitorConfig(schedule: string) {
  return {
    schedule: { type: 'crontab', value: schedule },
    timezone: 'UTC',
    checkin_margin: CHECKIN_MARGIN_MINUTES,
    max_runtime: MAX_RUNTIME_MINUTES,
    failure_issue_threshold: 1,
    recovery_threshold: 1,
  };
}

/** Posts one check-in; returns its id, or undefined when Sentry is off or unreachable. */
export async function checkIn(slug: string, body: Record<string, unknown>): Promise<string | undefined> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return undefined;
  try {
    const response = await fetch(parseDsn(dsn).checkInUrl(slug), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, environment: process.env.SENTRY_ENVIRONMENT || 'production' }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.warn(`sentry cron ${slug}: check-in answered ${response.status}`);
      return undefined;
    }
    const json = (await response.json().catch(() => ({}))) as { id?: string };
    return json.id;
  } catch (error) {
    console.warn(`sentry cron ${slug}: ${(error as Error).message}`);
    return undefined;
  }
}
