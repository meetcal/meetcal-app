import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";

// Get all session schedule rows for a meet
export const getByMeet = query({
  args: { meet: v.string() },
  handler: async (ctx, { meet }) => {
    return ctx.db
      .query("session_schedule")
      .withIndex("by_meet", (q) => q.eq("meet", meet))
      .collect();
  },
});

// Get schedule rows for a specific session within a meet
export const getByMeetAndSession = query({
  args: { meet: v.string(), sessionId: v.number() },
  handler: async (ctx, { meet, sessionId }) => {
    return ctx.db
      .query("session_schedule")
      .withIndex("by_meet_and_session", (q) =>
        q.eq("meet", meet).eq("sessionId", sessionId)
      )
      .collect();
  },
});

// Upsert a session schedule row (used by scrapers)
export const upsertSessionSchedule = internalMutation({
  args: {
    date: v.string(),
    sessionId: v.number(),
    startTime: v.string(),
    weighInTime: v.string(),
    platform: v.string(),
    weightClass: v.string(),
    meet: v.string(),
  },
  handler: async (ctx, args) => {
    // Uniqueness: (meet, sessionId, platform, weightClass)
    const existing = await ctx.db
      .query("session_schedule")
      .withIndex("by_meet_and_session", (q) =>
        q.eq("meet", args.meet).eq("sessionId", args.sessionId)
      )
      .filter((q) =>
        q.and(
          q.eq(q.field("platform"), args.platform),
          q.eq(q.field("weightClass"), args.weightClass)
        )
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return ctx.db.insert("session_schedule", args);
  },
});

// Delete all schedule rows for a meet (used before re-importing)
export const deleteByMeet = internalMutation({
  args: { meet: v.string() },
  handler: async (ctx, { meet }) => {
    const rows = await ctx.db
      .query("session_schedule")
      .withIndex("by_meet", (q) => q.eq("meet", meet))
      .collect();
    await Promise.all(rows.map((r) => ctx.db.delete(r._id)));
    return rows.length;
  },
});
