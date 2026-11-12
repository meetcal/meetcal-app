import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { candidateLifters, rowsOfName } from './lib/lifterCandidates';
import { isSport80Result } from './lib/lifters';
import { normalizeName } from './lib/names';

export const UNLINKED_PAGE_SIZE = 2000;
export const LIFTER_NAMES_PAGE_SIZE = 500;
export const MAX_LIFTER_NAME_LOOKUPS = 100;
export const MAX_QUEUED_RELINKS = 1000;

export type UnlinkedResult = { nameKey: string; age: string | null; date: string; federation: string | null; storedAt: number };
export type LifterName = { nameKey: string; athleteIds: string[]; sport80Results: boolean };

export const unlinkedResultsPage = internalQuery({
  args: { insertedSince: v.number(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { insertedSince, cursor }): Promise<{ rows: UnlinkedResult[]; cursor: string; isDone: boolean }> => {
    const page = await ctx.db
      .query('lifting_results')
      .withIndex('by_creation_time', (q) => q.gte('_creationTime', insertedSince))
      .paginate({ cursor, numItems: UNLINKED_PAGE_SIZE });
    const rows = page.page
      .filter((row) => row.lifterId === undefined)
      .map((row) => ({ nameKey: row.nameKey ?? normalizeName(row.name), age: row.age ?? null, date: row.date, federation: row.federation ?? null, storedAt: row._creationTime }));
    return { rows, cursor: page.continueCursor, isDone: page.isDone };
  },
});

export const lifterNamesPage = internalQuery({
  args: { after: v.string() },
  handler: async (ctx, { after }): Promise<{ names: string[]; done: boolean }> => {
    const entries = await ctx.db
      .query('lifter_names')
      .withIndex('by_nameKey_and_athleteId', (q) => q.gt('nameKey', after))
      .take(LIFTER_NAMES_PAGE_SIZE);
    const names = [...new Set(entries.map((entry) => entry.nameKey))];
    if (entries.length < LIFTER_NAMES_PAGE_SIZE) return { names, done: true };
    if (names.length === 1) throw new Error(`${LIFTER_NAMES_PAGE_SIZE} or more lifters share the name ${JSON.stringify(names[0])}`);
    return { names: names.slice(0, -1), done: false };
  },
});

export const lastCompleteRun = internalQuery({
  args: {},
  handler: async (ctx): Promise<number | null> => (await ctx.db.query('lifter_sync').first())?.completeRunStartedAt ?? null,
});

export const recordCompleteRun = internalMutation({
  args: { startedAt: v.number() },
  handler: async (ctx, { startedAt }) => {
    const state = await ctx.db.query('lifter_sync').first();
    if (!state) await ctx.db.insert('lifter_sync', { completeRunStartedAt: startedAt });
    else if (startedAt > state.completeRunStartedAt) await ctx.db.patch(state._id, { completeRunStartedAt: startedAt });
  },
});

export const queuedRelinks = internalQuery({
  args: {},
  handler: async (ctx): Promise<string[]> => (await ctx.db.query('lifter_relinks').take(MAX_QUEUED_RELINKS)).map((row) => row.nameKey),
});

export const liftersByName = internalQuery({
  args: { nameKeys: v.array(v.string()) },
  handler: async (ctx, { nameKeys }): Promise<LifterName[]> => {
    if (nameKeys.length > MAX_LIFTER_NAME_LOOKUPS) throw new Error(`at most ${MAX_LIFTER_NAME_LOOKUPS} names a call, got ${nameKeys.length}`);
    return await Promise.all(
      [...new Set(nameKeys)].map(async (nameKey) => ({
        nameKey,
        athleteIds: (await candidateLifters(ctx, nameKey)).map((lifter) => lifter.athleteId),
        sport80Results: (await rowsOfName(ctx, nameKey)).some(isSport80Result),
      })),
    );
  },
});
