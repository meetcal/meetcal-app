import { v } from 'convex/values';
import { internalMutation, internalQuery, type QueryCtx } from './_generated/server';
import { afterRun, type Alerting, type Notice } from './lib/cronAlerts';

const alertingValue = v.optional(v.union(v.literal('failed'), v.literal('missed'), v.literal('stuck')));

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

/** A run ends: records the outcome and returns the email to send, if any. */
export const finish = internalMutation({
  args: { job: v.string(), error: v.optional(v.string()) },
  handler: async (ctx, { job, error }): Promise<Notice | null> => {
    const existing = await statusOf(ctx, job);
    const { alerting, notice } = afterRun(job, existing?.alerting as Alerting | undefined, error === undefined ? { ok: true } : { ok: false, error });
    const fields = { finishedAt: Date.now(), status: error === undefined ? ('ok' as const) : ('error' as const), error, alerting };
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert('cron_status', { job, startedAt: Date.now(), ...fields });
    return notice ?? null;
  },
});

export const all = internalQuery({
  args: {},
  handler: async (ctx) => await ctx.db.query('cron_status').collect(),
});

/** The watchdog marks the alert it sent so it is not sent again. */
export const markAlerting = internalMutation({
  args: { job: v.string(), alerting: alertingValue },
  handler: async (ctx, { job, alerting }) => {
    const existing = await statusOf(ctx, job);
    if (existing) await ctx.db.patch(existing._id, { alerting });
  },
});
