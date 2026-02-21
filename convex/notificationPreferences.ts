import { v } from "convex/values";
import { query, mutation, internalQuery } from "./_generated/server";

// Get notification preferences for a user
export const getByUser = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    return ctx.db
      .query("notification_preferences")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
  },
});

// Internal version used by the push notification action
export const getAllEnabledTokens = internalQuery({
  args: {},
  handler: async (ctx) => {
    const prefs = await ctx.db
      .query("notification_preferences")
      .withIndex("by_enabled", (q) => q.eq("notificationEnabled", true))
      .collect();
    return prefs
      .map((p) => p.expoPushToken)
      .filter((t): t is string => Boolean(t));
  },
});

// Upsert notification preferences for a user
export const upsert = mutation({
  args: {
    userId: v.string(),
    expoPushToken: v.optional(v.string()),
    notificationEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("notification_preferences")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { ...args, updatedAt: now });
      return existing._id;
    }
    return ctx.db.insert("notification_preferences", {
      userId: args.userId,
      expoPushToken: args.expoPushToken,
      notificationEnabled: args.notificationEnabled ?? true,
      updatedAt: now,
    });
  },
});
