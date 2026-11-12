import { v } from 'convex/values';
import { internalMutation, mutation, query, type QueryCtx } from './_generated/server';
import { MEET_ROSTER_MAX, readAll } from './lib/boundedRead';
import { requireUserId } from './lib/access';
import { meetByName } from './lib/meetData';
import { apiError, requireNonEmpty } from './lib/validation';
import { buildSchedule, type BuilderEntrant } from './lib/scheduleBuilder';
import {
  builderEditValidator,
  builderOptionsValidator,
  checkBuilderEdits,
  checkBuilderOptions,
  defaultBuilderOptions,
  type BuilderEdit,
  type BuilderOptions,
} from './lib/scheduleBuilderOptions';

export const MAX_DRAFTS_PER_USER = 50;
export const LOAD_COOLDOWN_MS = 10 * 60 * 1000;
export const MAX_LOADS_PER_HOUR = 60;
export const LOAD_LOG_RETENTION_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const LOAD_LOG_PRUNE_BATCH = 20;

async function requireMeet(ctx: QueryCtx, meet: string) {
  requireNonEmpty('meet', meet);
  const row = await meetByName(ctx, meet);
  if (!row) throw apiError(404, 'meet not found');
  return row;
}

async function entrantsOf(ctx: QueryCtx, meet: string): Promise<BuilderEntrant[]> {
  const rows = await readAll(
    ctx.db.query('athletes').withIndex('by_meet', (q) => q.eq('meet', meet)),
    MEET_ROSTER_MAX,
    'athletes of one meet',
  );
  return rows.map(({ memberId, name, age, club, gender, weightClass, entryTotal }) => ({ memberId, name, age, club, gender, weightClass, entryTotal }));
}

function checked(options: BuilderOptions, edits: readonly BuilderEdit[]): void {
  checkBuilderOptions(options);
  checkBuilderEdits(edits);
}

export const defaults = query({
  args: { meet: v.string() },
  handler: async (ctx, { meet }) => {
    const row = await requireMeet(ctx, meet);
    return {
      meet: row.name,
      startDate: row.startDate,
      endDate: row.endDate,
      timeZone: row.timeZone,
      status: row.status,
      options: defaultBuilderOptions(row),
    };
  },
});

export const preview = query({
  args: { meet: v.string(), options: builderOptionsValidator, edits: v.array(builderEditValidator) },
  handler: async (ctx, { meet, options, edits }) => {
    checked(options, edits);
    const row = await requireMeet(ctx, meet);
    return buildSchedule(await entrantsOf(ctx, row.name), options, edits);
  },
});

async function draftOf(ctx: QueryCtx, userId: string, meet: string) {
  return ctx.db
    .query('schedule_drafts')
    .withIndex('by_userId_and_meet', (q) => q.eq('userId', userId).eq('meet', meet))
    .first();
}

export const drafts = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .query('schedule_drafts')
      .withIndex('by_userId_and_updatedAt', (q) => q.eq('userId', userId))
      .order('desc')
      .take(MAX_DRAFTS_PER_USER);
    return rows.map(({ meet, updatedAt }) => ({ meet, updatedAt }));
  },
});

export const draft = query({
  args: { meet: v.string() },
  handler: async (ctx, { meet }) => {
    const userId = await requireUserId(ctx);
    requireNonEmpty('meet', meet);
    const row = await draftOf(ctx, userId, meet);
    return row ? { meet: row.meet, options: row.options, edits: row.edits, updatedAt: row.updatedAt } : null;
  },
});

export const saveDraft = mutation({
  args: { meet: v.string(), options: builderOptionsValidator, edits: v.array(builderEditValidator) },
  handler: async (ctx, { meet, options, edits }) => {
    const userId = await requireUserId(ctx);
    checked(options, edits);
    const row = await requireMeet(ctx, meet);
    const now = Date.now();
    const existing = await draftOf(ctx, userId, row.name);
    if (existing) {
      await ctx.db.patch(existing._id, { options, edits, updatedAt: now });
      return { meet: row.name, updatedAt: now };
    }
    const held = await ctx.db
      .query('schedule_drafts')
      .withIndex('by_userId_and_updatedAt', (q) => q.eq('userId', userId))
      .take(MAX_DRAFTS_PER_USER);
    if (held.length >= MAX_DRAFTS_PER_USER) {
      throw apiError(429, `at most ${MAX_DRAFTS_PER_USER} saved schedules; delete one first`, { max: MAX_DRAFTS_PER_USER });
    }
    await ctx.db.insert('schedule_drafts', { userId, meet: row.name, options, edits, updatedAt: now });
    return { meet: row.name, updatedAt: now };
  },
});

export const deleteDraft = mutation({
  args: { meet: v.string() },
  handler: async (ctx, { meet }) => {
    const userId = await requireUserId(ctx);
    requireNonEmpty('meet', meet);
    const existing = await draftOf(ctx, userId, meet);
    if (existing) await ctx.db.delete(existing._id);
    return { deleted: existing !== null };
  },
});

export const claimLoad = internalMutation({
  args: { eventId: v.string() },
  handler: async (ctx, { eventId }): Promise<{ recentMeet: string | null }> => {
    const now = Date.now();
    const stale = await ctx.db
      .query('schedule_builder_loads')
      .withIndex('by_loadedAt', (q) => q.lt('loadedAt', now - LOAD_LOG_RETENTION_MS))
      .take(LOAD_LOG_PRUNE_BATCH);
    for (const row of stale) await ctx.db.delete(row._id);
    const recent = await ctx.db
      .query('schedule_builder_loads')
      .withIndex('by_eventId_and_loadedAt', (q) => q.eq('eventId', eventId).gt('loadedAt', now - LOAD_COOLDOWN_MS))
      .order('desc')
      .take(MAX_LOADS_PER_HOUR);
    const finished = recent.find((row) => row.meet !== '');
    if (finished) return { recentMeet: finished.meet };
    const lastHour = await ctx.db
      .query('schedule_builder_loads')
      .withIndex('by_loadedAt', (q) => q.gt('loadedAt', now - HOUR_MS))
      .take(MAX_LOADS_PER_HOUR);
    if (lastHour.length >= MAX_LOADS_PER_HOUR) {
      throw apiError(429, 'MeetCal is loading many meets right now; try again in a few minutes', { max: MAX_LOADS_PER_HOUR });
    }
    await ctx.db.insert('schedule_builder_loads', { eventId, meet: '', loadedAt: now });
    return { recentMeet: null };
  },
});

export const finishLoad = internalMutation({
  args: { eventId: v.string(), meet: v.string() },
  handler: async (ctx, { eventId, meet }) => {
    await ctx.db.insert('schedule_builder_loads', { eventId, meet, loadedAt: Date.now() });
  },
});
