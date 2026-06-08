import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

// Get all lifting results for a list of athlete names (replaces batch Supabase query)
export const getByNames = query({
  args: { names: v.array(v.string()) },
  handler: async (ctx, { names }) => {
    if (names.length === 0) return [];
    const batches = await Promise.all(
      names.map((name) =>
        ctx.db
          .query("lifting_results")
          .withIndex("by_name", (q) => q.eq("name", name))
          .collect()
      )
    );
    const all = batches.flat();
    all.sort((a, b) => b.date.localeCompare(a.date));
    return all;
  },
});

export const getByName = query({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const batches = await ctx.db
      .query("lifting_results")
      .withIndex("by_name", (q) => q.eq("name", name))
      .collect()

    batches.sort((a, b) => b.date.localeCompare(a.date));
    return batches;
  },
});

// Get historical results for a list of athletes since a cutoff date (for attempt estimator)
// Uses by_name_and_date index to avoid returning unbounded history
export const getByNamesSince = query({
  args: { names: v.array(v.string()), cutoffDate: v.string() },
  handler: async (ctx, { names, cutoffDate }) => {
    if (names.length === 0) return [];
    const batches = await Promise.all(
      names.map((name) =>
        ctx.db
          .query("lifting_results")
          .withIndex("by_name_and_date", (q) =>
            q.eq("name", name).gte("date", cutoffDate)
          )
          .collect()
      )
    );
    return batches.flat();
  },
});

// Get lifting results for one athlete since a cutoff date (for last-year bests)
export const getYearBestsByName = query({
  args: { name: v.string(), cutoffDate: v.string() },
  handler: async (ctx, { name, cutoffDate }) => {
    return ctx.db
      .query("lifting_results")
      .withIndex("by_name_and_date", (q) =>
        q.eq("name", name).gte("date", cutoffDate)
      )
      .collect();
  },
});

// Get all results for a specific meet name
export const getByMeet = query({
  args: { meet: v.string() },
  handler: async (ctx, { meet }) => {
    return ctx.db
      .query("lifting_results")
      .withIndex("by_meet", (q) => q.eq("meet", meet))
      .collect();
  },
});

// Get adaptive lifting results.
// Uses by_adaptive_and_federation index to skip BWL in the index scan.
// Gender is stored inside the `age` field (e.g. "55kg Men Senior") so
// gender filtering is done client-side after the index narrows results.
export const getAdaptive = query({
  args: {
    excludeFederation: v.optional(v.string()),
  },
  handler: async (ctx, { excludeFederation }) => {
    if (excludeFederation) {
      // Fetch all adaptive rows, excluding the given federation via index
      // Convex index can't do neq, so we scan adaptive=true rows and
      // filter federation out in memory — but the index still avoids
      // scanning non-adaptive rows (the large majority of lifting_results).
      const rows = await ctx.db
        .query("lifting_results")
        .withIndex("by_adaptive", (q) => q.eq("adaptive", true))
        .collect();
      return rows.filter((r) => r.federation !== excludeFederation);
    }
    return ctx.db
      .query("lifting_results")
      .withIndex("by_adaptive", (q) => q.eq("adaptive", true))
      .collect();
  },
});

// Get results for national rankings.
// Uses by_federation_and_age compound index so Convex filters both
// federation and age (weight-class-age string) at the storage layer,
// avoiding a full federation scan.
export const getNationalRankings = query({
  args: {
    federation: v.string(),
    ageCategory: v.string(),
  },
  handler: async (ctx, { federation, ageCategory }) => {
    const rows = await ctx.db
      .query("lifting_results")
      .withIndex("by_federation_and_age", (q) =>
        q.eq("federation", federation).eq("age", ageCategory)
      )
      .filter((q) =>
        q.and(
          q.neq(q.field("name"), undefined),
          q.neq(q.field("total"), undefined)
        )
      )
      .collect();

    // Sort by total descending (highest first, matching Supabase behaviour)
    rows.sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
    return rows;
  },
});

