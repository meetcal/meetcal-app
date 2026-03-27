import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";

async function requireUserId(ctx: {
  auth: { getUserIdentity: () => Promise<{ subject: string } | null> };
}): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthenticated");
  return identity.subject;
}

export const getForCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db
      .query("user_preferences")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();

    return {
      autoUnsaveStartedSessions: row?.autoUnsaveStartedSessions ?? false,
    };
  },
});

export const setAutoUnsaveStartedSessions = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, { enabled }) => {
    const userId = await requireUserId(ctx);
    const existing = await ctx.db
      .query("user_preferences")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();

    const updatedAt = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        autoUnsaveStartedSessions: enabled,
        updatedAt,
      });
    } else {
      await ctx.db.insert("user_preferences", {
        userId,
        autoUnsaveStartedSessions: enabled,
        updatedAt,
      });
    }

    return { autoUnsaveStartedSessions: enabled };
  },
});

export const listUsersWithAutoUnsaveEnabled = internalQuery({
  args: {},
  handler: async (ctx) => {
    return ctx.db
      .query("user_preferences")
      .withIndex("by_autoUnsaveStartedSessions", (q) =>
        q.eq("autoUnsaveStartedSessions", true),
      )
      .collect();
  },
});
