import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";

// Get all world records
export const getAll = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db.query("world_records").collect();
  },
});

// Get world records filtered by gender and/or age category
export const getByGenderAndAge = query({
  args: {
    gender: v.optional(v.string()),
    ageCategory: v.optional(v.string()),
  },
  handler: async (ctx, { gender, ageCategory }) => {
    if (gender && ageCategory) {
      return ctx.db
        .query("world_records")
        .withIndex("by_gender_age", (q) =>
          q.eq("gender", gender).eq("ageCategory", ageCategory)
        )
        .collect();
    }

    let rows = await ctx.db.query("world_records").collect();
    if (gender) rows = rows.filter((r) => r.gender.toLowerCase() === gender.toLowerCase());
    if (ageCategory) rows = rows.filter((r) => r.ageCategory === ageCategory);
    return rows;
  },
});

// Upsert a world record (used by IWF scraper)
// Deduplication key: (gender, ageCategory, weightClass)
export const upsertWorldRecord = internalMutation({
  args: {
    gender: v.string(),
    ageCategory: v.string(),
    weightClass: v.string(),
    snatchRecord: v.optional(v.number()),
    cjRecord: v.optional(v.number()),
    totalRecord: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("world_records")
      .withIndex("by_gender_age", (q) =>
        q.eq("gender", args.gender).eq("ageCategory", args.ageCategory)
      )
      .filter((q) => q.eq(q.field("weightClass"), args.weightClass))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return ctx.db.insert("world_records", args);
  },
});

// Delete all world records (for bulk replace by IWF scraper)
export const deleteAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("world_records").collect();
    await Promise.all(rows.map((r) => ctx.db.delete(r._id)));
    return rows.length;
  },
});
