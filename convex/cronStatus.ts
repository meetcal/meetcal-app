import { v } from 'convex/values';
import { internalMutation, internalQuery, type QueryCtx } from './_generated/server';
import { afterRun, type Alerting, type Notice } from './lib/cronAlerts';

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
export const finish = internalMutation({
  args: { job: v.string(), error: v.optional(v.string()) },
  handler: async (ctx, { job, error }): Promise<Notice[]> => {
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
 * The watchdog raises an incident (missed or stuck): marks the job as alerting
 * and queues the notice in one write, so the incident is never recorded
 * without the email that reports it.
 */
export const raiseAlert = internalMutation({
  args: { job: v.string(), kind: v.union(v.literal('missed'), v.literal('stuck')), detail: v.string() },
  handler: async (ctx, { job, kind, detail }) => {
    const existing = await statusOf(ctx, job);
    if (existing) await ctx.db.patch(existing._id, { alerting: kind, unsent: [...(existing.unsent ?? []), { kind, detail }] });
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