export const getNatRankings = query({
  args: {
    federation: v.string(),
    ageCategory: v.string(),
  },
  handler: async (ctx, { federation, ageCategory }) => {
    const rows = await ctx.db
      .query("lifting_results")
      .withIndex("by_federation_and_age", (q) =>
        q.eq("federation", federation).eq("age", ageCategory)
      )
      .filter((q) =>
        q.and(
          q.neq(q.field("name"), undefined),
          q.neq(q.field("total"), undefined),
          q.neq(q.field("total"), 0)
        )
      )
      .collect();

    // Sort by total descending (highest first, matching Supabase behaviour)
    rows.sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
    return rows;
  },
});

// Search lifting results by athlete name (partial match) with optional year range
export const searchByNameAndYear = query({
  args: {
    query: v.string(),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
  },
  handler: async (ctx, { query: q, startDate, endDate }) => {
    const rows = await ctx.db
      .query("lifting_results")
      .withSearchIndex("search_name", (s) => s.search("name", q))
      .take(256);
    let filtered = rows;
    if (startDate) filtered = filtered.filter((r) => r.date >= startDate!);
    if (endDate) filtered = filtered.filter((r) => r.date < endDate!);
    filtered.sort((a, b) => a.date.localeCompare(b.date));
    return filtered;
  },
});

// Upsert a lifting result (used by scrapers)
// Deduplication key: (eventId, name) — eventId is the Sport80 competition ID,
// shared by all athletes in a meet; name identifies the individual athlete.
export const upsertLiftingResult = internalMutation({
  args: {
    legacyId: v.optional(v.number()),
    eventId: v.string(),
    meet: v.string(),
    date: v.string(),
    name: v.string(),
    age: v.optional(v.string()),
    bodyWeight: v.optional(v.number()),
    snatch1: v.optional(v.number()),
    snatch2: v.optional(v.number()),
    snatch3: v.optional(v.number()),
    snatchBest: v.optional(v.number()),
    cj1: v.optional(v.number()),
    cj2: v.optional(v.number()),
    cj3: v.optional(v.number()),
    cjBest: v.optional(v.number()),
    total: v.optional(v.number()),
    adaptive: v.boolean(),
    federation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("lifting_results")
      .withIndex("by_event_and_name", (q) =>
        q.eq("eventId", args.eventId).eq("name", args.name)
      )
      .unique();

    if (existing) {
      const hasChanged =
        existing.legacyId !== args.legacyId ||
        existing.meet !== args.meet ||
        existing.date !== args.date ||
        existing.age !== args.age ||
        existing.bodyWeight !== args.bodyWeight ||
        existing.snatch1 !== args.snatch1 ||
        existing.snatch2 !== args.snatch2 ||
        existing.snatch3 !== args.snatch3 ||
        existing.snatchBest !== args.snatchBest ||
        existing.cj1 !== args.cj1 ||
        existing.cj2 !== args.cj2 ||
        existing.cj3 !== args.cj3 ||
        existing.cjBest !== args.cjBest ||
        existing.total !== args.total ||
        existing.adaptive !== args.adaptive ||
        existing.federation !== args.federation;

      if (!hasChanged) {
        return { id: existing._id, wasInsert: false, wasChanged: false };
      }

      await ctx.db.patch(existing._id, args);
      return { id: existing._id, wasInsert: false, wasChanged: true };
    }
    const id = await ctx.db.insert("lifting_results", args);
    return { id, wasInsert: true, wasChanged: true };
  },
});

// Delete ALL lifting results (migration utility — paginated to avoid timeout)
export const deleteAllBatch = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("lifting_results").take(500);
    await Promise.all(rows.map((r) => ctx.db.delete(r._id)));
    return rows.length;
  },
});

// Delete all lifting results for a meet
export const deleteByMeet = internalMutation({
  args: { meet: v.string() },
  handler: async (ctx, { meet }) => {
    const rows = await ctx.db
      .query("lifting_results")
      .withIndex("by_meet", (q) => q.eq("meet", meet))
      .collect();
    await Promise.all(rows.map((r) => ctx.db.delete(r._id)));
    return rows.length;
  },
});
