import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";

// Get all qualifying totals
export const getAll = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db.query("qualifying_totals").collect();
  },
});

// Get qualifying totals filtered by event, gender, age category
export const getFiltered = query({
  args: {
    eventName: v.optional(v.string()),
    gender: v.optional(v.string()),
    ageCategory: v.optional(v.string()),
  },
  handler: async (ctx, { eventName, gender, ageCategory }) => {
    let rows = await ctx.db.query("qualifying_totals").collect();

    if (eventName) rows = rows.filter((r) => r.eventName === eventName);
    if (gender) rows = rows.filter((r) => r.gender.toLowerCase() === gender.toLowerCase());
    if (ageCategory) rows = rows.filter((r) => r.ageCategory === ageCategory);

    return rows;
  },
});

// Upsert a qualifying total (used by USAMW scraper)
// Deduplication key: (eventName, gender, ageCategory, weightClass)
export const upsertQualifyingTotal = internalMutation({
  args: {
    eventName: v.string(),
    gender: v.string(),
    ageCategory: v.string(),
    weightClass: v.string(),
    qualifyingTotal: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("qualifying_totals")
      .withIndex("by_event_gender_age", (q) =>
        q
          .eq("eventName", args.eventName)
          .eq("gender", args.gender)
          .eq("ageCategory", args.ageCategory)
      )
      .filter((q) => q.eq(q.field("weightClass"), args.weightClass))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return ctx.db.insert("qualifying_totals", args);
  },
});
