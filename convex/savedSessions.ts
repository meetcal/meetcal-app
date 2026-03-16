import { v } from "convex/values";
import { convertZonedLocalToUTC } from "../utils/timezone";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";

async function requireUserId(ctx: { auth: { getUserIdentity: () => Promise<{ subject: string } | null> } }): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthenticated");
  return identity.subject;
}

function assertScraperSecret(scraperSecret: string): void {
  const expected = process.env.SCRAPER_SECRET;
  if (!expected || scraperSecret !== expected) {
    throw new Error("Unauthorized: invalid scraper secret");
  }
}

function isUsableIsoDate(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export const getByUser = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const callerId = await requireUserId(ctx);
    if (callerId !== userId) throw new Error("Unauthorized: can only read own saved sessions");
    return ctx.db
      .query("saved_sessions")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
  },
});

export const upsert = mutation({
  args: {
    sessionId: v.string(),
    userId: v.string(),
    meet: v.string(),
    sessionNumber: v.number(),
    platform: v.string(),
    weightClass: v.optional(v.string()),
    startTime: v.optional(v.string()),
    notes: v.optional(v.string()),
    athleteNames: v.optional(v.array(v.string())),
    date: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const callerId = await requireUserId(ctx);
    if (callerId !== args.userId) throw new Error("Unauthorized: can only modify own saved sessions");
    const existing = await ctx.db
      .query("saved_sessions")
      .withIndex("by_sessionId_and_userId", (q) =>
        q.eq("sessionId", args.sessionId).eq("userId", args.userId)
      )
      .unique();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { ...args, updatedAt: now });
      return existing._id;
    }
    return ctx.db.insert("saved_sessions", { ...args, updatedAt: now });
  },
});

export const upsertSystem = internalMutation({
  args: {
    sessionId: v.string(),
    userId: v.string(),
    meet: v.string(),
    sessionNumber: v.number(),
    platform: v.string(),
    weightClass: v.optional(v.string()),
    startTime: v.optional(v.string()),
    notes: v.optional(v.string()),
    athleteNames: v.optional(v.array(v.string())),
    date: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("saved_sessions")
      .withIndex("by_sessionId_and_userId", (q) =>
        q.eq("sessionId", args.sessionId).eq("userId", args.userId)
      )
      .unique();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { ...args, updatedAt: now });
      return existing._id;
    }
    return ctx.db.insert("saved_sessions", { ...args, updatedAt: now });
  },
});

export const upsertFromIngestion = mutation({
  args: {
    scraperSecret: v.string(),
    sessionId: v.string(),
    userId: v.string(),
    meet: v.string(),
    sessionNumber: v.number(),
    platform: v.string(),
    weightClass: v.optional(v.string()),
    startTime: v.optional(v.string()),
    notes: v.optional(v.string()),
    athleteNames: v.optional(v.array(v.string())),
    date: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertScraperSecret(args.scraperSecret);
    const upsertArgs = {
      sessionId: args.sessionId,
      userId: args.userId,
      meet: args.meet,
      sessionNumber: args.sessionNumber,
      platform: args.platform,
      weightClass: args.weightClass,
      startTime: args.startTime,
      notes: args.notes,
      athleteNames: args.athleteNames,
      date: args.date,
    };

    const existing = await ctx.db
      .query("saved_sessions")
      .withIndex("by_sessionId_and_userId", (q) =>
        q.eq("sessionId", upsertArgs.sessionId).eq("userId", upsertArgs.userId)
      )
      .unique();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { ...upsertArgs, updatedAt: now });
      return existing._id;
    }
    return ctx.db.insert("saved_sessions", { ...upsertArgs, updatedAt: now });
  },
});

// Remove a single saved session
export const remove = mutation({
  args: { sessionId: v.string(), userId: v.string() },
  handler: async (ctx, { sessionId, userId }) => {
    const callerId = await requireUserId(ctx);
    if (callerId !== userId) throw new Error("Unauthorized: can only delete own saved sessions");
    const existing = await ctx.db
      .query("saved_sessions")
      .withIndex("by_sessionId_and_userId", (q) =>
        q.eq("sessionId", sessionId).eq("userId", userId)
      )
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
      return true;
    }
    return false;
  },
});

