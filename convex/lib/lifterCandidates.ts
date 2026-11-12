import type { Doc } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

export async function rowsOfName(ctx: QueryCtx, nameKey: string): Promise<Doc<'lifting_results'>[]> {
  return await ctx.db
    .query('lifting_results')
    .withIndex('by_nameKey_and_date', (q) => q.eq('nameKey', nameKey))
    .collect();
}

export async function recordLifterName(ctx: MutationCtx, nameKey: string, athleteId: string): Promise<void> {
  const known = await ctx.db
    .query('lifter_names')
    .withIndex('by_nameKey_and_athleteId', (q) => q.eq('nameKey', nameKey).eq('athleteId', athleteId))
    .first();
  if (!known) await ctx.db.insert('lifter_names', { nameKey, athleteId });
}

export async function namesOfLifter(ctx: QueryCtx, athleteId: string): Promise<string[]> {
  const entries = await ctx.db
    .query('lifter_names')
    .withIndex('by_athleteId', (q) => q.eq('athleteId', athleteId))
    .collect();
  return entries.map((entry) => entry.nameKey);
}

export async function candidateLifters(ctx: QueryCtx, nameKey: string): Promise<Doc<'lifters'>[]> {
  const named = await ctx.db
    .query('lifters')
    .withIndex('by_nameKey', (q) => q.eq('nameKey', nameKey))
    .collect();
  const current = new Set(named.map((lifter) => lifter.athleteId));
  const formerly = (
    await ctx.db
      .query('lifter_names')
      .withIndex('by_nameKey_and_athleteId', (q) => q.eq('nameKey', nameKey))
      .collect()
  ).filter((entry) => !current.has(entry.athleteId));
  const renamed = await Promise.all(
    formerly.map((entry) =>
      ctx.db
        .query('lifters')
        .withIndex('by_athleteId', (q) => q.eq('athleteId', entry.athleteId))
        .unique(),
    ),
  );
  return [...named, ...renamed.filter((lifter): lifter is Doc<'lifters'> => lifter !== null)];
}
