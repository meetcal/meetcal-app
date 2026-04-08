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
      const hasChanged =
        existing.snatchRecord !== args.snatchRecord ||
        existing.cjRecord !== args.cjRecord ||
        existing.totalRecord !== args.totalRecord;

      if (!hasChanged) {
        return { id: existing._id, wasInsert: false, wasChanged: false };
      }

      await ctx.db.patch(existing._id, args);
      return { id: existing._id, wasInsert: false, wasChanged: true };
    }
    const id = await ctx.db.insert("wso_records", args);
    return { id, wasInsert: true, wasChanged: true };
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

export const replaceByWso = internalMutation({
  args: {
    wso: v.string(),
    records: v.array(
      v.object({
        ageCategory: v.string(),
        gender: v.string(),
        weightClass: v.string(),
        snatchRecord: v.optional(v.number()),
        cjRecord: v.optional(v.number()),
        totalRecord: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, { wso, records }) => {
    const existing = await ctx.db
      .query("wso_records")
      .withIndex("by_wso", (q) => q.eq("wso", wso))
      .collect();

    const keyFor = (record: {
      ageCategory: string;
      gender: string;
      weightClass: string;
    }) => `${record.ageCategory}::${record.gender}::${record.weightClass}`;

    const existingByKey = new Map(existing.map((record) => [keyFor(record), record]));
    const incomingByKey = new Map<
      string,
      {
        ageCategory: string;
        gender: string;
        weightClass: string;
        snatchRecord?: number;
        cjRecord?: number;
        totalRecord?: number;
      }
    >();

    for (const record of records) {
      const key = keyFor(record);
      if (incomingByKey.has(key)) {
        throw new Error(`Duplicate WSO record in payload: ${key}`);
      }
      incomingByKey.set(key, record);
    }

    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    let deleted = 0;

    for (const record of existing) {
      if (incomingByKey.has(keyFor(record))) continue;
      await ctx.db.delete(record._id);
      deleted++;
    }

    for (const record of records) {
      const existingRecord = existingByKey.get(keyFor(record));
      if (!existingRecord) {
        await ctx.db.insert("wso_records", {
          wso,
          ageCategory: record.ageCategory,
          gender: record.gender,
          weightClass: record.weightClass,
          snatchRecord: record.snatchRecord,
          cjRecord: record.cjRecord,
          totalRecord: record.totalRecord,
        });
        inserted++;
        continue;
      }

      const hasChanged =
        existingRecord.snatchRecord !== record.snatchRecord ||
        existingRecord.cjRecord !== record.cjRecord ||
        existingRecord.totalRecord !== record.totalRecord;

      if (!hasChanged) {
        unchanged++;
        continue;
      }

      await ctx.db.patch(existingRecord._id, {
        wso,
        ageCategory: record.ageCategory,
        gender: record.gender,
        weightClass: record.weightClass,
        snatchRecord: record.snatchRecord,
        cjRecord: record.cjRecord,
        totalRecord: record.totalRecord,
      });
      updated++;
    }

    return { inserted, updated, unchanged, deleted };
  },
});
