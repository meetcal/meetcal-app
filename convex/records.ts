import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";

// Get records filtered by type, optionally narrowed by age category and gender
export const getByFederation = query({
  args: {
    recordType: v.string(),
    ageCategory: v.optional(v.string()),
    gender: v.optional(v.string()),
  },
  handler: async (ctx, { recordType, ageCategory, gender }) => {
    const rows = await ctx.db
      .query("records")
      .withIndex("by_record_type", (q) => q.eq("recordType", recordType))
      .collect();

    return rows.filter((r) => {
      if (ageCategory && r.ageCategory !== ageCategory) return false;
      if (gender && r.gender.toLowerCase() !== gender.toLowerCase()) return false;
      return true;
    });
  },
});

// List all distinct record types (federation names)
export const listFederations = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("records").collect();
    return [...new Set(rows.map((r) => r.recordType))].sort();
  },
});

// Upsert a record (used by scrapers)
// Deduplication key: (recordType, ageCategory, gender, weightClass)
export const upsertRecord = internalMutation({
  args: {
    recordType: v.string(),
    ageCategory: v.string(),
    gender: v.string(),
    weightClass: v.string(),
    snatchRecord: v.optional(v.number()),
    cjRecord: v.optional(v.number()),
    totalRecord: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("records")
      .withIndex("by_type_age_gender", (q) =>
        q
          .eq("recordType", args.recordType)
          .eq("ageCategory", args.ageCategory)
          .eq("gender", args.gender)
      )
      .filter((q) => q.eq(q.field("weightClass"), args.weightClass))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return ctx.db.insert("records", args);
  },
});

// Delete all records for a specific record type (e.g., IWF bulk replace)
export const deleteByRecordType = internalMutation({
  args: { recordType: v.string() },
  handler: async (ctx, { recordType }) => {
    const rows = await ctx.db
      .query("records")
      .withIndex("by_record_type", (q) => q.eq("recordType", recordType))
      .collect();
    await Promise.all(rows.map((r) => ctx.db.delete(r._id)));
    return rows.length;
  },
});
