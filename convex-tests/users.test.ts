import { ConvexError } from 'convex/values';
import {
  deleteSavedSession,
  deleteSavedSessions,
  deleteUserData,
  MAX_SAVED_SESSIONS_PER_USER,
  preferences,
  putSavedSession,
  savedSessions,
  setAutoUnsave,
  USER_DATA_DELETE_BATCH,
} from '../convex/users';
import { fakeMutationCtx, handlerOf } from './fakeDb';

/**
 * `convex/users.ts` is the only code that scopes saved sessions and
 * preferences to their user (#220): every handler reads the Clerk subject and
 * touches only that user's rows.
 */

const A = 'user_a';
const B = 'user_b';
type Args = Record<string, unknown>;

const saved = (userId: string, sessionId: string, extra: Args = {}) => ({
  userId,
  sessionId,
  meet: 'Spring Open',
  sessionNumber: 1,
  platform: 'Red',
  athleteNames: [],
  updatedAt: 1,
  ...extra,
});

function server(seed: Record<string, Record<string, unknown>[]> = {}) {
  const store = fakeMutationCtx(seed);
  const as = (subject: string | null) => {
    const ctx = { ...store.ctx, auth: { getUserIdentity: async () => (subject === null ? null : { subject }) } };
    return (fn: unknown, args: Args = {}) => handlerOf<Args>(fn)(ctx, args) as Promise<Record<string, unknown>>;
  };
  return { ...store, as };
}

async function status(promise: Promise<unknown>): Promise<number | 'ok'> {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    if (error instanceof ConvexError) return (error.data as { status: number }).status;
    throw error;
  }
}

const put = (sessionId: string, extra: Args = {}) => ({ sessionId, meet: 'Spring Open', session_number: 1, platform: 'Red', ...extra });

describe('users.ts scoping (#220)', () => {
  it('refuses every handler without an identity, before reading or writing', async () => {
    const store = server({ saved_sessions: [saved(A, 's1')], user_preferences: [{ userId: A, autoUnsaveStartedSessions: true, updatedAt: 1 }] });
    const anonymous = store.as(null);
    const before = store.reads.count;
    expect(await status(anonymous(savedSessions))).toBe(401);
    expect(await status(anonymous(putSavedSession, put('s2')))).toBe(401);
    expect(await status(anonymous(deleteSavedSession, { sessionId: 's1' }))).toBe(401);
    expect(await status(anonymous(deleteSavedSessions))).toBe(401);
    expect(await status(anonymous(preferences))).toBe(401);
    expect(await status(anonymous(setAutoUnsave, { enabled: false }))).toBe(401);
    expect(store.reads.count).toBe(before);
    expect(store.rows('saved_sessions')).toHaveLength(1);
    expect(store.rows('user_preferences')[0].autoUnsaveStartedSessions).toBe(true);
  });

  it("lists and deletes only the caller's rows, never another user's with the same session id", async () => {
    const store = server({
      saved_sessions: [saved(A, 's1'), saved(B, 's1'), saved(A, 's2', { meet: 'Fall Classic' }), saved(B, 's3', { meet: 'Fall Classic' })],
    });
    const a = store.as(A);
    expect(((await a(savedSessions)).sessions as { session_id: string }[]).map((s) => s.session_id)).toEqual(['s2', 's1']);

    await a(deleteSavedSession, { sessionId: 's1' });
    expect(store.rows('saved_sessions').map((r) => [r.userId, r.sessionId])).toEqual([
      [B, 's1'],
      [A, 's2'],
      [B, 's3'],
    ]);
    expect(await a(deleteSavedSessions, { meet: 'Fall Classic' })).toEqual({ deleted_count: 1 });
    expect(store.rows('saved_sessions').map((r) => [r.userId, r.sessionId])).toEqual([
      [B, 's1'],
      [B, 's3'],
    ]);
    await a(putSavedSession, put('s4'));
    expect(await a(deleteSavedSessions)).toEqual({ deleted_count: 1 });
    expect(store.rows('saved_sessions').every((r) => r.userId === B)).toBe(true);
  });

  it("replaces the caller's row, deletes stray duplicates and leaves the other user's alone", async () => {
    const store = server({ saved_sessions: [saved(A, 's1', { notes: 'old' }), saved(A, 's1', { notes: 'twin' }), saved(B, 's1', { notes: 'theirs' })] });
    await store.as(A)(putSavedSession, put('s1', { notes: 'new' }));
    expect(store.rows('saved_sessions').map((r) => [r.userId, r.notes])).toEqual([
      [A, 'new'],
      [B, 'theirs'],
    ]);
  });

  it('refuses a new session past the cap but still updates one at the cap', async () => {
    const full = Array.from({ length: MAX_SAVED_SESSIONS_PER_USER }, (_, i) => saved(A, `s${i}`));
    const store = server({ saved_sessions: [...full, saved(B, 'extra')] });
    const a = store.as(A);
    expect(await status(a(putSavedSession, put('one-more')))).toBe(400);
    expect(await status(a(putSavedSession, put('s0', { notes: 'updated' })))).toBe('ok');
    expect(store.rows('saved_sessions').find((r) => r.userId === A && r.sessionId === 's0')?.notes).toBe('updated');
    // Another user's count is their own.
    expect(await status(store.as(B)(putSavedSession, put('b2')))).toBe('ok');
  });

  it('keeps preferences per user', async () => {
    const store = server();
    await store.as(A)(setAutoUnsave, { enabled: true });
    expect(await store.as(A)(preferences)).toEqual({ auto_unsave_started_sessions: true });
    expect(await store.as(B)(preferences)).toEqual({ auto_unsave_started_sessions: false });
    await store.as(A)(setAutoUnsave, { enabled: false });
    expect(store.rows('user_preferences')).toEqual([expect.objectContaining({ userId: A, autoUnsaveStartedSessions: false })]);
  });
});

