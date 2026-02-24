import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const meetStatus = v.union(
  v.literal("upcoming"),
  v.literal("ongoing"),
  v.literal("completed")
);

export default defineSchema({
  // ── athletes ──────────────────────────────────────────────────────────────
  athletes: defineTable({
    memberId: v.string(),
    name: v.string(),
    age: v.number(),
    club: v.string(),
    gender: v.string(),
    weightClass: v.string(),
    entryTotal: v.number(),
    sessionNumber: v.optional(v.number()),
    sessionPlatform: v.optional(v.string()),
    meet: v.string(),
    adaptive: v.boolean(),
  })
    .index("by_meet", ["meet"])
    .index("by_meet_and_session", ["meet", "sessionNumber", "sessionPlatform"])
    .index("by_adaptive", ["adaptive"])
    .index("by_memberId", ["memberId"])
    // Used by fetch-club-stats.ts: eq('club', club) and eq('club', club) + eq('meet', meet)
    .index("by_club", ["club"])
    .index("by_club_and_meet", ["club", "meet"]),

  // ── intl_rankings ─────────────────────────────────────────────────────────
  intl_rankings: defineTable({
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
    .index("by_meet", ["meet"])
    .index("by_gender_age", ["gender", "ageCategory"]),

  // ── lifting_results ────────────────────────────────────────────────────────
  lifting_results: defineTable({
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
  })
    .index("by_name", ["name"])
    .index("by_meet", ["meet"])
    .index("by_date", ["date"])
    .index("by_federation", ["federation"])
    .index("by_adaptive", ["adaptive"])
    .index("by_name_and_date", ["name", "date"])
    .index("by_event_and_name", ["eventId", "name"])
    // fetch-national-rankings: federation='USAW' + age=? + order by total DESC
    .index("by_federation_and_age", ["federation", "age"])
    // fetch-adaptive-records: adaptive=true + federation filter
    .index("by_adaptive_and_federation", ["adaptive", "federation"])
    // fetch-club-stats: in('name', names) + eq('meet', meet)
    .index("by_meet_and_name", ["meet", "name"])
    .searchIndex("search_name", { searchField: "name" }),

  // ── meets ──────────────────────────────────────────────────────────────────
  meets: defineTable({
    name: v.string(),
    venueName: v.string(),
    venueStreet: v.string(),
    venueCity: v.string(),
    venueState: v.string(),
    venueZip: v.string(),
    timeZone: v.string(),
    startDate: v.string(),
    endDate: v.string(),
    status: meetStatus,
    federation: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_status_and_start_date", ["status", "startDate"])
    .index("by_name", ["name"])
    .index("by_end_date", ["endDate"]),

  // ── qualifying_totals ──────────────────────────────────────────────────────
  qualifying_totals: defineTable({
    eventName: v.string(),
    gender: v.string(),
    ageCategory: v.string(),
    weightClass: v.string(),
    qualifyingTotal: v.number(),
  })
    .index("by_event", ["eventName"])
    .index("by_event_gender_age", ["eventName", "gender", "ageCategory"]),

  // ── records ────────────────────────────────────────────────────────────────
  records: defineTable({
    recordType: v.string(),
    ageCategory: v.string(),
    gender: v.string(),
    weightClass: v.string(),
    snatchRecord: v.optional(v.number()),
    cjRecord: v.optional(v.number()),
    totalRecord: v.optional(v.number()),
  })
    .index("by_record_type", ["recordType"])
    .index("by_type_age_gender", ["recordType", "ageCategory", "gender"]),

  // ── saved_sessions ─────────────────────────────────────────────────────────
  // The Supabase composite PK (id, user_id) is replaced with sessionId + userId
  // fields. Uniqueness is enforced in the upsert mutation.
  saved_sessions: defineTable({
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
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    // by_userId_and_meet removed: meet filtering happens client-side after getByUser
    .index("by_sessionId_and_userId", ["sessionId", "userId"]),

  // ── session_schedule ───────────────────────────────────────────────────────
  session_schedule: defineTable({
    date: v.string(),
    sessionId: v.number(),
    startTime: v.string(),
    weighInTime: v.string(),
    platform: v.string(),
    weightClass: v.string(),
    meet: v.string(),
  })
    .index("by_meet", ["meet"])
    .index("by_meet_and_session", ["meet", "sessionId"])
    .index("by_date", ["date"]),

  // ── standards ─────────────────────────────────────────────────────────────
  standards: defineTable({
    ageCategory: v.string(),
    gender: v.string(),
    weightClass: v.string(),
    standardA: v.number(),
    standardB: v.number(),
  })
    .index("by_age_gender", ["ageCategory", "gender"]),

  // ── wso_records ────────────────────────────────────────────────────────────
  wso_records: defineTable({
    wso: v.string(),
    ageCategory: v.string(),
    gender: v.string(),
    weightClass: v.string(),
    snatchRecord: v.optional(v.number()),
    cjRecord: v.optional(v.number()),
    totalRecord: v.optional(v.number()),
  })
    .index("by_wso", ["wso"])
    .index("by_wso_age_gender", ["wso", "ageCategory", "gender"]),

});
