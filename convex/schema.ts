import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * The Convex data model as it stood before the Rust port, extended (never
 * reshaped) for the queries that now answer the app:
 *
 * - `lifting_results.nameKey` is `normalizeName(name)`, so a per-athlete
 *   lookup is one index range and matches names case- and whitespace-
 *   insensitively, like the Rust API. Rows written before it existed are
 *   filled by `migrations:backfillNameKeys`.
 * - `meets.venueMapPdfUrl` / `venueMapAppleUrl` arrived in Postgres after the
 *   port.
 * - `views` / `view_chunks` hold materialized views (`convex/lib/views.ts`).
 *
 * Queries convert camelCase documents to the Rust API's snake_case JSON, so
 * `lib/api/meetcal-api.ts` validates and maps them unchanged.
 */
/**
 * Who set a record lift: the athlete, or "Standard" while nobody has claimed
 * it, with the date and where (meet and place) when the source gives them.
 * Stored beside each lift; `/data/records` and `/data/wso/records` answer it
 * as `snatch_by`, `cj_by` and `total_by`, and the website's record tables
 * show it (the app does not yet).
 */
export const recordHolder = v.object({
  name: v.string(),
  date: v.optional(v.string()),
  location: v.optional(v.string()),
});

const holders = {
  snatchBy: v.optional(recordHolder),
  cjBy: v.optional(recordHolder),
  totalBy: v.optional(recordHolder),
};

const meetStatus = v.union(v.literal('upcoming'), v.literal('ongoing'), v.literal('completed'));

// Field validators of the tables writers fill; `convex/ingest.ts` validates
// its input with the same objects.
export const athletesFields = {
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
};

export const intlRankingsFields = {
    legacyId: v.optional(v.number()),
    meet: v.optional(v.string()),
    ranking: v.optional(v.number()),
    name: v.optional(v.string()),
    weightClass: v.optional(v.string()),
    total: v.optional(v.number()),
    percentA: v.optional(v.number()),
    gender: v.optional(v.string()),
    ageCategory: v.optional(v.string()),
};

export const liftingResultsFields = {
    legacyId: v.optional(v.number()),
    eventId: v.string(),
    meet: v.string(),
    date: v.string(),
    name: v.string(),
    nameKey: v.optional(v.string()),
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
};

export const meetsFields = {
    name: v.string(),
    venueName: v.string(),
    venueStreet: v.string(),
    venueCity: v.string(),
    venueState: v.string(),
    venueZip: v.string(),
    venueMapPdfUrl: v.optional(v.string()),
    venueMapAppleUrl: v.optional(v.string()),
    timeZone: v.string(),
    startDate: v.string(),
    endDate: v.string(),
    status: meetStatus,
    federation: v.optional(v.string()),
    updatedAt: v.number(),
};

export const qualifyingTotalsFields = {
    eventName: v.string(),
    gender: v.string(),
    ageCategory: v.string(),
    weightClass: v.string(),
    qualifyingTotal: v.number(),
};

export const recordsFields = {
    recordType: v.string(),
    ageCategory: v.string(),
    gender: v.string(),
    weightClass: v.string(),
    snatchRecord: v.optional(v.number()),
    cjRecord: v.optional(v.number()),
    totalRecord: v.optional(v.number()),
    ...holders,
};

export const sessionScheduleFields = {
    date: v.string(),
    sessionId: v.number(),
    startTime: v.string(),
    weighInTime: v.string(),
    platform: v.string(),
    weightClass: v.string(),
    meet: v.string(),
};

export const standardsFields = {
    ageCategory: v.string(),
    gender: v.string(),
    weightClass: v.string(),
    standardA: v.number(),
    standardB: v.number(),
};

export const wsoRecordsFields = {
    wso: v.string(),
    ageCategory: v.string(),
    gender: v.string(),
    weightClass: v.string(),
    snatchRecord: v.optional(v.number()),
    cjRecord: v.optional(v.number()),
    totalRecord: v.optional(v.number()),
    ...holders,
};

