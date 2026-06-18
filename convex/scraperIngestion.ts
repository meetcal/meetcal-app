/**
 * Scraper-facing ingestion actions.
 *
 * All actions validate SCRAPER_SECRET before delegating to internal mutations.
 * Python scrapers call these via the `convex` PyPI package:
 *
 *   from convex import ConvexClient
 *   client = ConvexClient(os.environ["CONVEX_URL"])
 *   client.mutation("scraperIngestion:ingestLiftingResult", {"scraperSecret": ..., ...})
 */

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

function assertScraperSecret(scraperSecret: string): void {
  const expected = process.env.SCRAPER_SECRET;
  if (!expected || scraperSecret !== expected) {
    throw new Error("Unauthorized: invalid scraper secret");
  }
}

// ── Lifting Results ────────────────────────────────────────────────────────────

export const ingestLiftingResult = action({
  args: {
    scraperSecret: v.string(),
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
  handler: async (ctx, args): Promise<{ id: string; wasInsert: boolean; wasChanged: boolean }> => {
    assertScraperSecret(args.scraperSecret);
    return ctx.runMutation(internal.liftingResults.upsertLiftingResult, {
      legacyId: args.legacyId,
      eventId: args.eventId,
      meet: args.meet,
      date: args.date,
      name: args.name,
      age: args.age,
      bodyWeight: args.bodyWeight,
      snatch1: args.snatch1,
      snatch2: args.snatch2,
      snatch3: args.snatch3,
      snatchBest: args.snatchBest,
      cj1: args.cj1,
      cj2: args.cj2,
      cj3: args.cj3,
      cjBest: args.cjBest,
      total: args.total,
      adaptive: args.adaptive,
      federation: args.federation,
    });
  },
});

export const deleteLiftingResultsByEventIdAndNames = action({
  args: {
    scraperSecret: v.string(),
    eventId: v.string(),
    names: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<{ deleted: number }> => {
    assertScraperSecret(args.scraperSecret);
    const deleted = await ctx.runMutation(internal.liftingResults.deleteByEventIdAndNames, {
      eventId: args.eventId,
      names: args.names,
    });
    return { deleted };
  },
});

// ── Records ────────────────────────────────────────────────────────────────────

export const ingestRecord = action({
  args: {
    scraperSecret: v.string(),
    recordType: v.string(),
    ageCategory: v.string(),
    gender: v.string(),
    weightClass: v.string(),
    snatchRecord: v.optional(v.number()),
    cjRecord: v.optional(v.number()),
    totalRecord: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ id: string; wasInsert: boolean; wasChanged: boolean }> => {
    assertScraperSecret(args.scraperSecret);
    return ctx.runMutation(internal.records.upsertRecord, {
      recordType: args.recordType,
      ageCategory: args.ageCategory,
      gender: args.gender,
      weightClass: args.weightClass,
      snatchRecord: args.snatchRecord,
      cjRecord: args.cjRecord,
      totalRecord: args.totalRecord,
    });
  },
});

// Used by IWF scraper: delete all IWF records, then bulk-insert new ones
export const replaceIWFRecords = action({
  args: {
    scraperSecret: v.string(),
    records: v.array(
      v.object({
        recordType: v.string(),
        ageCategory: v.string(),
        gender: v.string(),
        weightClass: v.string(),
        snatchRecord: v.optional(v.number()),
        cjRecord: v.optional(v.number()),
        totalRecord: v.optional(v.number()),
      })
    ),
  },
  handler: async (ctx, args): Promise<{ deleted: boolean; inserted: number }> => {
    assertScraperSecret(args.scraperSecret);
    await ctx.runMutation(internal.records.deleteByRecordType, { recordType: "IWF" });
    let inserted = 0;
    for (const record of args.records) {
      await ctx.runMutation(internal.records.upsertRecord, record);
      inserted++;
    }
    return { deleted: true, inserted };
  },
});

// ── Qualifying Totals ──────────────────────────────────────────────────────────

export const ingestQualifyingTotal = action({
  args: {
    scraperSecret: v.string(),
    eventName: v.string(),
    gender: v.string(),
    ageCategory: v.string(),
    weightClass: v.string(),
    qualifyingTotal: v.number(),
  },
  handler: async (ctx, args): Promise<{ id: string; wasInsert: boolean }> => {
    assertScraperSecret(args.scraperSecret);
    return ctx.runMutation(internal.qualifyingTotals.upsertQualifyingTotal, {
      eventName: args.eventName,
      gender: args.gender,
      ageCategory: args.ageCategory,
      weightClass: args.weightClass,
      qualifyingTotal: args.qualifyingTotal,
    });
  },
});

// ── Standards ─────────────────────────────────────────────────────────────────

export const ingestStandard = action({
  args: {
    scraperSecret: v.string(),
    ageCategory: v.string(),
    gender: v.string(),
    weightClass: v.string(),
    standardA: v.number(),
    standardB: v.number(),
  },
  handler: async (ctx, args): Promise<{ id: string; wasInsert: boolean; wasChanged: boolean }> => {
    assertScraperSecret(args.scraperSecret);
    return ctx.runMutation(internal.standards.upsertStandard, {
      ageCategory: args.ageCategory,
      gender: args.gender,
      weightClass: args.weightClass,
      standardA: args.standardA,
      standardB: args.standardB,
    });
  },
});

// ── Athletes ───────────────────────────────────────────────────────────────────

export const ingestAthlete = action({
  args: {
    scraperSecret: v.string(),
    memberId: v.string(),
    name: v.string(),
    age: v.number(),
    club: v.string(),
    wso: v.optional(v.string()),
    gender: v.string(),
    weightClass: v.string(),
    entryTotal: v.number(),
    sessionNumber: v.optional(v.number()),
    sessionPlatform: v.optional(v.string()),
    meet: v.string(),
    adaptive: v.boolean(),
  },
  handler: async (ctx, args): Promise<{ id: string; wasInsert: boolean }> => {
    assertScraperSecret(args.scraperSecret);
    return ctx.runMutation(internal.athletes.upsertAthlete, {
      memberId: args.memberId,
      name: args.name,
      age: args.age,
      club: args.club,
      wso: args.wso,
      gender: args.gender,
      weightClass: args.weightClass,
      entryTotal: args.entryTotal,
      sessionNumber: args.sessionNumber,
      sessionPlatform: args.sessionPlatform,
      meet: args.meet,
      adaptive: args.adaptive,
    });
  },
});

export const deleteAthletesByMeet = action({
  args: {
    scraperSecret: v.string(),
    meet: v.string(),
  },
  handler: async (ctx, args): Promise<{ deleted: number }> => {
    assertScraperSecret(args.scraperSecret);
    const deleted = await ctx.runMutation(internal.athletes.deleteByMeet, {
      meet: args.meet,
    });
    return { deleted };
  },
});

// ── Session Schedule ───────────────────────────────────────────────────────────

export const ingestSessionSchedule = action({
  args: {
    scraperSecret: v.string(),
    date: v.string(),
    sessionId: v.number(),
    startTime: v.string(),
    weighInTime: v.string(),
    platform: v.string(),
    weightClass: v.string(),
    meet: v.string(),
  },
  handler: async (ctx, args): Promise<{ id: string; wasInsert: boolean }> => {
    assertScraperSecret(args.scraperSecret);
    return ctx.runMutation(internal.schedule.upsertSessionSchedule, {
      date: args.date,
      sessionId: args.sessionId,
      startTime: args.startTime,
      weighInTime: args.weighInTime,
      platform: args.platform,
      weightClass: args.weightClass,
      meet: args.meet,
    });
  },
});

export const deleteSessionScheduleByMeet = action({
  args: {
    scraperSecret: v.string(),
    meet: v.string(),
  },
  handler: async (ctx, args): Promise<{ deleted: number }> => {
    assertScraperSecret(args.scraperSecret);
    const deleted = await ctx.runMutation(internal.schedule.deleteByMeet, {
      meet: args.meet,
    });
    return { deleted };
  },
});

// ── WSO Records ────────────────────────────────────────────────────────────────

export const ingestWSORecord = action({
  args: {
    scraperSecret: v.string(),
    wso: v.string(),
    ageCategory: v.string(),
    gender: v.string(),
    weightClass: v.string(),
    snatchRecord: v.optional(v.number()),
    cjRecord: v.optional(v.number()),
    totalRecord: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ id: string; wasInsert: boolean; wasChanged: boolean }> => {
    assertScraperSecret(args.scraperSecret);
    return ctx.runMutation(internal.wsoRecords.upsertWSORecord, {
      wso: args.wso,
      ageCategory: args.ageCategory,
      gender: args.gender,
      weightClass: args.weightClass,
      snatchRecord: args.snatchRecord,
      cjRecord: args.cjRecord,
      totalRecord: args.totalRecord,
    });
  },
});

export const replaceWSORecordSet = action({
  args: {
    scraperSecret: v.string(),
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
  handler: async (
    ctx,
    args,
  ): Promise<{ inserted: number; updated: number; unchanged: number; deleted: number }> => {
    assertScraperSecret(args.scraperSecret);
    return ctx.runMutation(internal.wsoRecords.replaceByWso, {
      wso: args.wso,
      records: args.records,
    });
  },
});

// ── Meets ─────────────────────────────────────────────────────────────────────

export const ingestMeet = action({
  args: {
    scraperSecret: v.string(),
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
  handler: async (ctx, args): Promise<{ id: string; wasInsert: boolean }> => {
    assertScraperSecret(args.scraperSecret);
    return ctx.runMutation(internal.meets.upsertMeet, {
      name: args.name,
      venueName: args.venueName,
      venueStreet: args.venueStreet,
      venueCity: args.venueCity,
      venueState: args.venueState,
      venueZip: args.venueZip,
      timeZone: args.timeZone,
      startDate: args.startDate,
      endDate: args.endDate,
      status: args.status,
      federation: args.federation,
    });
  },
});

// ── Intl Rankings ─────────────────────────────────────────────────────────────

export const ingestIntlRanking = action({
  args: {
    scraperSecret: v.string(),
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
  handler: async (ctx, args): Promise<{ id: string; wasInsert: boolean }> => {
    assertScraperSecret(args.scraperSecret);
    return ctx.runMutation(internal.intlRankings.upsertIntlRanking, {
      legacyId: args.legacyId,
      meet: args.meet,
      ranking: args.ranking,
      name: args.name,
      weightClass: args.weightClass,
      total: args.total,
      percentA: args.percentA,
      gender: args.gender,
      ageCategory: args.ageCategory,
    });
  },
});

// Bulk-replace all intl rankings (delete then insert)
export const replaceAllIntlRankings = action({
  args: {
    scraperSecret: v.string(),
    rankings: v.array(
      v.object({
        legacyId: v.optional(v.number()),
        meet: v.optional(v.string()),
        ranking: v.optional(v.number()),
        name: v.optional(v.string()),
        weightClass: v.optional(v.string()),
        total: v.optional(v.number()),
        percentA: v.optional(v.number()),
        gender: v.optional(v.string()),
        ageCategory: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args): Promise<{ inserted: number }> => {
    assertScraperSecret(args.scraperSecret);
    await ctx.runMutation(internal.intlRankings.deleteAll, {});
    let inserted = 0;
    for (const ranking of args.rankings) {
      await ctx.runMutation(internal.intlRankings.upsertIntlRanking, ranking);
      inserted++;
    }
    return { inserted };
  },
});

// Replace rankings for a specific meet + gender + age category only
export const replaceIntlRankingsForGroup = action({
  args: {
    scraperSecret: v.string(),
    meet: v.string(),
    gender: v.string(),
    ageCategory: v.string(),
    rankings: v.array(
      v.object({
        legacyId: v.optional(v.number()),
        meet: v.optional(v.string()),
        ranking: v.optional(v.number()),
        name: v.optional(v.string()),
        weightClass: v.optional(v.string()),
        total: v.optional(v.number()),
        percentA: v.optional(v.number()),
        gender: v.optional(v.string()),
        ageCategory: v.optional(v.string()),
      })
    ),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ inserted: number; updated: number; unchanged: number; deleted: number }> => {
    assertScraperSecret(args.scraperSecret);
    return ctx.runMutation(internal.intlRankings.replaceByMeetGenderAge, {
      meet: args.meet,
      gender: args.gender,
      ageCategory: args.ageCategory,
      rankings: args.rankings,
    });
  },
});

export const deleteMissingIntlRankingGroups = action({
  args: {
    scraperSecret: v.string(),
    groups: v.array(
      v.object({
        meet: v.string(),
        gender: v.string(),
        ageCategory: v.string(),
      })
    ),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    deletedGroups: Array<{
      meet: string;
      gender: string;
      ageCategory: string;
      deleted: number;
    }>;
  }> => {
    assertScraperSecret(args.scraperSecret);
    return ctx.runMutation(internal.intlRankings.deleteGroupsNotIn, {
      groups: args.groups,
    });
  },
});
