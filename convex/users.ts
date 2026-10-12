import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
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
export const MAX_SAVED_SESSION_DEVICE_LEN = 64;
/**
 * How long a write's revision and a reset's marker are kept. They only have
 * to outlive a request delayed in flight (minutes at most); a week leaves room
 * for a phone that sent a request and then slept.
 */
export const SAVED_SESSION_WRITE_ORDER_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Expired revisions and markers one write deletes per table. */
export const SAVED_SESSION_WRITE_ORDER_PRUNE_BATCH = 32;

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
 * A write's place in its install's order: the app's outbox sends its install
 * id (`device`) and the outbox entry's revision (`rev`, which only grows on
 * that install). Both or neither: an app from before the ordering sends
 * neither, and its writes apply as they arrive.
 */
export interface WriteRevision {
  device: string;
  rev: number;
}

export function optionalWriteRevision(args: RawArgs): WriteRevision | undefined {
  const device = optionalString(args, 'device');
  const rev = args.rev === null ? undefined : args.rev;
  if (device === undefined && rev === undefined) return undefined;
  if (device === undefined || rev === undefined) throw apiError(400, 'device and rev must be sent together');
  if (device.trim() === '') throw apiError(400, 'device is required');
  requireMaxLen('device too long', device, MAX_SAVED_SESSION_DEVICE_LEN);
  if (typeof rev !== 'number' || !Number.isSafeInteger(rev) || rev < 1) {
    throw apiError(400, 'rev must be a whole number from 1');
  }
  return { device, rev };
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

// Write ordering. Aborting a request that timed out cannot recall bytes
// already sent, so a save can reach the server after a later unsave (or meet
// reset) from the same install and undo it. Each install's writes carry a
// growing `rev`, and the server keeps, per install, the last rev applied to
// each session (`saved_session_revisions`, which outlives a delete, so it is
// the tombstone) and to each reset (`saved_session_resets`). A write from an
// install that has already applied a newer one to the session is stale: it
// is ignored but answered as a success, because the outbox must clear it
// (it is superseded, not refused). Only one install's writes are compared
// with each other: another install's write, or one with no revision, applies
// as it arrives, as before.

async function sessionRevision(ctx: QueryCtx, userId: string, sessionId: string, device: string) {
  return await ctx.db
    .query('saved_session_revisions')
    .withIndex('by_userId_and_sessionId_and_device', (q) =>
      q.eq('userId', userId).eq('sessionId', sessionId).eq('device', device),
    )
    .first();
}

async function resetMarker(ctx: QueryCtx, userId: string, device: string, meet: string | null) {
  return await ctx.db
    .query('saved_session_resets')
    .withIndex('by_userId_and_device_and_meet', (q) => q.eq('userId', userId).eq('device', device).eq('meet', meet))
    .first();
}

/**
 * Whether the same install has already applied a newer write to the session:
 * a save or unsave of it with a rev at least this one's, or a later reset of
 * `meets` (the session's meet, when known) or of every meet.
 */
async function isSuperseded(
  ctx: QueryCtx,
  userId: string,
  sessionId: string,
  meets: readonly string[],
  revision: WriteRevision,
): Promise<boolean> {
  const own = await sessionRevision(ctx, userId, sessionId, revision.device);
  if (own && own.rev >= revision.rev) return true;
  for (const meet of [...new Set(meets), null]) {
    const marker = await resetMarker(ctx, userId, revision.device, meet);
    if (marker && marker.rev > revision.rev) return true;
  }
  return false;
}

async function rememberSessionRevision(
  ctx: MutationCtx,
  userId: string,
  sessionId: string,
  revision: WriteRevision,
  now: number,
): Promise<void> {
  const existing = await sessionRevision(ctx, userId, sessionId, revision.device);
  if (existing) await ctx.db.patch(existing._id, { rev: Math.max(existing.rev, revision.rev), updatedAt: now });
  else await ctx.db.insert('saved_session_revisions', { userId, sessionId, ...revision, updatedAt: now });
}

async function rememberReset(
  ctx: MutationCtx,
  userId: string,
  meet: string | null,
  revision: WriteRevision,
  now: number,
): Promise<void> {
  const existing = await resetMarker(ctx, userId, revision.device, meet);
  if (existing) await ctx.db.patch(existing._id, { rev: Math.max(existing.rev, revision.rev), updatedAt: now });
  else await ctx.db.insert('saved_session_resets', { userId, meet, ...revision, updatedAt: now });
}

/**
 * Deletes up to a batch of the user's revisions and markers older than
 * `SAVED_SESSION_WRITE_ORDER_TTL_MS`, on each of the user's ordered writes.
 * Pruning here rather than in a cron keeps it to one indexed range per table
 * (the user's oldest records), with no scan over every user. Each write adds
 * at most one record and removes up to a batch, so a user's backlog drains;
 * a user who stops writing keeps at most what they wrote in their last week.
 */
async function pruneWriteOrder(ctx: MutationCtx, userId: string, now: number): Promise<void> {
  const cutoff = now - SAVED_SESSION_WRITE_ORDER_TTL_MS;
  const revisions = await ctx.db
    .query('saved_session_revisions')
    .withIndex('by_userId_and_updatedAt', (q) => q.eq('userId', userId).lt('updatedAt', cutoff))
    .take(SAVED_SESSION_WRITE_ORDER_PRUNE_BATCH);
  for (const row of revisions) await ctx.db.delete(row._id);
  const markers = await ctx.db
    .query('saved_session_resets')
    .withIndex('by_userId_and_updatedAt', (q) => q.eq('userId', userId).lt('updatedAt', cutoff))
    .take(SAVED_SESSION_WRITE_ORDER_PRUNE_BATCH);
  for (const row of markers) await ctx.db.delete(row._id);
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
    const revision = optionalWriteRevision(args);

    const userId = await requireUserId(ctx);
    const now = Date.now();
    const rows = await savedSessionRows(ctx, userId, sessionId);
    if (revision && (await isSuperseded(ctx, userId, sessionId, [body.meet], revision))) {
      return { session_id: sessionId, updated_at: rows[0]?.updatedAt ?? now, superseded: true };
    }
    const [existing, ...duplicates] = rows;
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
      updatedAt: now,
    };
    if (existing) await ctx.db.replace(existing._id, row);
    else await ctx.db.insert('saved_sessions', row);
    if (revision) {
      await rememberSessionRevision(ctx, userId, sessionId, revision, now);
      await pruneWriteOrder(ctx, userId, now);
    }
    return { session_id: sessionId, updated_at: row.updatedAt };
  },
});

