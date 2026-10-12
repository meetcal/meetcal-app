import { ConvexError } from 'convex/values';
import { JOBS, run, watchdog, WATCHDOG_JOB, WATCHDOG_SCHEDULE } from '../convex/cronJobs';
import { afterRun, describeFailure, sourcesFailed, START_MARGIN_MS, STUCK_AFTER_MS, watch } from '../convex/lib/cronAlerts';
import { lastScheduled, parseSchedule } from '../convex/lib/cronSchedule';
import { HEARTBEAT_TIMEOUT_MS, pingHeartbeat } from '../convex/lib/heartbeat';
import { handlerOf } from './fakeDb';

const at = (iso: string) => Date.parse(iso);

describe('alerts for a job that reads many sources (#92)', () => {
  const failing = (...sources: string[]) => ({ ok: false as const, error: `failed: ${sources.join(', ')}`, failedSources: sources });

  it('emails a source that starts failing while the job already is, and stays quiet for the same set', () => {
    const first = afterRun('wso-records', undefined, failing('Missouri Valley'));
    expect(first).toMatchObject({ alerting: 'failed', failedSources: ['Missouri Valley'], notice: { kind: 'failed' } });
    expect(afterRun('wso-records', 'failed', failing('Missouri Valley'), ['Missouri Valley'])).toEqual({ alerting: 'failed', failedSources: ['Missouri Valley'] });
    const second = afterRun('wso-records', 'failed', failing('Florida', 'Missouri Valley'), ['Missouri Valley']);
    expect(second.notice).toEqual({ kind: 'failed', job: 'wso-records', detail: 'now also failing: Florida\n\nfailed: Florida, Missouri Valley' });
    expect(second.failedSources).toEqual(['Florida', 'Missouri Valley']);
  });

  it('stays quiet when sources recover, and emails one that fails again after recovering', () => {
    expect(afterRun('wso-records', 'failed', failing('Florida'), ['Florida', 'Missouri Valley']).notice).toBeUndefined();
    expect(afterRun('wso-records', 'failed', failing('Florida', 'Missouri Valley'), ['Florida'])).toMatchObject({ notice: { detail: expect.stringContaining('now also failing: Missouri Valley') } });
  });

  it('keeps the known failing sources through a failure that names none', () => {
    const whole = afterRun('wso-records', 'failed', { ok: false, error: 'timed out' }, ['Florida']);
    expect(whole).toEqual({ alerting: 'failed', failedSources: ['Florida'] });
    expect(afterRun('wso-records', 'failed', failing('Florida'), undefined).notice).toBeUndefined();
    expect(afterRun('wso-records', 'failed', { ok: true }, ['Florida'])).toMatchObject({ alerting: undefined, notice: { kind: 'recovered' } });
    expect(afterRun('wso-records', 'failed', { ok: true }, ['Florida']).failedSources).toBeUndefined();
  });

  it('emails a named source failing after a failure of the whole job', () => {
    const whole = afterRun('wso-records', undefined, { ok: false, error: 'timed out' });
    expect(whole).toMatchObject({ alerting: 'failed', failedSources: [], notice: { kind: 'failed' } });
    expect(afterRun('wso-records', 'failed', failing('Florida'), whole.failedSources).notice?.detail).toContain('now also failing: Florida');
  });

  it('carries the failed sources on the thrown error, also as Convex rethrows it from runAction', () => {
    const error = sourcesFailed('wso records', [
      { source: 'Ohio', error: 'boom' },
      { source: 'Florida', error: 'parsed 0 records' },
    ]);
    expect(error.message).toBe('wso records: Ohio: boom; Florida: parsed 0 records');
    expect(describeFailure(error)).toEqual({ error: 'wso records: Ohio: boom; Florida: parsed 0 records', failedSources: ['Florida', 'Ohio'] });
    // runAction rethrows a ConvexError with the message it was given and the data.
    const rethrown = new ConvexError('Uncaught ConvexError: wso records: …');
    rethrown.data = JSON.parse(JSON.stringify(error.data)) as never;
    expect(describeFailure(rethrown).failedSources).toEqual(['Florida', 'Ohio']);
    expect(describeFailure(new Error('plain'))).toEqual({ error: 'plain' });
    expect(describeFailure('text')).toEqual({ error: 'text' });
  });
});

