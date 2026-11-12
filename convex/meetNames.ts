import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalAction, internalMutation, internalQuery, type ActionCtx } from './_generated/server';
import { meetHasRows, type MeetRowTable } from './lib/meetData';
import { parseMeetNames } from './lib/meetNameMatch';
import { compareBytes } from './lib/sort';
import { MEET_NAMES_VIEW } from './lib/viewKeys';
import { jsonChunks, readViewJsonAnyAge, writeView } from './lib/views';

const MEETS_PER_ROW_CHECK = 200;
const TABLES_HOLDING_MEET_NAMES: readonly MeetRowTable[] = ['lifting_results', 'athletes'];

export const meetsWithRows = internalQuery({
  args: { meets: v.array(v.string()) },
  handler: async (ctx, { meets }): Promise<string[]> => {
    const held = await Promise.all(
      meets.map(async (meet) => {
        for (const table of TABLES_HOLDING_MEET_NAMES) if (await meetHasRows(ctx, table, meet)) return meet;
        return null;
      }),
    );
    return held.filter((meet): meet is string => meet !== null);
  },
});

export const storeMeetNames = internalMutation({
  args: { chunks: v.array(v.string()) },
  handler: async (ctx, { chunks }) => {
    await writeView(ctx, MEET_NAMES_VIEW, chunks, []);
  },
});

export const patchMeetNames = internalMutation({
  args: { add: v.array(v.string()), remove: v.array(v.string()) },
  handler: async (ctx, { add, remove }) => {
    const text = await readViewJsonAnyAge(ctx, MEET_NAMES_VIEW);
    if (text === null) return;
    const meets = new Set(parseMeetNames(text));
    for (const meet of add) meets.add(meet);
    for (const meet of remove) meets.delete(meet);
    await writeView(ctx, MEET_NAMES_VIEW, jsonChunks([...meets].sort(compareBytes)), []);
  },
});

async function discoverMeetNames(ctx: ActionCtx): Promise<string[]> {
  const names = new Set<string>();
  for (const table of TABLES_HOLDING_MEET_NAMES) {
    let after: string | null = null;
    do {
      const page: { meets: string[]; after: string | null } = await ctx.runQuery(internal.views.distinctMeetsPage, { table, after });
      for (const meet of page.meets) names.add(meet);
      after = page.after;
    } while (after !== null);
  }
  return [...names].sort(compareBytes);
}

export const buildMeetNames = internalAction({
  args: {},
  handler: async (ctx): Promise<number> => {
    const names = await discoverMeetNames(ctx);
    await ctx.runMutation(internal.meetNames.storeMeetNames, { chunks: jsonChunks(names) });
    return names.length;
  },
});

export async function syncMeetNames(ctx: ActionCtx, hinted: readonly string[]): Promise<void> {
  const text: string | null = await ctx.runQuery(internal.views.jsonViewAnyAge, { key: MEET_NAMES_VIEW });
  if (text === null) {
    await ctx.runAction(internal.meetNames.buildMeetNames, {});
    return;
  }
  const indexed = new Set(parseMeetNames(text));
  const held = new Set<string>();
  for (let i = 0; i < hinted.length; i += MEETS_PER_ROW_CHECK) {
    const found: string[] = await ctx.runQuery(internal.meetNames.meetsWithRows, { meets: hinted.slice(i, i + MEETS_PER_ROW_CHECK) });
    for (const meet of found) held.add(meet);
  }
  const add = [...held].filter((meet) => !indexed.has(meet));
  const remove = hinted.filter((meet) => !held.has(meet) && indexed.has(meet));
  if (add.length + remove.length > 0) await ctx.runMutation(internal.meetNames.patchMeetNames, { add, remove });
}