// Remove all saved sessions for a user, optionally scoped to a single meet
export const removeAllForUser = mutation({
  args: {
    userId: v.string(),
    meet: v.optional(v.string()),
  },
  handler: async (ctx, { userId, meet }) => {
    const callerId = await requireUserId(ctx);
    if (callerId !== userId) throw new Error("Unauthorized: can only delete own saved sessions");
    let rows = await ctx.db
      .query("saved_sessions")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    if (meet) {
      rows = rows.filter((r) => r.meet === meet);
    }

    await Promise.all(rows.map((r) => ctx.db.delete(r._id)));
    return rows.length;
  },
});

export const getEarliestSavedSessionDateForUsers = internalQuery({
  args: { userIds: v.array(v.string()) },
  handler: async (ctx, { userIds }) => {
    if (userIds.length === 0) return null;

    let earliest: string | null = null;
    for (const userId of userIds) {
      const rows = await ctx.db
        .query("saved_sessions")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .collect();

      for (const row of rows) {
        if (!isUsableIsoDate(row.date)) continue;
        if (!earliest || row.date < earliest) {
          earliest = row.date;
        }
      }
    }

    return earliest;
  },
});

export const removeExpiredSavedSessionsForUser = internalMutation({
  args: { userId: v.string(), now: v.number() },
  handler: async (ctx, { userId, now }) => {
    const rows = await ctx.db
      .query("saved_sessions")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    if (rows.length === 0) return 0;

    const meetCache = new Map<
      string,
      { timeZone: string } | null
    >();
    const sessionScheduleCache = new Map<
      string,
      { date: string; startTime: string; platform: string }[]
    >();
    let removedCount = 0;

    for (const row of rows) {
      let meetInfo = meetCache.get(row.meet);
      if (meetInfo === undefined) {
        const meet = await ctx.db
          .query("meets")
          .withIndex("by_name", (q) => q.eq("name", row.meet))
          .unique();
        meetInfo = meet ? { timeZone: meet.timeZone } : null;
        meetCache.set(row.meet, meetInfo);
      }

      if (!meetInfo?.timeZone) {
        console.warn("autoUnsaveSavedSessions: missing meet timezone", {
          userId,
          meet: row.meet,
          sessionId: row.sessionId,
        });
        continue;
      }

      const sessionCacheKey = `${row.meet}:${row.sessionNumber}`;
      let scheduleRows = sessionScheduleCache.get(sessionCacheKey);
      if (!scheduleRows) {
        const scheduleMatches = await ctx.db
          .query("session_schedule")
          .withIndex("by_meet_and_session", (q) =>
            q.eq("meet", row.meet).eq("sessionId", row.sessionNumber),
          )
          .collect();
        scheduleRows = scheduleMatches.map((match) => ({
          date: match.date,
          startTime: match.startTime,
          platform: match.platform,
        }));
        sessionScheduleCache.set(sessionCacheKey, scheduleRows);
      }

      const matchedSchedule = scheduleRows.find(
        (scheduleRow) => scheduleRow.platform === row.platform,
      );
      const resolvedDate =
        matchedSchedule?.date ??
        (isUsableIsoDate(row.date) ? row.date : undefined);
      const resolvedStartTime = matchedSchedule?.startTime ?? row.startTime;

      if (!resolvedDate || !resolvedStartTime) {
        console.warn("autoUnsaveSavedSessions: missing session timing", {
          userId,
          meet: row.meet,
          sessionId: row.sessionId,
        });
        continue;
      }

      let sessionStartUtc: Date;
      try {
        sessionStartUtc = convertZonedLocalToUTC(
          resolvedDate,
          resolvedStartTime,
          meetInfo.timeZone,
        );
      } catch (error) {
        console.warn("autoUnsaveSavedSessions: failed to convert session time", {
          userId,
          meet: row.meet,
          sessionId: row.sessionId,
          error,
        });
        continue;
      }

      const expiresAt = sessionStartUtc.getTime() + 2 * 60 * 60 * 1000;
      if (now >= expiresAt) {
        await ctx.db.delete(row._id);
        removedCount += 1;
      }
    }

    return removedCount;
  },
});
