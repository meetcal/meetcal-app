import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";

// Get all athletes for a meet
export const getByMeet = query({
  args: { meet: v.string() },
  handler: async (ctx, { meet }) => {
    return ctx.db
      .query("athletes")
      .withIndex("by_meet", (q) => q.eq("meet", meet))
      .collect();
  },
});

export const getByMeetAndSession = query({
  args: { meet: v.string(), sessionNumber: v.float64(), sessionPlatform: v.string() },
  handler: async (ctx, { meet, sessionNumber, sessionPlatform }) => {
    return ctx.db
      .query("athletes")
      .withIndex("by_meet_and_session", (q) => q.eq("meet", meet).eq("sessionNumber", sessionNumber).eq("sessionPlatform", sessionPlatform))
      .collect();
  },
});

// Get athletes with their session schedule info joined in JS
// Replaces the Supabase `athletes_with_session` view
export const getWithSessionByMeet = query({
  args: { meet: v.string() },
  handler: async (ctx, { meet }) => {
    const [athletes, scheduleRows] = await Promise.all([
      ctx.db
        .query("athletes")
        .withIndex("by_meet", (q) => q.eq("meet", meet))
        .collect(),
      ctx.db
        .query("session_schedule")
        .withIndex("by_meet", (q) => q.eq("meet", meet))
        .collect(),
    ]);

    // Build a map keyed by sessionId:platform for O(1) lookup
    const sessionMap = new Map<string, (typeof scheduleRows)[0]>();
    for (const row of scheduleRows) {
      const key = `${row.sessionId}:${row.platform}`;
      if (!sessionMap.has(key)) {
        sessionMap.set(key, row);
      }
    }

    return athletes.map((a) => {
      const key =
        a.sessionNumber != null && a.sessionPlatform
          ? `${a.sessionNumber}:${a.sessionPlatform}`
          : null;
      const scheduleRow = key ? (sessionMap.get(key) ?? null) : null;
      return { ...a, scheduleRow };
    });
  },
});

// Get all athletes for a specific club (used by fetch-club-stats.ts)
export const getByClub = query({
  args: { club: v.string() },
  handler: async (ctx, { club }) => {
    return ctx.db
      .query("athletes")
      .withIndex("by_club", (q) => q.eq("club", club))
      .collect();
  },
});

// Get athletes for a specific club at a specific meet
export const getByClubAndMeet = query({
  args: { club: v.string(), meet: v.string() },
  handler: async (ctx, { club, meet }) => {
    return ctx.db
      .query("athletes")
      .withIndex("by_club_and_meet", (q) => q.eq("club", club).eq("meet", meet))
      .collect();
  },
});

// Get all unique club names (used by fetchAndStoreClubs)
export const listClubs = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("athletes").collect();
    const clubs = [...new Set(rows.map((r) => r.club).filter(Boolean))].sort();
    return clubs;
  },
});

// Search athletes by name across all lifting results (for start-list name search)
export const searchByName = query({
  args: { query: v.string() },
  handler: async (ctx, { query: q }) => {
    const results = await ctx.db
      .query("lifting_results")
      .withSearchIndex("search_name", (sq) => sq.search("name", q))
      .take(200);
    const uniqueNames = [...new Set(results.map((r) => r.name))].sort();
    return uniqueNames;
  },
});

// Upsert an athlete record (used by scrapers)
export const upsertAthlete = internalMutation({
  args: {
    memberId: v.string(),
    name: v.string(),
    age: v.number(),
    club: v.string(),
    wso: v.optional(v.string()),
    gender: v.string(),
    weightClass: v.string(),
    entryTotal: v.number(),
    sessionNumber: v.optional(v.number()),
    sessionPlatform: v.optional(v.string()),
    meet: v.string(),
    adaptive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("athletes")
      .withIndex("by_memberId", (q) => q.eq("memberId", args.memberId))
      .filter((q) => q.eq(q.field("meet"), args.meet))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, args);
      return { id: existing._id, wasInsert: false };
    }
    const id = await ctx.db.insert("athletes", args);
    return { id, wasInsert: true };
  },
});

// Delete all athletes for a meet (used before re-importing)
export const deleteByMeet = internalMutation({
  args: { meet: v.string() },
  handler: async (ctx, { meet }) => {
    const rows = await ctx.db
      .query("athletes")
      .withIndex("by_meet", (q) => q.eq("meet", meet))
      .collect();
    await Promise.all(rows.map((r) => ctx.db.delete(r._id)));
    return rows.length;
  },
});
