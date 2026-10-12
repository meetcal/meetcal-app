import { ConvexError } from 'convex/values';
import {
  deleteSavedSession,
  deleteSavedSessions,
  MAX_SAVED_SESSIONS_PER_USER,
  putSavedSession,
  SAVED_SESSION_WRITE_ORDER_PRUNE_BATCH,
  SAVED_SESSION_WRITE_ORDER_TTL_MS,
  savedSessions,
} from '../convex/users';
import { fakeDb, handlerOf } from './fakeDb';

/**
 * Write ordering for saved sessions (`convex/users.ts`, issue #191): a write
 * from an install that has already applied a newer one to the session is
 * ignored and answered as a success; another install's write, or one with no
 * revision (an older app), applies as it arrives.
 */

const USER = 'user_1';
const MEET = 'Spring Open';
const OTHER_MEET = 'Fall Classic';
const PHONE = 'phone-install-1';
const TABLET = 'tablet-install-2';
const T0 = Date.UTC(2026, 9, 12, 12);

type Revision = { device?: unknown; rev?: unknown };
type Args = Record<string, unknown>;

function server(seed: Record<string, Record<string, unknown>[]> = {}) {
  const store = fakeDb(seed);
  let now = T0;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  const ctx = { db: store.db, auth: { getUserIdentity: async () => ({ subject: USER }) } };
  const call = (fn: unknown, args: Args) => handlerOf<Args>(fn)(ctx, args) as Promise<Record<string, unknown>>;
  return {
    ...store,
    advance: (ms: number) => {
      now += ms;
    },
    put: (sessionId: string, notes: string, revision: Revision = {}, meet = MEET) =>
      call(putSavedSession, { sessionId, meet, session_number: 1, platform: 'Red', notes, ...revision }),
    unsave: (sessionId: string, revision: Revision = {}) => call(deleteSavedSession, { sessionId, ...revision }),
    reset: (meet: string | undefined, revision: Revision = {}) => call(deleteSavedSessions, { meet, ...revision }),
    list: async () => {
      const { sessions } = (await handlerOf(savedSessions)(ctx, {})) as { sessions: { session_id: string; notes: string | null }[] };
      return sessions.map((row) => `${row.session_id}:${row.notes}`);
    },
  };
}

const at = (device: string, rev: number) => ({ device, rev });

