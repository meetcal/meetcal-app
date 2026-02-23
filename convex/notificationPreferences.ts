import { v } from "convex/values";
import { query, mutation, internalQuery } from "./_generated/server";

async function requireUserId(ctx: { auth: { getUserIdentity: () => Promise<{ subject: string } | null> } }): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthenticated");
  return identity.subject;
}

export const getByUser = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const callerId = await requireUserId(ctx);
    if (callerId !== userId) throw new Error("Unauthorized: can only read own notification preferences");
    return ctx.db
      .query("notification_preferences")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
  },
});

export const getAllEnabledUserIds = internalQuery({
  args: {},
  handler: async (ctx) => {
    const prefs = await ctx.db
      .query("notification_preferences")
      .withIndex("by_enabled", (q) => q.eq("notificationEnabled", true))
      .collect();
    return prefs.map((p) => p.userId);
  },
});

export const upsert = mutation({
  args: {
    userId: v.string(),
    notificationEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const callerId = await requireUserId(ctx);
    if (callerId !== args.userId) throw new Error("Unauthorized: can only modify own notification preferences");
    const existing = await ctx.db
      .query("notification_preferences")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        notificationEnabled: args.notificationEnabled ?? existing.notificationEnabled,
        updatedAt: now,
      });
      return existing._id;
    }
    return ctx.db.insert("notification_preferences", {
      userId: args.userId,
      notificationEnabled: args.notificationEnabled ?? true,
      updatedAt: now,
    });
  },
});
