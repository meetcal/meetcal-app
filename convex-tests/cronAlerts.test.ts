import { JOBS, WATCHDOG_SCHEDULE } from '../convex/cronJobs';
import { afterRun, START_MARGIN_MS, STUCK_AFTER_MS, watch } from '../convex/lib/cronAlerts';
import { lastScheduled, parseSchedule } from '../convex/lib/cronSchedule';

const at = (iso: string) => Date.parse(iso);

describe('cron schedules', () => {
  it('finds the latest run at or before a time', () => {
    expect(new Date(lastScheduled('40 6 * * *', at('2026-09-27T06:39:00Z'))).toISOString()).toBe('2026-09-26T06:40:00.000Z');
    expect(new Date(lastScheduled('40 6 * * *', at('2026-09-27T06:40:00Z'))).toISOString()).toBe('2026-09-27T06:40:00.000Z');
    expect(new Date(lastScheduled('15 * * * *', at('2026-09-27T00:10:00Z'))).toISOString()).toBe('2026-09-26T23:15:00.000Z');
    expect(new Date(lastScheduled('0 * * * *', at('2026-09-27T12:00:30Z'))).toISOString()).toBe('2026-09-27T12:00:00.000Z');
  });

  it('accepts only the daily and hourly forms, and every job uses one', () => {
    expect(() => parseSchedule('*/5 * * * *')).toThrow('unsupported schedule');
    expect(() => parseSchedule('0 12 * * 1')).toThrow('unsupported schedule');
    for (const { schedule } of Object.values(JOBS)) expect(() => parseSchedule(schedule)).not.toThrow();
    expect(() => parseSchedule(WATCHDOG_SCHEDULE)).not.toThrow();
  });
});

describe('cron alerts', () => {
  it('emails the first failure, stays quiet while it keeps failing, and emails the recovery', () => {
    const first = afterRun('wso-records', undefined, { ok: false, error: 'boom' });
    expect(first).toEqual({ alerting: 'failed', notice: { kind: 'failed', job: 'wso-records', detail: 'boom' } });
    expect(afterRun('wso-records', 'failed', { ok: false, error: 'boom again' })).toEqual({ alerting: 'failed' });
    expect(afterRun('wso-records', 'failed', { ok: true })).toMatchObject({ alerting: undefined, notice: { kind: 'recovered' } });
    expect(afterRun('wso-records', undefined, { ok: true })).toEqual({ alerting: undefined });
    expect(afterRun('wso-records', 'missed', { ok: true }).notice?.kind).toBe('recovered');
  });

  it('flags a missed run once, a stuck run once, and never judges a job that has not run yet', () => {
    const now = at('2026-09-27T08:00:00Z');
    const due = lastScheduled('40 6 * * *', now - START_MARGIN_MS);
    expect(watch('wso-records', null, due, now)).toBeUndefined();
    const yesterday = { startedAt: at('2026-09-26T06:40:02Z'), status: 'ok' as const };
    expect(watch('wso-records', yesterday, due, now)?.kind).toBe('missed');
    expect(watch('wso-records', { ...yesterday, alerting: 'missed' as const }, due, now)).toBeUndefined();
    expect(watch('wso-records', { startedAt: at('2026-09-27T06:40:01Z'), status: 'ok' }, due, now)).toBeUndefined();
    const running = { startedAt: now - STUCK_AFTER_MS - 1, status: 'running' as const };
    expect(watch('wso-records', running, due, now)?.kind).toBe('stuck');
    expect(watch('wso-records', { ...running, alerting: 'stuck' as const }, due, now)).toBeUndefined();
  });

  it('does not call a run missed before its margin has passed', () => {
    // 06:50: the 06:40 run is inside its 30 minute margin, so yesterday's is the one due.
    const now = at('2026-09-27T06:50:00Z');
    const due = lastScheduled('40 6 * * *', now - START_MARGIN_MS);
    expect(watch('wso-records', { startedAt: at('2026-09-26T06:40:00Z'), status: 'ok' }, due, now)).toBeUndefined();
  });
});
