import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";

// Get all international rankings
export const getAll = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db.query("intl_rankings").collect();
  },
});

// Get rankings filtered by gender, age category, or meet
export const getFiltered = query({
  args: {
    gender: v.optional(v.string()),
    ageCategory: v.optional(v.string()),
    meet: v.optional(v.string()),
  },
  handler: async (ctx, { gender, ageCategory, meet }) => {
    if (gender && ageCategory) {
      const rows = await ctx.db
        .query("intl_rankings")
        .withIndex("by_gender_age", (q) =>
          q.eq("gender", gender).eq("ageCategory", ageCategory)
        )
        .collect();
      return meet ? rows.filter((r) => r.meet === meet) : rows;
    }

    let rows = await ctx.db.query("intl_rankings").collect();
    if (gender) rows = rows.filter((r) => r.gender?.toLowerCase() === gender.toLowerCase());
    if (ageCategory) rows = rows.filter((r) => r.ageCategory === ageCategory);
    if (meet) rows = rows.filter((r) => r.meet === meet);
    return rows;
  },
});

// Upsert an international ranking (used by rankings scraper)
export const upsertIntlRanking = internalMutation({
  args: {
    legacyId: v.optional(v.number()),
    meet: v.optional(v.string()),
    ranking: v.optional(v.number()),
    name: v.optional(v.string()),
    weightClass: v.optional(v.string()),
    total: v.optional(v.number()),
    percentA: v.optional(v.number()),
    gender: v.optional(v.string()),
    ageCategory: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Deduplication: use legacyId if present, else insert fresh
    if (args.legacyId != null) {
      const existing = await ctx.db
        .query("intl_rankings")
        .filter((q) => q.eq(q.field("legacyId"), args.legacyId))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, args);
        return existing._id;
      }
    }
    return ctx.db.insert("intl_rankings", args);
  },
});

// Delete all intl rankings (for bulk replace)
export const deleteAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("intl_rankings").collect();
    await Promise.all(rows.map((r) => ctx.db.delete(r._id)));
    return rows.length;
  },
});
