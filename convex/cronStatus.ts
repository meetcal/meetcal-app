import { v } from 'convex/values';
import { internalMutation, internalQuery, type QueryCtx } from './_generated/server';
import { afterRun, watch, type Alerting, type Notice } from './lib/cronAlerts';

async function statusOf(ctx: Pick<QueryCtx, 'db'>, job: string) {
  return await ctx.db
    .query('cron_status')
    .withIndex('by_job', (q) => q.eq('job', job))
    .first();
}

/** A run starts: recorded as running, keeping any outstanding alert. */
export const start = internalMutation({
  args: { job: v.string() },
  handler: async (ctx, { job }) => {
    const existing = await statusOf(ctx, job);
    const run = { job, startedAt: Date.now(), status: 'running' as const, finishedAt: undefined, error: undefined };
    if (existing) await ctx.db.patch(existing._id, run);
    else await ctx.db.insert('cron_status', run);
  },
});

/**
 * A run ends: records the outcome, queues its alert (if it earns one) with
 * any still unsent, and returns them all to send.
 */
/**
 * Stored error text is cut to this: a scraper's joined failures can run long,
 * and the row (with its queued alerts) must stay far below a document's 1 MiB.
 */
const MAX_ERROR_CHARS = 4000;

export const finish = internalMutation({
  args: { job: v.string(), error: v.optional(v.string()) },
  handler: async (ctx, { job, error: fullError }): Promise<Notice[]> => {
    const error = fullError === undefined || fullError.length <= MAX_ERROR_CHARS ? fullError : `${fullError.slice(0, MAX_ERROR_CHARS)}… (truncated)`;
    const existing = await statusOf(ctx, job);
    const { alerting, notice } = afterRun(job, existing?.alerting as Alerting | undefined, error === undefined ? { ok: true } : { ok: false, error });
    const unsent = [...(existing?.unsent ?? []), ...(notice ? [{ kind: notice.kind, detail: notice.detail }] : [])];
    const fields = { finishedAt: Date.now(), status: error === undefined ? ('ok' as const) : ('error' as const), error, alerting, unsent };
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert('cron_status', { job, startedAt: Date.now(), ...fields });
    return unsent.map((u) => ({ job, kind: u.kind as Notice['kind'], detail: u.detail }));
  },
});

/**
 * The watchdog's check of one job whose latest run was due at `due`: judged
 * (`watch`) against the row as it is now, not an earlier read, so a run that
 * started or finished meanwhile raises nothing. An incident (missed or stuck)
 * is marked and its notice queued in one write, so it is never recorded
 * without the email that reports it. Returns the notice raised, if any.
 */
export const raiseAlert = internalMutation({
  args: { job: v.string(), due: v.number() },
  handler: async (ctx, { job, due }): Promise<Notice | null> => {
    const existing = await statusOf(ctx, job);
    const notice = watch(job, existing ?? null, due, Date.now());
    if (!existing || !notice) return null;
    await ctx.db.patch(existing._id, {
      alerting: notice.kind as 'missed' | 'stuck',
      unsent: [...(existing.unsent ?? []), { kind: notice.kind, detail: notice.detail }],
    });
    return notice;
  },
});

/** Drops alerts that were emailed (matched by kind and detail; alerts queued since stay). */
export const markSent = internalMutation({
  args: { job: v.string(), sent: v.array(v.object({ kind: v.string(), detail: v.string() })) },
  handler: async (ctx, { job, sent }) => {
    const existing = await statusOf(ctx, job);
    if (!existing?.unsent) return;
    const remaining = [...existing.unsent];
    for (const s of sent) {
      const at = remaining.findIndex((u) => u.kind === s.kind && u.detail === s.detail);
      if (at !== -1) remaining.splice(at, 1);
    }
    await ctx.db.patch(existing._id, { unsent: remaining.length ? remaining : undefined });
  },
});

export const all = internalQuery({
  args: {},
  handler: async (ctx) => await ctx.db.query('cron_status').collect(),
});
