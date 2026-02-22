import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";

// Get all WSO records
export const getAll = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db.query("wso_records").collect();
  },
});

// Get records for a specific WSO, optionally filtered by age/gender
export const getByWso = query({
  args: {
    wso: v.string(),
    ageCategory: v.optional(v.string()),
    gender: v.optional(v.string()),
  },
  handler: async (ctx, { wso, ageCategory, gender }) => {
    const rows = await ctx.db
      .query("wso_records")
      .withIndex("by_wso", (q) => q.eq("wso", wso))
      .collect();

    return rows.filter((r) => {
      if (ageCategory && r.ageCategory !== ageCategory) return false;
      if (gender && r.gender.toLowerCase() !== gender.toLowerCase()) return false;
      return true;
    });
  },
});

// List all distinct WSO names
export const listWsos = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("wso_records").collect();
    return [...new Set(rows.map((r) => r.wso))].sort();
  },
});

// Upsert a WSO record (used by WSO scrapers)
// Deduplication key: (wso, ageCategory, gender, weightClass)
export const upsertWSORecord = internalMutation({
  args: {
    wso: v.string(),
    ageCategory: v.string(),
    gender: v.string(),
    weightClass: v.string(),
    snatchRecord: v.optional(v.number()),
    cjRecord: v.optional(v.number()),
    totalRecord: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("wso_records")
      .withIndex("by_wso_age_gender", (q) =>
        q.eq("wso", args.wso).eq("ageCategory", args.ageCategory).eq("gender", args.gender)
      )
      .filter((q) => q.eq(q.field("weightClass"), args.weightClass))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, args);
      return { id: existing._id, wasInsert: false };
    }
    const id = await ctx.db.insert("wso_records", args);
    return { id, wasInsert: true };
  },
});

// Delete all records for a specific WSO (for bulk replace)
export const deleteByWso = internalMutation({
  args: { wso: v.string() },
  handler: async (ctx, { wso }) => {
    const rows = await ctx.db
      .query("wso_records")
      .withIndex("by_wso", (q) => q.eq("wso", wso))
      .collect();
    await Promise.all(rows.map((r) => ctx.db.delete(r._id)));
    return rows.length;
  },
});
