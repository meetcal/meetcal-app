import { v } from 'convex/values';
import { internalMutation, mutation, query, type QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { MEET_ROSTER_MAX, MEET_SESSIONS_MAX, readAll } from './lib/boundedRead';
import { requireUserId } from './lib/access';
import { meetByName } from './lib/meetData';
import { hasSession } from './lib/roster';
import { apiError, requireNonEmpty } from './lib/validation';
import { buildFromPublished, buildSchedule, publishedOptions, type BuilderEntrant, type BuiltSchedule, type PublishedBase, type PublishedBuild } from './lib/scheduleBuilder';
import { sport80Changes } from './lib/scheduleChanges';
import { platformLabel } from './lib/schedulePublishing';
import { meetPageUrl } from './scrapers/parse/entries';
import { bytesToBase64 } from './lib/base64';
import { EXPORT_CONTENT_TYPES, exportFileName, scheduleCsv, scheduleWorkbook } from './lib/scheduleExport';
import {
  baseVersionValidator,
  builderEditValidator,
  builderOptionsValidator,
  checkBuilderEdits,
  checkBuilderOptions,
  defaultBuilderOptions,
  scheduleBaseValidator,
  type BuilderEdit,
  type BuilderOptions,
  type ScheduleBase,
} from './lib/scheduleBuilderOptions';

export const MAX_DRAFTS_PER_USER = 50;
export const LOAD_COOLDOWN_MS = 10 * 60 * 1000;
export const MAX_LOADS_PER_HOUR = 60;
export const LOAD_LOG_RETENTION_MS = 24 * 60 * 60 * 1000;
export const MAX_SEARCHES_PER_HOUR = 120;
const HOUR_MS = 60 * 60 * 1000;
const LOAD_LOG_PRUNE_BATCH = 20;
const MEET_PUBLICATIONS_READ = 50;

export const NOT_PUBLISHED = "This meet's schedule is no longer published. Open it again to start from what's on MeetCal now.";

export async function requireMeet(ctx: QueryCtx, meet: string) {
  requireNonEmpty('meet', meet);
  const row = await meetByName(ctx, meet);
  if (!row) throw apiError(404, 'meet not found');
  return row;
}

export async function entrantsOf(ctx: QueryCtx, meet: string): Promise<BuilderEntrant[]> {
  const rows = await readAll(
    ctx.db.query('athletes').withIndex('by_meet', (q) => q.eq('meet', meet)),
    MEET_ROSTER_MAX,
    'athletes of one meet',
  );
  return rows.map(({ memberId, name, age, club, gender, weightClass, entryTotal }) => ({ memberId, name, age, club, gender, weightClass, entryTotal }));
}

export function checked(options: BuilderOptions, edits: readonly BuilderEdit[]): void {
  checkBuilderOptions(options);
  checkBuilderEdits(edits);
}

export async function latestLivePublication(ctx: QueryCtx, meet: string): Promise<Doc<'schedule_publications'> | null> {
  const recent = await ctx.db
    .query('schedule_publications')
    .withIndex('by_meet_and_createdAt', (q) => q.eq('meet', meet))
    .order('desc')
    .take(MEET_PUBLICATIONS_READ);
  const wentLiveAt = (p: Doc<'schedule_publications'>) => p.decidedAt ?? p.createdAt;
  return recent.filter((p) => p.status === 'live' || p.status === 'approved').reduce<Doc<'schedule_publications'> | null>((latest, p) => (latest === null || wentLiveAt(p) > wentLiveAt(latest) ? p : latest), null);
}

export type PublishedMeet = { version: string | null; options: BuilderOptions; base: PublishedBase; checkedAt: number | null };

export async function publishedMeetOf(ctx: QueryCtx, meet: Pick<Doc<'meets'>, 'name' | 'startDate' | 'endDate'>): Promise<PublishedMeet | null> {
  const roster = await readAll(
    ctx.db.query('athletes').withIndex('by_meet', (q) => q.eq('meet', meet.name)),
    MEET_ROSTER_MAX,
    'athletes of one meet',
  );
  if (!roster.some(hasSession)) return null;
  const rows = await readAll(
    ctx.db.query('session_schedule').withIndex('by_meet', (q) => q.eq('meet', meet.name)),
    MEET_SESSIONS_MAX,
    'sessions of one meet',
  );
  const check = await ctx.db
    .query('sport80_entrant_checks')
    .withIndex('by_meet', (q) => q.eq('meet', meet.name))
    .first();
  const sport80 = check
    ? await readAll(
        ctx.db.query('sport80_entrants').withIndex('by_meet', (q) => q.eq('meet', meet.name)),
        MEET_ROSTER_MAX,
        'Sport80 entrants of one meet',
      )
    : null;
  const live = await latestLivePublication(ctx, meet.name);
  return {
    version: live?._id ?? null,
    options: live?.options ?? publishedOptions(rows, meet),
    base: { rows, roster, sport80 },
    checkedAt: check?.checkedAt ?? null,
  };
}

export async function requirePublishedMeet(ctx: QueryCtx, meet: Pick<Doc<'meets'>, 'name' | 'startDate' | 'endDate'>): Promise<PublishedMeet> {
  const published = await publishedMeetOf(ctx, meet);
  if (!published) throw apiError(409, NOT_PUBLISHED);
  return published;
}

export type BaseBuild = { base: 'entries'; schedule: BuiltSchedule } | { base: 'published'; schedule: PublishedBuild; published: PublishedMeet };

export async function buildOn(ctx: QueryCtx, meet: Pick<Doc<'meets'>, 'name' | 'startDate' | 'endDate'>, base: ScheduleBase, options: BuilderOptions, edits: readonly BuilderEdit[]): Promise<BaseBuild> {
  if (base === 'entries') return { base, schedule: buildSchedule(await entrantsOf(ctx, meet.name), options, edits) };
  const published = await requirePublishedMeet(ctx, meet);
  return { base, schedule: buildFromPublished(published.base, options, edits), published };
}

export const defaults = query({
  args: { meet: v.string() },
  handler: async (ctx, { meet }) => {
    const row = await requireMeet(ctx, meet);
    const published = await publishedMeetOf(ctx, row);
    return {
      meet: row.name,
      startDate: row.startDate,
      endDate: row.endDate,
      timeZone: row.timeZone,
      status: row.status,
      options: defaultBuilderOptions(row),
      sport80Link: row.sourceId === undefined ? null : meetPageUrl(row.sourceId),
      published: published ? { version: published.version, options: published.options } : null,
    };
  },
});

export function withGroupLabels({ athletes, sessions, warnings }: BuiltSchedule) {
  return {
    athletes,
    warnings,
    sessions: sessions.map((session) => ({ ...session, groups: session.groups.map((group) => ({ ...group, label: platformLabel(group) })) })),
  };
}

export const preview = query({
  args: { meet: v.string(), options: builderOptionsValidator, edits: v.array(builderEditValidator), base: v.optional(scheduleBaseValidator) },
  handler: async (ctx, { meet, options, edits, base }) => {
    checked(options, edits);
    const row = await requireMeet(ctx, meet);
    const built = await buildOn(ctx, row, base ?? 'entries', options, edits);
    if (built.base === 'entries') return withGroupLabels(built.schedule);
    return { ...withGroupLabels(built.schedule), changes: sport80Changes(built.schedule, built.published.checkedAt, options.separateAgeGroups) };
  },
});

export const changes = query({
  args: { meet: v.string() },
  handler: async (ctx, { meet }) => {
    const row = await requireMeet(ctx, meet);
    const published = await publishedMeetOf(ctx, row);
    if (!published) return { checkedAt: null, added: [], withdrawn: [] };
    return sport80Changes(buildFromPublished(published.base, published.options), published.checkedAt, published.options.separateAgeGroups);
  },
});

export const exportFile = query({
  args: {
    meet: v.string(),
    options: builderOptionsValidator,
    edits: v.array(builderEditValidator),
    base: v.optional(scheduleBaseValidator),
    format: v.union(v.literal('csv'), v.literal('xlsx')),
  },
  handler: async (ctx, { meet, options, edits, base, format }) => {
    checked(options, edits);
    const row = await requireMeet(ctx, meet);
    const { schedule } = await buildOn(ctx, row, base ?? 'entries', options, edits);
    const fileName = exportFileName(row.name, format);
    if (format === 'csv') return { fileName, contentType: EXPORT_CONTENT_TYPES.csv, encoding: 'utf8' as const, content: scheduleCsv(schedule) };
    return { fileName, contentType: EXPORT_CONTENT_TYPES.xlsx, encoding: 'base64' as const, content: bytesToBase64(scheduleWorkbook(schedule)) };
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
    return row ? { meet: row.meet, options: row.options, edits: row.edits, basis: { base: row.base ?? 'entries', baseVersion: row.baseVersion ?? null }, updatedAt: row.updatedAt } : null;
  },
});

export const saveDraft = mutation({
  args: {
    meet: v.string(),
    options: builderOptionsValidator,
    edits: v.array(builderEditValidator),
    base: v.optional(scheduleBaseValidator),
    baseVersion: v.optional(baseVersionValidator),
  },
  handler: async (ctx, { meet, options, edits, base, baseVersion }) => {
    const userId = await requireUserId(ctx);
    checked(options, edits);
    const row = await requireMeet(ctx, meet);
    const now = Date.now();
    const existing = await draftOf(ctx, userId, row.name);
    if (existing) {
      await ctx.db.patch(existing._id, { options, edits, base: base ?? 'entries', baseVersion: baseVersion ?? null, updatedAt: now });
      return { meet: row.name, updatedAt: now };
    }
    const held = await ctx.db
      .query('schedule_drafts')
      .withIndex('by_userId_and_updatedAt', (q) => q.eq('userId', userId))
      .take(MAX_DRAFTS_PER_USER);
    if (held.length >= MAX_DRAFTS_PER_USER) {
      throw apiError(429, `at most ${MAX_DRAFTS_PER_USER} saved schedules; delete one first`, { max: MAX_DRAFTS_PER_USER });
    }
    await ctx.db.insert('schedule_drafts', { userId, meet: row.name, options, edits, base: base ?? 'entries', baseVersion: baseVersion ?? null, updatedAt: now });
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
  handler: async (ctx, { eventId }): Promise<{ recentMeet: string } | { claim: Id<'schedule_builder_loads'> }> => {
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
    return { claim: await ctx.db.insert('schedule_builder_loads', { eventId, meet: '', loadedAt: now }) };
  },
});

export const finishLoad = internalMutation({
  args: { claim: v.id('schedule_builder_loads'), meet: v.string() },
  handler: async (ctx, { claim, meet }) => {
    await ctx.db.patch(claim, { meet, loadedAt: Date.now() });
  },
});

export const claimSearch = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const stale = await ctx.db
      .query('schedule_builder_searches')
      .withIndex('by_searchedAt', (q) => q.lt('searchedAt', now - LOAD_LOG_RETENTION_MS))
      .take(LOAD_LOG_PRUNE_BATCH);
    for (const row of stale) await ctx.db.delete(row._id);
    const lastHour = await ctx.db
      .query('schedule_builder_searches')
      .withIndex('by_searchedAt', (q) => q.gt('searchedAt', now - HOUR_MS))
      .take(MAX_SEARCHES_PER_HOUR);
    if (lastHour.length >= MAX_SEARCHES_PER_HOUR) {
      throw apiError(429, 'MeetCal is searching Sport80 a lot right now; try again in a few minutes', { max: MAX_SEARCHES_PER_HOUR });
    }
    await ctx.db.insert('schedule_builder_searches', { searchedAt: now });
  },
});
