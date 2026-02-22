import { v } from "convex/values";
import {
  query,
  internalMutation,
  mutation,
} from "./_generated/server";

// List all non-completed meets ordered by start date
export const listActive = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db
      .query("meets")
      .withIndex("by_status")
      .filter((q) => q.neq(q.field("status"), "completed"))
      .order("asc")
      .collect();
  },
});

// List ALL meets (including completed) — useful for admin/scrapers
export const listAll = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db.query("meets").order("desc").collect();
  },
});

// Get a single meet by name (unique constraint)
export const getByName = query({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    return ctx.db
      .query("meets")
      .withIndex("by_name", (q) => q.eq("name", name))
      .unique();
  },
});

// Internal mutation: marks all past meets as 'completed'.
// Called by the daily cron job (meetStatusJob.ts).
export const markCompletedMeets = internalMutation({
  args: {},
  handler: async (ctx) => {
    const today = new Date().toISOString().split("T")[0];
    const pastMeets = await ctx.db
      .query("meets")
      .filter((q) =>
        q.and(
          q.neq(q.field("status"), "completed"),
          q.lt(q.field("endDate"), today)
        )
      )
      .collect();

    for (const meet of pastMeets) {
      await ctx.db.patch(meet._id, {
        status: "completed",
        updatedAt: Date.now(),
      });
    }

    return pastMeets.map((m) => ({ id: m._id, name: m.name, endDate: m.endDate }));
  },
});

// Upsert a meet by name (used by scrapers via scraperIngestion.ts)
export const upsertMeet = internalMutation({
  args: {
    name: v.string(),
    venueName: v.string(),
    venueStreet: v.string(),
    venueCity: v.string(),
    venueState: v.string(),
    venueZip: v.string(),
    timeZone: v.string(),
    startDate: v.string(),
    endDate: v.string(),
    status: v.optional(
      v.union(
        v.literal("upcoming"),
        v.literal("ongoing"),
        v.literal("completed")
      )
    ),
    federation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("meets")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .unique();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { ...args, updatedAt: now });
      return { id: existing._id, wasInsert: false };
    }
    const id = await ctx.db.insert("meets", {
      ...args,
      status: args.status ?? "upcoming",
      updatedAt: now,
    });
    return { id, wasInsert: true };
  },
});