async function statusOf(promise: Promise<unknown>): Promise<number | 'ok'> {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    if (error instanceof ConvexError) return (error.data as { status: number }).status;
    throw error;
  }
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('saved-session write ordering', () => {
  it('ignores a save from the same install that lands after its later unsave, and answers success', async () => {
    const s = server();
    await s.put('a', 'v1', at(PHONE, 1));
    await s.unsave('a', at(PHONE, 3));
    // The save of rev 2 timed out on the client and reaches the server now.
    const late = await s.put('a', 'v2', at(PHONE, 2));

    expect(late).toMatchObject({ session_id: 'a', superseded: true });
    expect(typeof late.updated_at).toBe('number');
    expect(await s.list()).toEqual([]);
  });

  it('ignores an unsave that lands after a later save from the same install', async () => {
    const s = server();
    await s.put('a', 'v2', at(PHONE, 5));
    const late = await s.unsave('a', at(PHONE, 4));

    expect(late).toEqual({ deleted: false, superseded: true });
    expect(await s.list()).toEqual(['a:v2']);
  });

  it('ignores a resent copy of a write it already applied', async () => {
    const s = server();
    await s.put('a', 'v1', at(PHONE, 1));
    await s.put('a', 'v1', at(PHONE, 1));
    expect(await s.list()).toEqual(['a:v1']);
    expect(s.rows('saved_session_revisions')).toHaveLength(1);
  });

  it('ignores a save from before a reset of its meet, or of every meet, that lands after it', async () => {
    const s = server();
    await s.reset(MEET, at(PHONE, 5));
    expect(await s.put('a', 'old', at(PHONE, 4))).toMatchObject({ superseded: true });
    // The reset was of one meet: a save in another meet from before it applies.
    await s.put('b', 'other meet', at(PHONE, 3), OTHER_MEET);
    expect(await s.list()).toEqual(['b:other meet']);

    await s.reset(undefined, at(PHONE, 9));
    expect(await s.put('c', 'old', at(PHONE, 8), OTHER_MEET)).toMatchObject({ superseded: true });
    expect(await s.list()).toEqual([]);
  });

  it('ignores an unsave from before a reset of the session\'s meet', async () => {
    const s = server();
    await s.reset(MEET, at(PHONE, 5));
    await s.put('a', 'from the tablet', at(TABLET, 1));
    // The phone's reset already did what its earlier unsave asked.
    expect(await s.unsave('a', at(PHONE, 4))).toEqual({ deleted: false, superseded: true });
    expect(await s.list()).toEqual(['a:from the tablet']);
  });

  it('compares a write with a reset strictly: revs are unique, so only an older write is stale', async () => {
    const s = server();
    await s.reset(MEET, at(PHONE, 5));
    await s.put('a', 'same rev', at(PHONE, 5));
    expect(await s.list()).toEqual(['a:same rev']);
  });

  it('records an unsave of a session a reset already removed, so an older save stays out', async () => {
    const s = server();
    await s.put('a', 'v1', at(PHONE, 1));
    await s.reset(MEET, at(PHONE, 5));
    // The unsave from before the reset lands after it; the row is gone, and
    // with no row its meet is unknown, so only a reset-all could cover it.
    expect(await s.unsave('a', at(PHONE, 4))).toEqual({ deleted: false });
    expect(s.rows('saved_session_revisions')).toEqual([expect.objectContaining({ sessionId: 'a', rev: 4 })]);
    expect(await s.put('a', 'older', at(PHONE, 3))).toMatchObject({ superseded: true });
    expect(await s.list()).toEqual([]);
  });

  it("does not re-run a reset whose reply was lost, so another install's save in between stays", async () => {
    const s = server();
    await s.reset(MEET, at(PHONE, 5));
    // The phone never heard back; meanwhile the tablet saves a session.
    await s.put('a', 'tablet', at(TABLET, 1));
    // The phone resends the same reset.
    expect(await s.reset(MEET, at(PHONE, 5))).toEqual({ deleted_count: 0 });
    expect(await s.list()).toEqual(['a:tablet']);
  });

  it('does not let a reset land after a newer reset of its meet, or of every meet, from the same install', async () => {
    const s = server();
    await s.reset(MEET, at(PHONE, 7));
    await s.put('a', 'tablet', at(TABLET, 1));
    expect(await s.reset(MEET, at(PHONE, 4))).toEqual({ deleted_count: 0 });

    expect(await s.list()).toEqual(['a:tablet']);

    // A newer reset of every meet does remove it; an older meet reset after that does nothing.
    await s.reset(undefined, at(PHONE, 9));
    await s.put('b', 'tablet', at(TABLET, 2), OTHER_MEET);
    expect(await s.reset(OTHER_MEET, at(PHONE, 8))).toEqual({ deleted_count: 0 });
    expect(await s.list()).toEqual(['b:tablet']);
  });

  it("keeps a late reset of every meet out of the meets the install has reset since", async () => {
    const s = server();
    await s.reset(MEET, at(PHONE, 6));
    await s.put('a', 'tablet', at(TABLET, 1));
    await s.put('b', 'tablet', at(TABLET, 2), OTHER_MEET);
    // A reset of every meet from before the meet reset lands late.
    expect(await s.reset(undefined, at(PHONE, 3))).toEqual({ deleted_count: 1 });
    expect(await s.list()).toEqual(['a:tablet']);
  });

  it('applies a newer write from the same install', async () => {
    const s = server();
    await s.unsave('a', at(PHONE, 2));
    await s.put('a', 'v3', at(PHONE, 3));
    expect(await s.list()).toEqual(['a:v3']);
    await s.put('a', 'v4', at(PHONE, 4));
    expect(await s.list()).toEqual(['a:v4']);

    await s.reset(MEET, at(PHONE, 5));
    await s.put('a', 'v6', at(PHONE, 6));
    expect(await s.list()).toEqual(['a:v6']);
  });

  it('keeps a session the install saved after a reset that lands late', async () => {
    const s = server();
    await s.put('old', 'v1', at(PHONE, 1));
    await s.put('new', 'v1', at(PHONE, 7));
    await s.put('tablet', 'v1', at(TABLET, 50));
    await s.put('legacy', 'v1');

    const result = await s.reset(MEET, at(PHONE, 6));

    // Rows another install or an older app wrote go, as the reset arrived after them.
    expect(result).toEqual({ deleted_count: 3 });
    expect(await s.list()).toEqual(['new:v1']);
  });

  it('applies a write from another install whatever its rev', async () => {
    const s = server();
    await s.unsave('a', at(PHONE, 9));
    await s.put('a', 'tablet', at(TABLET, 1));
    expect(await s.list()).toEqual(['a:tablet']);

    await s.reset(MEET, at(PHONE, 20));
    await s.put('b', 'tablet', at(TABLET, 2));
    expect(await s.list()).toEqual(['b:tablet']);
  });

  it('applies a write without a revision (an older app) as it arrives', async () => {
    const s = server();
    await s.unsave('a', at(PHONE, 9));
    await s.put('a', 'old app');
    expect(await s.list()).toEqual(['a:old app']);
    await s.unsave('a');
    expect(await s.list()).toEqual([]);
    await s.put('a', 'old app again');
    await s.reset(MEET);
    expect(await s.list()).toEqual([]);
    // Unordered writes leave no revisions or markers behind.
    expect(s.rows('saved_session_revisions')).toEqual([expect.objectContaining({ sessionId: 'a', device: PHONE, rev: 9 })]);
    expect(s.rows('saved_session_resets')).toEqual([]);
  });

  it('applies a write to a session saved before ordering existed (no revision stored)', async () => {
    const s = server({
      saved_sessions: [
        { userId: USER, sessionId: 'a', meet: MEET, sessionNumber: 1, platform: 'Red', athleteNames: [], notes: 'pre-ordering', updatedAt: 1 },
      ],
    });
    await s.put('a', 'v1', at(PHONE, 1));
    expect(await s.list()).toEqual(['a:v1']);
  });

  it('keeps tombstones out of the list', async () => {
    const s = server();
    await s.put('a', 'v1', at(PHONE, 1));
    await s.put('b', 'v1', at(PHONE, 2));
    await s.unsave('a', at(PHONE, 3));

    expect(await s.list()).toEqual(['b:v1']);
    expect(s.rows('saved_sessions').map((row) => row.sessionId)).toEqual(['b']);
    expect(s.rows('saved_session_revisions')).toEqual(
      expect.arrayContaining([expect.objectContaining({ sessionId: 'a', device: PHONE, rev: 3 })]),
    );
  });

  it('does not count tombstones toward the saved-session cap', async () => {
    const s = server({
      saved_sessions: Array.from({ length: MAX_SAVED_SESSIONS_PER_USER - 1 }, (_, i) => ({
        userId: USER,
        sessionId: `kept${i}`,
        meet: MEET,
        sessionNumber: 1,
        platform: 'Red',
        athleteNames: [],
        updatedAt: 1,
      })),
    });
    for (let i = 0; i < 5; i += 1) await s.unsave(`gone${i}`, at(PHONE, i + 1));
    expect(await statusOf(s.put('last', 'v1', at(PHONE, 10)))).toBe('ok');
    expect(await statusOf(s.put('over', 'v1', at(PHONE, 11)))).toBe(400);
  });

  it('prunes revisions and markers older than the retention, a batch per write, newest kept', async () => {
    const s = server();
    await s.unsave('stale', at(PHONE, 1));
    await s.reset(OTHER_MEET, at(PHONE, 2));
    s.advance(SAVED_SESSION_WRITE_ORDER_TTL_MS - 1000);
    await s.unsave('recent', at(PHONE, 3));
    s.advance(2000);

    await s.put('a', 'v4', at(PHONE, 4));

    expect(s.rows('saved_session_revisions').map((row) => row.sessionId).sort()).toEqual(['a', 'recent']);
    expect(s.rows('saved_session_resets')).toEqual([]);
    // With its record gone, a write that old applies again: the retention
    // only has to outlive a delayed request.
    await s.put('stale', 'resurrected after a week', at(PHONE, 1));
    expect(await s.list()).toContain('stale:resurrected after a week');
  });

  it('prunes at most a batch per write, so a write never scans a backlog', async () => {
    const expired = T0 - SAVED_SESSION_WRITE_ORDER_TTL_MS - 1;
    const backlog = SAVED_SESSION_WRITE_ORDER_PRUNE_BATCH + 8;
    const s = server({
      saved_session_revisions: Array.from({ length: backlog }, (_, i) => ({
        userId: USER,
        sessionId: `s${i}`,
        device: PHONE,
        rev: i + 1,
        updatedAt: expired,
      })),
    });

    await s.put('a', 'v1', at(PHONE, 1000));
    expect(s.rows('saved_session_revisions')).toHaveLength(backlog - SAVED_SESSION_WRITE_ORDER_PRUNE_BATCH + 1);
    await s.put('a', 'v2', at(PHONE, 1001));
    expect(s.rows('saved_session_revisions')).toEqual([expect.objectContaining({ sessionId: 'a', rev: 1001 })]);
  });

  it('only touches the caller\'s own records', async () => {
    const s = server({
      saved_session_revisions: [{ userId: 'someone_else', sessionId: 'a', device: PHONE, rev: 99, updatedAt: 0 }],
      saved_session_resets: [{ userId: 'someone_else', device: PHONE, meet: null, rev: 99, updatedAt: 0 }],
    });
    await s.put('a', 'mine', at(PHONE, 1));
    expect(await s.list()).toEqual(['a:mine']);
    expect(s.rows('saved_session_revisions').filter((row) => row.userId === 'someone_else')).toHaveLength(1);
    expect(s.rows('saved_session_resets')).toHaveLength(1);
  });

  it.each<[string, Revision]>([
    ['a device without a rev', { device: PHONE }],
    ['a rev without a device', { rev: 1 }],
    ['a blank device', { device: '  ', rev: 1 }],
    ['a device over 64 characters', { device: 'x'.repeat(65), rev: 1 }],
    ['a rev of 0', { device: PHONE, rev: 0 }],
    ['a fractional rev', { device: PHONE, rev: 1.5 }],
    ['a rev as text', { device: PHONE, rev: '1' }],
    ['a device that is not text', { device: 7, rev: 1 }],
  ])('refuses %s with a 400 on every write', async (_, revision) => {
    const s = server();
    expect(await statusOf(s.put('a', 'v1', revision))).toBe(400);
    expect(await statusOf(s.unsave('a', revision))).toBe(400);
    expect(await statusOf(s.reset(MEET, revision))).toBe(400);
  });

  it('reads null device and rev as absent', async () => {
    const s = server();
    expect(await statusOf(s.put('a', 'v1', { device: null, rev: null }))).toBe('ok');
    expect(s.rows('saved_session_revisions')).toEqual([]);
  });
});