/**
 * `DELETE /users/me/saved-sessions/{session_id}`. With a revision, the
 * session's revision for the install stays behind as its tombstone, so a save
 * from before the delete that lands after it is ignored.
 */
export const deleteSavedSession = mutation({
  handler: async (ctx, args: RawArgs) => {
    const sessionId = requiredString(args, 'sessionId');
    const revision = optionalWriteRevision(args);
    const userId = await requireUserId(ctx);
    const rows = await savedSessionRows(ctx, userId, sessionId);
    if (revision) {
      const meets = rows.map((row) => row.meet);
      if (await isSuperseded(ctx, userId, sessionId, meets, revision)) return { deleted: false, superseded: true };
    }
    for (const row of rows) await ctx.db.delete(row._id);
    if (revision) {
      const now = Date.now();
      await rememberSessionRevision(ctx, userId, sessionId, revision, now);
      await pruneWriteOrder(ctx, userId, now);
    }
    return { deleted: rows.length > 0 };
  },
});

/**
 * `DELETE /users/me/saved-sessions[?meet=]`. With a revision, it covers only
 * what its install wrote before it: a session the same install saved since
 * (a higher rev) stays, so a reset that lands late cannot delete it. The
 * reset is remembered, so a save from before it that lands later is ignored.
 */
export const deleteSavedSessions = mutation({
  handler: async (ctx, args: RawArgs) => {
    const meet = optionalString(args, 'meet');
    const revision = optionalWriteRevision(args);
    const userId = await requireUserId(ctx);
    const inScope = (
      await ctx.db
        .query('saved_sessions')
        .withIndex('by_userId', (q) => q.eq('userId', userId))
        .collect()
    ).filter((row) => meet === undefined || row.meet === meet);
    const rows: Doc<'saved_sessions'>[] = [];
    for (const row of inScope) {
      const own = revision ? await sessionRevision(ctx, userId, row.sessionId, revision.device) : null;
      if (revision && own && own.rev > revision.rev) continue;
      rows.push(row);
    }
    await Promise.all(rows.map((row) => ctx.db.delete(row._id)));
    if (revision) {
      const now = Date.now();
      await rememberReset(ctx, userId, meet ?? null, revision, now);
      await pruneWriteOrder(ctx, userId, now);
    }
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
