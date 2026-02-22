import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

async function requireUserId(ctx: { auth: { getUserIdentity: () => Promise<{ subject: string } | null> } }): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthenticated");
  return identity.subject;
}

export const getByUser = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const callerId = await requireUserId(ctx);
    if (callerId !== userId) throw new Error("Unauthorized: can only read own saved sessions");
    return ctx.db
      .query("saved_sessions")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
  },
});

export const upsert = mutation({
  args: {
    sessionId: v.string(),
    userId: v.string(),
    meet: v.string(),
    sessionNumber: v.number(),
    platform: v.string(),
    weightClass: v.optional(v.string()),
    startTime: v.optional(v.string()),
    notes: v.optional(v.string()),
    athleteNames: v.optional(v.array(v.string())),
    date: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const callerId = await requireUserId(ctx);
    if (callerId !== args.userId) throw new Error("Unauthorized: can only modify own saved sessions");
    const existing = await ctx.db
      .query("saved_sessions")
      .withIndex("by_sessionId_and_userId", (q) =>
        q.eq("sessionId", args.sessionId).eq("userId", args.userId)
      )
      .unique();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { ...args, updatedAt: now });
      return existing._id;
    }
    return ctx.db.insert("saved_sessions", { ...args, updatedAt: now });
  },
});

// Remove a single saved session
export const remove = mutation({
  args: { sessionId: v.string(), userId: v.string() },
  handler: async (ctx, { sessionId, userId }) => {
    const callerId = await requireUserId(ctx);
    if (callerId !== userId) throw new Error("Unauthorized: can only delete own saved sessions");
    const existing = await ctx.db
      .query("saved_sessions")
      .withIndex("by_sessionId_and_userId", (q) =>
        q.eq("sessionId", sessionId).eq("userId", userId)
      )
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
      return true;
    }
    return false;
  },
});

// Remove all saved sessions for a user, optionally scoped to a single meet
export const removeAllForUser = mutation({
  args: {
    userId: v.string(),
    meet: v.optional(v.string()),
  },
  handler: async (ctx, { userId, meet }) => {
    const callerId = await requireUserId(ctx);
    if (callerId !== userId) throw new Error("Unauthorized: can only delete own saved sessions");
    let rows = await ctx.db
      .query("saved_sessions")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    if (meet) {
      rows = rows.filter((r) => r.meet === meet);
    }

    await Promise.all(rows.map((r) => ctx.db.delete(r._id)));
    return rows.length;
  },
});