export default defineSchema({
  athletes: defineTable(athletesFields)
    .index('by_meet', ['meet'])
    .index('by_meet_and_session', ['meet', 'sessionNumber', 'sessionPlatform'])
    .index('by_adaptive', ['adaptive'])
    .index('by_memberId', ['memberId'])
    .index('by_club', ['club'])
    .index('by_club_and_meet', ['club', 'meet'])
    .index('by_wso', ['wso'])
    .index('by_meet_and_wso', ['meet', 'wso']),

  intl_rankings: defineTable(intlRankingsFields)
    .index('by_meet', ['meet'])
    .index('by_gender_age', ['gender', 'ageCategory']),

  lifting_results: defineTable(liftingResultsFields)
    .index('by_name', ['name'])
    .index('by_meet', ['meet'])
    .index('by_date', ['date'])
    .index('by_federation', ['federation'])
    .index('by_adaptive', ['adaptive'])
    .index('by_name_and_date', ['name', 'date'])
    .index('by_event_and_name', ['eventId', 'name'])
    .index('by_federation_and_age', ['federation', 'age'])
    .index('by_adaptive_and_federation', ['adaptive', 'federation'])
    .index('by_meet_and_name', ['meet', 'name'])
    .index('by_nameKey_and_date', ['nameKey', 'date'])
    .searchIndex('search_name', { searchField: 'name' }),

  meets: defineTable(meetsFields)
    .index('by_status', ['status'])
    .index('by_status_and_start_date', ['status', 'startDate'])
    .index('by_name', ['name'])
    .index('by_end_date', ['endDate']),

  qualifying_totals: defineTable(qualifyingTotalsFields)
    .index('by_event', ['eventName'])
    .index('by_event_gender_age', ['eventName', 'gender', 'ageCategory']),

  records: defineTable(recordsFields)
    .index('by_record_type', ['recordType'])
    .index('by_type_age_gender', ['recordType', 'ageCategory', 'gender']),

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
    .index('by_userId', ['userId'])
    .index('by_sessionId_and_userId', ['sessionId', 'userId'])
    .index('by_date', ['date']),

  session_schedule: defineTable(sessionScheduleFields)
    .index('by_meet', ['meet'])
    .index('by_meet_and_session', ['meet', 'sessionId'])
    .index('by_date', ['date']),

  standards: defineTable(standardsFields).index('by_age_gender', ['ageCategory', 'gender']),

  wso_records: defineTable(wsoRecordsFields)
    .index('by_wso', ['wso'])
    .index('by_wso_age_gender', ['wso', 'ageCategory', 'gender']),

  user_preferences: defineTable({
    userId: v.string(),
    autoUnsaveStartedSessions: v.boolean(),
    updatedAt: v.number(),
  })
    .index('by_userId', ['userId'])
    .index('by_autoUnsaveStartedSessions', ['autoUnsaveStartedSessions']),

  views: defineTable({
    key: v.string(),
    etag: v.string(),
    chunk_count: v.number(),
    built_at: v.number(),
    // Versions of the source tables the view was built from; a header
    // without them predates versioning and is never served as fresh.
    sources: v.optional(v.array(v.object({ table: v.string(), version: v.number() }))),
    // Builder-specific facts about the content (the timelines' horizon).
    meta: v.optional(v.string()),
  }).index('by_key', ['key']),

  // Each athlete's whole history as JSON text, rewritten with every write to
  // their results (`convex/lib/history.ts`).
  // Each scheduled job's latest run, for the failure / missed-run email alerts
  // (cronJobs.ts). `alerting` is set while an alert is outstanding, so one
  // incident sends one email and its recovery another.
  cron_status: defineTable({
    job: v.string(),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    status: v.union(v.literal('running'), v.literal('ok'), v.literal('error')),
    error: v.optional(v.string()),
    alerting: v.optional(v.union(v.literal('failed'), v.literal('missed'), v.literal('stuck'))),
    // Alerts decided but not yet emailed. Cleared only after a send
    // succeeds; the watchdog retries them, so a failed send never hides an
    // outage.
    unsent: v.optional(v.array(v.object({ kind: v.string(), detail: v.string() }))),
  }).index('by_job', ['job']),

  // The last text of each page the urlwatch cron follows (urlwatch's cache.db).
  watched_pages: defineTable({
    url: v.string(),
    text: v.string(),
    error: v.optional(v.string()),
    checkedAt: v.number(),
    changedAt: v.number(),
  }).index('by_url', ['url']),

  // Sport80 entries pages the entries cron scrapes each night (the backend's
  // `entries_targets.json`, edited with `scrapers/entries:addTarget` / `removeTarget`).
  entry_targets: defineTable({
    label: v.string(),
    url: v.string(),
  }).index('by_url', ['url']),

  athlete_history: defineTable({
    nameKey: v.string(),
    json: v.string(),
  }).index('by_nameKey', ['nameKey']),

  // Search-directory name changes not yet applied to the two-letter shards
  // (`convex/views.ts`). Written with the directory, in the same transaction;
  // deleted once the shards hold them, so a failed refresh leaves them for
  // the next one instead of losing them.
  search_shard_pending: defineTable({
    name: v.string(),
    // Whether the directory had the name when queued. Informational: applying
    // reads the directory itself, which a full rebuild may have changed since.
    present: v.boolean(),
  }).index('by_name', ['name']),

  // A few hundred bytes per athlete for the name-list reads that need less
  // than the whole history (`convex/lib/history.ts`): the latest meet's rows
  // and each result's bests, both JSON text, newest first. Written with the
  // history document, in the same transaction.
  athlete_summary: defineTable({
    nameKey: v.string(),
    latest: v.string(),
    marks: v.string(),
  }).index('by_nameKey', ['nameKey']),

  // One row per source table, bumped by every write (`convex/ingest.ts`).
  data_versions: defineTable({
    table: v.string(),
    version: v.number(),
  }).index('by_table', ['table']),

  // Which rows the writes since the last view refresh touched, so the refresh
  // rebuilds only the views those rows can change.
  view_hints: defineTable({
    kind: v.string(),
    key: v.string(),
    // Bumped by every write that names this key. A refresh deletes the hint
    // only if it is unchanged since the refresh read it, so a write landing
    // mid-refresh keeps its hint for the next one.
    seq: v.optional(v.number()),
    // When a write last named this key. A full rebuild clears every hint
    // updated before it started, however many there are.
    updatedAt: v.optional(v.number()),
  })
    .index('by_kind_key', ['kind', 'key'])
    .index('by_updatedAt', ['updatedAt']),

  // Refresh bookkeeping (`convex/views.ts`): whether a refresh is scheduled,
  // and the source versions of the last completed one.
  view_state: defineTable({
    name: v.string(),
    scheduled: v.boolean(),
    baseline: v.array(v.object({ table: v.string(), version: v.number() })),
    // A full rebuild (`views:rebuildStage`) is running; refreshes wait for it.
    rebuilding: v.optional(v.boolean()),
    // When the running rebuild's latest stage started. A rebuild whose stage
    // failed stops beating, and the next refresh starts a new one.
    rebuildHeartbeat: v.optional(v.number()),
    // Times the running rebuild was restarted after a stage stopped; the
    // views-refresh job alerts once it keeps failing.
    rebuildRestarts: v.optional(v.number()),
    // When the running refresh began (its lease). One refresh at a time: a
    // second finds the lease held and tries again shortly.
    refreshLease: v.optional(v.number()),
  }).index('by_name', ['name']),

  // A view's text, cut into documents of well under 1 MiB.
  view_chunks: defineTable({
    key: v.string(),
    index: v.number(),
    text: v.string(),
  }).index('by_key_index', ['key', 'index']),
});