describe('watching the watchdog (#168)', () => {
  const okFetch = () => jest.fn(async () => new Response('OK', { status: 200 }));

  afterEach(() => {
    delete process.env.HEARTBEAT_URL;
    jest.restoreAllMocks();
  });

  it('pings the heartbeat only when a URL is set, and never throws', async () => {
    const fetchImpl = okFetch();
    expect(await pingHeartbeat(undefined, fetchImpl)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await pingHeartbeat('https://hc-ping.com/abc', fetchImpl)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith('https://hc-ping.com/abc', expect.objectContaining({ signal: expect.anything() }));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(await pingHeartbeat('https://hc-ping.com/abc', jest.fn(async () => new Response('', { status: 500 })))).toBe(false);
    expect(await pingHeartbeat('https://hc-ping.com/abc', jest.fn(async () => Promise.reject(new Error('offline'))))).toBe(false);
    expect(HEARTBEAT_TIMEOUT_MS).toBeGreaterThan(0);
  });

  const watchdogCtx = (all: () => Promise<unknown[]>) => {
    const runMutation = jest.fn(async (_fn: unknown, args: Record<string, unknown>) => ('due' in args ? null : 'error' in args || 'failedSources' in args ? [] : undefined));
    return { runMutation, runQuery: jest.fn(all) };
  };

  it('records its run under its own job and pings the heartbeat after a clean sweep', async () => {
    process.env.HEARTBEAT_URL = 'https://hc-ping.com/abc';
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('OK', { status: 200 }));
    const ctx = watchdogCtx(async () => []);
    await handlerOf<Record<string, never>, unknown>(watchdog)(ctx, {});
    const jobs = ctx.runMutation.mock.calls.map(([, args]) => args.job);
    expect(jobs[0]).toBe(WATCHDOG_JOB);
    expect(jobs.at(-1)).toBe(WATCHDOG_JOB);
    expect(ctx.runMutation.mock.calls.at(-1)?.[1]).toEqual({ job: WATCHDOG_JOB, error: undefined, failedSources: undefined });
    expect(fetchSpy).toHaveBeenCalledWith('https://hc-ping.com/abc', expect.anything());
  });

  it('records a failed sweep, does not ping, and rethrows', async () => {
    process.env.HEARTBEAT_URL = 'https://hc-ping.com/abc';
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('OK', { status: 200 }));
    const ctx = watchdogCtx(async () => Promise.reject(new Error('query failed')));
    await expect(handlerOf<Record<string, never>, unknown>(watchdog)(ctx, {})).rejects.toThrow('query failed');
    expect(ctx.runMutation.mock.calls.at(-1)?.[1]).toEqual({ job: WATCHDOG_JOB, error: 'query failed', failedSources: undefined });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not ping the heartbeat when its own queued alert cannot be sent', async () => {
    process.env.HEARTBEAT_URL = 'https://hc-ping.com/abc';
    const saved = { ...process.env };
    Object.assign(process.env, { ALERT_EMAIL: 'ops@example.com', ONESIGNAL_APP_ID: 'app', ONESIGNAL_REST_API_KEY: 'os_key' });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    // The email provider rejects the send; the heartbeat would answer OK.
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => new Response('', { status: String(input).includes('hc-ping') ? 200 : 500 }));
    const ctx = watchdogCtx(async () => []);
    const fallback = ctx.runMutation.getMockImplementation()!;
    // Its clean sweep finishes with a queued "is running again" of its own.
    ctx.runMutation.mockImplementation(async (fn, args) =>
      // The fake's results are typed as its defaults; this queued notice is what `finish` returns.
      'error' in args ? ([{ job: WATCHDOG_JOB, kind: 'recovered', detail: 'ran at …' }] as never[]) : fallback(fn, args),
    );
    try {
      await handlerOf<Record<string, never>, unknown>(watchdog)(ctx, {});
    } finally {
      for (const name of ['ALERT_EMAIL', 'ONESIGNAL_APP_ID', 'ONESIGNAL_REST_API_KEY'] as const) {
        if (saved[name] === undefined) delete process.env[name];
        else process.env[name] = saved[name];
      }
    }
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('onesignal'), expect.anything());
    expect(fetchSpy).not.toHaveBeenCalledWith('https://hc-ping.com/abc', expect.anything());
    expect(ctx.runMutation.mock.calls.map(([, args]) => args)).not.toContainEqual(expect.objectContaining({ sent: expect.anything() }));
  });

  it("checks the watchdog from every job's run", async () => {
    const ctx = watchdogCtx(async () => []);
    await handlerOf<{ job: string }, unknown>(run)(ctx, { job: 'complete-ended-meets' });
    const check = ctx.runMutation.mock.calls.find(([, args]) => 'due' in args)?.[1];
    expect(check).toMatchObject({ job: WATCHDOG_JOB });
    // Judged against the watchdog's own schedule (":45 every hour").
    expect(new Date(check?.due as number).getUTCMinutes()).toBe(45);
  });

  it("sends the watchdog's queued alerts from a job's run while the watchdog is in trouble", async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const queued = [{ job: WATCHDOG_JOB, kind: 'missed', detail: 'was due at …' }];
    const ctx = watchdogCtx(async () => queued);
    await handlerOf<{ job: string }, unknown>(run)(ctx, { job: 'complete-ended-meets' });
    expect(ctx.runMutation.mock.calls.map(([, args]) => args)).toContainEqual({ job: WATCHDOG_JOB, sent: [{ kind: 'missed', detail: 'was due at …' }] });
  });

  it("still records a job's run when its check of the watchdog fails", async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = watchdogCtx(async () => []);
    const fallback = ctx.runMutation.getMockImplementation()!;
    ctx.runMutation.mockImplementation(async (fn, args) => ('due' in args ? Promise.reject(new Error('busy')) : fallback(fn, args)));
    await handlerOf<{ job: string }, unknown>(run)(ctx, { job: 'complete-ended-meets' });
    expect(ctx.runMutation.mock.calls.at(-1)?.[1]).toEqual({ job: 'complete-ended-meets', error: undefined, failedSources: undefined });
  });
});

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
    expect(first).toEqual({ alerting: 'failed', failedSources: [], notice: { kind: 'failed', job: 'wso-records', detail: 'boom' } });
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