describe('deleteUserData (#250)', () => {
  const seed = () => ({
    saved_sessions: [saved(A, 's1', { notes: 'private' }), saved(B, 's1')],
    user_preferences: [
      { userId: A, autoUnsaveStartedSessions: true, updatedAt: 1 },
      { userId: B, autoUnsaveStartedSessions: true, updatedAt: 1 },
    ],
    saved_session_revisions: [
      { userId: A, sessionId: 's1', device: 'phone', rev: 3, updatedAt: 1 },
      { userId: B, sessionId: 's1', device: 'phone', rev: 3, updatedAt: 1 },
    ],
    saved_session_resets: [
      { userId: A, device: 'phone', meet: null, rev: 2, updatedAt: 1 },
      { userId: B, device: 'phone', meet: null, rev: 2, updatedAt: 1 },
    ],
  });
  const run = handlerOf<{ userId: string }, Record<string, unknown>>(deleteUserData);

  it("deletes every row of the user and nobody else's", async () => {
    const store = fakeMutationCtx(seed());
    expect(await run(store.ctx, { userId: A })).toEqual({ sessions: 1, preferences: 1, revisions: 1, resets: 1, more: false });
    for (const table of ['saved_sessions', 'user_preferences', 'saved_session_revisions', 'saved_session_resets']) {
      expect(store.rows(table).map((r) => r.userId)).toEqual([B]);
    }
    expect(store.scheduled).toEqual([]);
    expect(await run(store.ctx, { userId: A })).toEqual({ sessions: 0, preferences: 0, revisions: 0, resets: 0, more: false });
  });

  it('continues in another call past a batch, and refuses a blank id', async () => {
    const many = Array.from({ length: USER_DATA_DELETE_BATCH + 3 }, (_, i) => ({ userId: A, sessionId: `s${i}`, device: 'phone', rev: 1, updatedAt: i }));
    const store = fakeMutationCtx({ saved_session_revisions: many });
    expect(await run(store.ctx, { userId: A })).toMatchObject({ revisions: USER_DATA_DELETE_BATCH, more: true });
    expect(store.scheduled).toEqual([{ name: 'users:deleteUserData', delayMs: 0, args: { userId: A } }]);
    expect(await run(store.ctx, { userId: A })).toMatchObject({ revisions: 3, more: false });
    await expect(run(store.ctx, { userId: ' ' })).rejects.toThrow('userId is required');
  });
});
