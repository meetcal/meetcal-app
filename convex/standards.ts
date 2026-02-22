import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";

// Get all standards
export const getAll = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db.query("standards").collect();
  },
});

// Get standards filtered by age category and/or gender
export const getFiltered = query({
  args: {
    ageCategory: v.optional(v.string()),
    gender: v.optional(v.string()),
  },
  handler: async (ctx, { ageCategory, gender }) => {
    if (ageCategory && gender) {
      return ctx.db
        .query("standards")
        .withIndex("by_age_gender", (q) =>
          q.eq("ageCategory", ageCategory).eq("gender", gender)
        )
        .collect();
    }

    let rows = await ctx.db.query("standards").collect();
    if (ageCategory) rows = rows.filter((r) => r.ageCategory === ageCategory);
    if (gender) rows = rows.filter((r) => r.gender.toLowerCase() === gender.toLowerCase());
    return rows;
  },
});

// Upsert a standard (used by USAW standards scraper)
// Deduplication key: (ageCategory, gender, weightClass)
export const upsertStandard = internalMutation({
  args: {
    ageCategory: v.string(),
    gender: v.string(),
    weightClass: v.string(),
    standardA: v.number(),
    standardB: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("standards")
      .withIndex("by_age_gender", (q) =>
        q.eq("ageCategory", args.ageCategory).eq("gender", args.gender)
      )
      .filter((q) => q.eq(q.field("weightClass"), args.weightClass))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, args);
      return { id: existing._id, wasInsert: false };
    }
    const id = await ctx.db.insert("standards", args);
    return { id, wasInsert: true };
  },
});
