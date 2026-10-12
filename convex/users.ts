import { mutation, query, type QueryCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { compareCollated } from './lib/sort';
import { apiError, isValidIsoDate, requireNonEmpty } from './lib/validation';

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

/**
 * The mutations the app's outbox replays check their arguments here, not with
 * an `args` validator. A production deployment reports a validator's
 * rejection as a bare "Server Error", which the app cannot tell from a
 * passing fault, so a write the server will never accept would be retried
 * forever and block the writes queued behind it. Thrown from here it is the
 * Rust API's 400, and the outbox drops it. Unknown fields are ignored, so an
 * app newer than the deployment still saves; `null` reads as absent.
 */
type RawArgs = Record<string, unknown>;

function optionalString(args: RawArgs, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw apiError(400, `${key} must be a string`);
  return value;
}

function requiredString(args: RawArgs, key: string): string {
  const value = optionalString(args, key);
  if (value === undefined) throw apiError(400, `${key} is required`);
  return value;
}

function requiredNumber(args: RawArgs, key: string): number {
  const value = args[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw apiError(400, `${key} must be a number`);
  return value;
}

function optionalStringArray(args: RawArgs, key: string): string[] | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw apiError(400, `${key} must be a list of strings`);
  return value as string[];
}

/**
 * A start time as schedules and the app spell it (`src/utils/time.ts`):
 * `9:00 AM`, `9:00:00 AM`, `9:00AM`, or 24-hour `09:00` / `09:00:00`.
 */
const START_TIME = /^(?:(?:0?[1-9]|1[0-2]):[0-5]\d(?::[0-5]\d)?\s*(?:AM|PM)|(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?)$/i;

/**
 * The saved session's when, which the app counts down to and auto-unsaves
 * by: a whole session number from 1, and a `YYYY-MM-DD` date and a clock
 * start time when given. Text that is not a date at all is "not known" and
 * stays allowed: the app sends `''` for a session without a schedule row, and
 * forwards a schedule's own placeholder (`TBD`) as the date. A date with
 * digits in it must be a real `YYYY-MM-DD` one.
 */
export function requireSavedSessionWhen(sessionNumber: number, date: string | undefined, startTime: string | undefined): void {
  if (!Number.isInteger(sessionNumber) || sessionNumber < 1) {
    throw apiError(400, 'session_number must be a whole number from 1');
  }
  if (date !== undefined && /\d/.test(date) && !isValidIsoDate(date)) {
    throw apiError(400, 'date must be a valid YYYY-MM-DD date');
  }
  if (startTime !== undefined && startTime.trim() !== '' && !START_TIME.test(startTime.trim())) {
    throw apiError(400, 'start_time must be a time such as 9:00 AM or 09:00');
  }
}

function requireMaxLen(what: string, value: string | undefined, max: number): void {
  if (value !== undefined && Array.from(value).length > max) {
    throw apiError(400, what, { max });
  }
}

/**
 * The user's rows for a session. Normally one, but the pre-port upsert
 * enforced uniqueness in code, so a stray duplicate can exist: a save keeps
 * one and deletes the rest, an unsave deletes them all (as Rust's
 * `DELETE ... WHERE user_id AND session_id` did), so an unsaved session
 * cannot come back through its twin.
 */
async function savedSessionRows(ctx: QueryCtx, userId: string, sessionId: string) {
  return await ctx.db
    .query('saved_sessions')
    .withIndex('by_sessionId_and_userId', (q) => q.eq('sessionId', sessionId).eq('userId', userId))
    .take(MAX_SAVED_SESSIONS_PER_USER);
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
  handler: async (ctx, args: RawArgs) => {
    const sessionId = requiredString(args, 'sessionId');
    const body = {
      meet: requiredString(args, 'meet'),
      session_number: requiredNumber(args, 'session_number'),
      platform: requiredString(args, 'platform'),
      weight_class: optionalString(args, 'weight_class'),
      start_time: optionalString(args, 'start_time'),
      date: optionalString(args, 'date'),
      notes: optionalString(args, 'notes'),
      athlete_names: optionalStringArray(args, 'athlete_names'),
    };
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
    requireSavedSessionWhen(body.session_number, body.date, body.start_time);
    const athleteNames = body.athlete_names ?? [];
    if (athleteNames.length > MAX_SAVED_SESSION_ATHLETE_NAMES) {
      throw apiError(400, 'too many athlete_names', { max: MAX_SAVED_SESSION_ATHLETE_NAMES });
    }
    for (const name of athleteNames) {
      requireMaxLen('athlete_names entry too long', name, MAX_SAVED_SESSION_ATHLETE_NAME_LEN);
    }

    const userId = await requireUserId(ctx);
    const [existing, ...duplicates] = await savedSessionRows(ctx, userId, sessionId);
    for (const duplicate of duplicates) await ctx.db.delete(duplicate._id);
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
  handler: async (ctx, args: RawArgs) => {
    const sessionId = requiredString(args, 'sessionId');
    const userId = await requireUserId(ctx);
    const rows = await savedSessionRows(ctx, userId, sessionId);
    for (const row of rows) await ctx.db.delete(row._id);
    return { deleted: rows.length > 0 };
  },
});

/** `DELETE /users/me/saved-sessions[?meet=]` */
export const deleteSavedSessions = mutation({
  handler: async (ctx, args: RawArgs) => {
    const meet = optionalString(args, 'meet');
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
  handler: async (ctx, args: RawArgs) => {
    const enabled = args.enabled;
    if (typeof enabled !== 'boolean') throw apiError(400, 'enabled must be true or false');
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
