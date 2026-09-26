import { v } from 'convex/values';
import { mutation, query, type QueryCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { compareCollated } from './lib/sort';
import { apiError, requireNonEmpty } from './lib/validation';

// `/users/me/*`. The Clerk subject is the user id, as in the Rust API; every
// read and write is scoped to it here instead of by row-level security.

export const MAX_SAVED_SESSION_ID_LEN = 256;
export const MAX_SAVED_SESSION_MEET_LEN = 256;
export const MAX_SAVED_SESSION_FIELD_LEN = 64;
export const MAX_SAVED_SESSION_NOTES_LEN = 2000;
export const MAX_SAVED_SESSION_ATHLETE_NAME_LEN = 128;
export const MAX_SAVED_SESSION_ATHLETE_NAMES = 64;
export const MAX_SAVED_SESSIONS_PER_USER = 500;

async function requireUserId(ctx: QueryCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw apiError(401, 'unauthorized');
  return identity.subject;
}

function requireMaxLen(what: string, value: string | undefined, max: number): void {
  if (value !== undefined && Array.from(value).length > max) {
    throw apiError(400, what, { max });
  }
}

/**
 * The user's row for a session. `.first()`, not `.unique()`: the pre-port
 * upsert enforced uniqueness in code, and one stray duplicate must not turn
 * every later save of that session into an error.
 */
async function savedSessionRow(ctx: QueryCtx, userId: string, sessionId: string) {
  return await ctx.db
    .query('saved_sessions')
    .withIndex('by_sessionId_and_userId', (q) => q.eq('sessionId', sessionId).eq('userId', userId))
    .first();
}

function toApiSavedSession(row: Doc<'saved_sessions'>) {
  return {
    session_id: row.sessionId,
    meet: row.meet,
    session_number: row.sessionNumber,
    platform: row.platform,
    weight_class: row.weightClass ?? null,
    start_time: row.startTime ?? null,
    date: row.date ?? null,
    notes: row.notes ?? null,
    athlete_names: row.athleteNames ?? [],
    updated_at: row.updatedAt,
  };
}

/** `GET /users/me/saved-sessions`, ordered by meet, date, session, platform. */
export const savedSessions = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const rows = await ctx.db
      .query('saved_sessions')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .collect();
    rows.sort(
      (a, b) =>
        compareCollated(a.meet, b.meet) ||
        // SQL sorts NULL dates last.
        (a.date === undefined ? (b.date === undefined ? 0 : 1) : b.date === undefined ? -1 : compareCollated(a.date, b.date)) ||
        a.sessionNumber - b.sessionNumber ||
        compareCollated(a.platform, b.platform),
    );
    return { sessions: rows.map(toApiSavedSession) };
  },
});

/** `PUT /users/me/saved-sessions/{session_id}`: upsert, stamped with server time. */
export const putSavedSession = mutation({
  args: {
    sessionId: v.string(),
    meet: v.string(),
    session_number: v.number(),
    platform: v.string(),
    weight_class: v.optional(v.string()),
    start_time: v.optional(v.string()),
    date: v.optional(v.string()),
    notes: v.optional(v.string()),
    athlete_names: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { sessionId, ...body }) => {
    if (sessionId.trim() === '') throw apiError(400, 'session_id is required');
    requireNonEmpty('meet', body.meet);
    requireNonEmpty('platform', body.platform);
    requireMaxLen('session_id too long', sessionId, MAX_SAVED_SESSION_ID_LEN);
    requireMaxLen('meet too long', body.meet, MAX_SAVED_SESSION_MEET_LEN);
    requireMaxLen('platform too long', body.platform, MAX_SAVED_SESSION_FIELD_LEN);
    requireMaxLen('weight_class too long', body.weight_class, MAX_SAVED_SESSION_FIELD_LEN);
    requireMaxLen('start_time too long', body.start_time, MAX_SAVED_SESSION_FIELD_LEN);
    requireMaxLen('date too long', body.date, MAX_SAVED_SESSION_FIELD_LEN);
    requireMaxLen('notes too long', body.notes, MAX_SAVED_SESSION_NOTES_LEN);
    const athleteNames = body.athlete_names ?? [];
    if (athleteNames.length > MAX_SAVED_SESSION_ATHLETE_NAMES) {
      throw apiError(400, 'too many athlete_names', { max: MAX_SAVED_SESSION_ATHLETE_NAMES });
    }
    for (const name of athleteNames) {
      requireMaxLen('athlete_names entry too long', name, MAX_SAVED_SESSION_ATHLETE_NAME_LEN);
    }

    const userId = await requireUserId(ctx);
    const existing = await savedSessionRow(ctx, userId, sessionId);
    if (!existing) {
      const count = (
        await ctx.db
          .query('saved_sessions')
          .withIndex('by_userId', (q) => q.eq('userId', userId))
          .take(MAX_SAVED_SESSIONS_PER_USER)
      ).length;
      if (count >= MAX_SAVED_SESSIONS_PER_USER) {
        throw apiError(400, 'too many saved sessions', { max: MAX_SAVED_SESSIONS_PER_USER });
      }
    }
    const row = {
      userId,
      sessionId,
      meet: body.meet,
      sessionNumber: body.session_number,
      platform: body.platform,
      weightClass: body.weight_class,
      startTime: body.start_time,
      notes: body.notes,
      athleteNames,
      date: body.date,
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.replace(existing._id, row);
    else await ctx.db.insert('saved_sessions', row);
    return { session_id: sessionId, updated_at: row.updatedAt };
  },
});

/** `DELETE /users/me/saved-sessions/{session_id}` */
export const deleteSavedSession = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    const userId = await requireUserId(ctx);
    const existing = await savedSessionRow(ctx, userId, sessionId);
    if (existing) await ctx.db.delete(existing._id);
    return { deleted: existing !== null };
  },
});

/** `DELETE /users/me/saved-sessions[?meet=]` */
export const deleteSavedSessions = mutation({
  args: { meet: v.optional(v.string()) },
  handler: async (ctx, { meet }) => {
    const userId = await requireUserId(ctx);
    const rows = (
      await ctx.db
        .query('saved_sessions')
        .withIndex('by_userId', (q) => q.eq('userId', userId))
        .collect()
    ).filter((row) => meet === undefined || row.meet === meet);
    await Promise.all(rows.map((row) => ctx.db.delete(row._id)));
    return { deleted_count: rows.length };
  },
});

/** `GET /users/me/preferences` */
export const preferences = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const row = await ctx.db
      .query('user_preferences')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first();
    return { auto_unsave_started_sessions: row?.autoUnsaveStartedSessions ?? false };
  },
});

/** `PATCH /users/me/preferences/auto-unsave` */
export const setAutoUnsave = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, { enabled }) => {
    const userId = await requireUserId(ctx);
    const existing = await ctx.db
      .query('user_preferences')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first();
    const row = { userId, autoUnsaveStartedSessions: enabled, updatedAt: Date.now() };
    if (existing) await ctx.db.replace(existing._id, row);
    else await ctx.db.insert('user_preferences', row);
    return { auto_unsave_started_sessions: enabled };
  },
});
