import { getFunctionName } from 'convex/server';
import * as views from '../convex/views';
import { MEET_INDEX_VIEW, meetKey, natKey } from '../convex/lib/viewKeys';
import { jsonChunks, readViewJsonAnyAge, writeView } from '../convex/lib/views';
import { fakeDb, handlerOf } from './fakeDb';

const STAMP = [{ table: 'lifting_results', version: 1 }];
type Stub = (args: Record<string, unknown>) => unknown;

/**
 * Runs `views` functions for real against an in-memory database: each
 * `runQuery` / `runMutation` / `runAction` calls the registered handler,
 * except the builders a test stubs (by function name, e.g. `buildNat`).
 */
function harness(initial: Record<string, Record<string, unknown>[]> = {}, stubs: Record<string, Stub> = {}) {
  const fake = fakeDb(initial);
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const scheduled: { name: string; args: Record<string, unknown> }[] = [];
  const scheduler = {
    runAfter: jest.fn(async (_delay: number, ref: unknown, args: Record<string, unknown>) => {
      scheduled.push({ name: getFunctionName(ref as never), args });
    }),
  };
  const run = async (ref: unknown, args: Record<string, unknown> = {}): Promise<unknown> => {
    const name = getFunctionName(ref as never).replace(/^views:/, '');
    calls.push({ name, args });
    if (stubs[name]) return await stubs[name](args);
    const fn = (views as Record<string, unknown>)[name];
    return await handlerOf<Record<string, unknown>>(fn)(ctx, args);
  };
  const ctx = { db: fake.db, scheduler, runQuery: run, runMutation: run, runAction: run };
  const called = (name: string) => calls.filter((c) => c.name === name).map((c) => c.args);
  const hints = () => fake.rows('view_hints').map((h) => `${h.kind}:${h.key}`).sort();
  return { ctx, fake, calls, called, scheduled, hints, run };
}

const hint = (kind: string, key: string, since?: string) => ({ kind, key, seq: 0, updatedAt: 1, ...(since ? { since } : {}) });
const nat = (age: string) => JSON.stringify(['USAW', age]);

/** Builders that would read whole meets and classes: recorded, not run. */
const builders = (overrides: Record<string, Stub> = {}): Record<string, Stub> => ({
  buildNat: () => 1,
  buildMeet: () => ({}),
  buildMeetTimelines: () => 0,
  statsBuildPlan: () => ({ sources: STAMP, wanted: [] }),
  buildMeetStats: () => 0,
  buildReferenceTables: () => null,
  buildClubs: () => null,
  buildWso: () => 0,
  ...overrides,
});

async function refresh(h: ReturnType<typeof harness>) {
  return (await handlerOf(views.refresh)(h.ctx, {})) as Record<string, number>;
}

async function seedMeets(h: ReturnType<typeof harness>, rosters: Record<string, { keys: string[]; statsMeta?: string }>) {
  const ctx = h.ctx as never;
  await writeView(ctx, MEET_INDEX_VIEW, jsonChunks(Object.keys(rosters).sort()), []);
  for (const [meet, { keys, statsMeta }] of Object.entries(rosters)) {
    await writeView(ctx, meetKey(meet, 'keys'), jsonChunks(keys), STAMP);
    if (statsMeta !== undefined) await writeView(ctx, meetKey(meet, 'stats'), jsonChunks([['club_counts', []]]), STAMP, { meta: statsMeta });
  }
}

describe('targeted refresh', () => {
  it('keeps the hints of a build that fails and deletes the rest', async () => {
    const h = harness(
      { view_hints: [hint('nat', nat('Open')), hint('nat', nat('Youth')), hint('table', 'records'), hint('table', 'meets')] },
      builders({
        buildNat: ({ ageCategory }) => {
          if (ageCategory === 'Youth') throw new Error('too many reads');
          return 1;
        },
      }),
    );
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = await refresh(h);
    error.mockRestore();
    expect(result).toMatchObject({ failed: 1, deferred: 0 });
    // The failed class only; the unread `table|meets` hint is dropped too.
    expect(h.hints()).toEqual([`nat:${nat('Youth')}`]);
    expect(h.called('buildReferenceTables')).toHaveLength(1);
    expect(h.fake.rows('view_state')[0].refreshLease).toBeUndefined();
  });

  it('rebuilds hinted meets, drops the views of meets with no row or roster, and keeps the meet index', async () => {
    const h = harness(
      {
        meets: [{ name: 'Spring Open' }, { name: 'New Meet' }],
        athletes: [{ meet: 'Roster Only', name: 'Ada', club: '' }],
        view_hints: [hint('meet', 'Spring Open'), hint('meet', 'New Meet'), hint('meet', 'Ghost Meet')],
      },
      builders(),
    );
    await writeView(h.ctx as never, meetKey('Ghost Meet', 'schedule'), jsonChunks([]), STAMP);
    await refresh(h);
    expect(h.called('buildMeet').map((a) => a.meet).sort()).toEqual(['New Meet', 'Spring Open']);
    expect(await readViewJsonAnyAge(h.ctx as never, meetKey('Ghost Meet', 'schedule'))).toBeNull();
    // Built from the tables on first use, then patched from the hints.
    expect(JSON.parse((await readViewJsonAnyAge(h.ctx as never, MEET_INDEX_VIEW)) ?? 'null')).toEqual(['New Meet', 'Roster Only', 'Spring Open']);
    expect(h.hints()).toEqual([]);
  });

  it('rebuilds an athlete’s timelines in every meet listing them, and stats only where the change is earlier', async () => {
    const h = harness({ view_hints: [hint('athlete', 'ada', '2026-05-01')] }, builders());
    await seedMeets(h, {
      'April Open': { keys: ['ada', 'bo'], statsMeta: '2026-04-05' },
      'June Open': { keys: ['ada'], statsMeta: '2026-06-01' },
      'Bo Only': { keys: ['bo'], statsMeta: '2026-06-01' },
    });
    await refresh(h);
    expect(h.called('buildMeetTimelines').map((a) => a.meet).sort()).toEqual(['April Open', 'June Open']);
    expect(h.called('statsBuildPlan').map((a) => a.meet)).toEqual(['June Open']);
    expect(h.called('buildMeetTimelines').some((a) => a.meet === 'Bo Only')).toBe(false);
    expect(h.hints()).toEqual([]);
  });

  it('keeps the hints of athletes on a roster whose rebuild failed', async () => {
    const h = harness(
      { view_hints: [hint('athlete', 'ada', '2020-01-01'), hint('athlete', 'bo', '2020-01-01')] },
      builders({
        buildMeetTimelines: ({ meet }) => {
          if (meet === 'Bad Meet') throw new Error('document too large');
          return 0;
        },
      }),
    );
    await seedMeets(h, { 'Bad Meet': { keys: ['ada'] }, 'Good Meet': { keys: ['ada', 'bo'] } });
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(await refresh(h)).toMatchObject({ failed: 1 });
    error.mockRestore();
    expect(h.hints()).toEqual(['athlete:ada']);
  });

  it('stops at its time budget, keeps what it did not reach, and queues another refresh', async () => {
    let now = 1_000_000;
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
    const h = harness(
      { view_hints: [hint('nat', nat('Open')), hint('nat', nat('Youth')), hint('table', 'records')] },
      builders({
        buildNat: () => {
          now += 4 * 60 * 1000;
          return 1;
        },
      }),
    );
    const result = await refresh(h);
    clock.mockRestore();
    expect(result).toMatchObject({ deferred: 1, failed: 0 });
    expect(h.called('buildNat')).toHaveLength(1);
    expect(h.hints()).toEqual([`nat:${nat('Youth')}`, 'table:records']);
    expect(h.scheduled.map((s) => s.name)).toContain('views:refresh');
  });

  it('only fails the hourly job when a build failed', async () => {
    const h = harness({ view_hints: [hint('nat', nat('Open'))] }, builders({ buildNat: () => { throw new Error('boom'); } }));
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(handlerOf(views.refreshJob)(h.ctx, {})).rejects.toThrow('1 view build(s) failed');
    error.mockRestore();
  });
});

describe('full rebuild', () => {
  it('leaves a hint for a ranking class it could not build and carries on', async () => {
    const h = harness({}, builders({ buildNat: ({ ageCategory }) => { if (ageCategory === 'Open') throw new Error('boom'); return 1; } }));
    await writeView(h.ctx as never, 'rebuild|classes', jsonChunks([nat('Open'), nat('Youth')]), []);
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    await handlerOf(views.rebuildStage)(h.ctx, { stage: 'nat', offset: 0, again: false, startedAt: 5 });
    error.mockRestore();
    expect(h.called('buildNat')).toHaveLength(2);
    expect(h.hints()).toEqual([`nat:${nat('Open')}`]);
    expect(h.scheduled).toEqual([{ name: 'views:rebuildStage', args: expect.objectContaining({ stage: 'meets', offset: 0, startedAt: 5 }) }]);
    // Where this stage began, for a restart.
    expect(h.fake.rows('view_state')[0].rebuildPosition).toEqual({ stage: 'nat', offset: 0, startedAt: 5, again: false });
  });

  it('resumes a stopped rebuild where its last stage began, not from the scan', async () => {
    const h = harness({
      view_state: [{
        name: 'refresh',
        scheduled: false,
        baseline: [],
        rebuilding: true,
        rebuildHeartbeat: 1,
        rebuildPosition: { stage: 'meets', offset: 40, startedAt: 5, again: false },
      }],
    });
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(await refresh(h)).toEqual({ restarted: 1 });
    error.mockRestore();
    expect(h.scheduled.find((s) => s.name === 'views:rebuildStage')?.args).toEqual({ stage: 'meets', offset: 40, startedAt: 5, again: true });
    expect(h.fake.rows('view_state')[0].rebuildRestarts).toBe(1);
  });

  it('sweeps views it did not rebuild unless a later write names them', async () => {
    const header = (key: string, built_at: number) => ({ key, etag: 'e', chunk_count: 1, built_at, sources: STAMP });
    const h = harness({
      views: [
        header(meetKey('Deleted Meet', 'schedule'), 10),
        header(natKey('USAW', 'Deleted class'), 10),
        header('adaptive|men|BWL|2025', 10),
        header(natKey('USAW', 'Rebuilt'), 500),
        header(meetKey('Written Meanwhile', 'schedule'), 10),
        header(natKey('USAW', 'Failed'), 10),
        header('search|names', 10),
        header(MEET_INDEX_VIEW, 10),
        header('rebuild|classes', 10),
      ],
      view_chunks: [{ key: meetKey('Deleted Meet', 'schedule'), index: 0, text: '[]' }],
      view_hints: [
        { kind: 'meet', key: 'Written Meanwhile', seq: 0, updatedAt: 200 },
        { kind: 'nat', key: JSON.stringify(['USAW', 'Failed']), seq: 0, updatedAt: 300 },
        { kind: 'meet', key: 'Deleted Meet', seq: 0, updatedAt: 50 },
      ],
    });
    await handlerOf(views.rebuildStage)(h.ctx, { stage: 'sweep', offset: 0, again: false, startedAt: 100 });
    expect(h.fake.rows('views').map((v) => v.key).sort()).toEqual(
      [natKey('USAW', 'Failed'), natKey('USAW', 'Rebuilt'), MEET_INDEX_VIEW, meetKey('Written Meanwhile', 'schedule'), 'rebuild|classes', 'search|names'].sort(),
    );
    expect(h.fake.rows('view_chunks')).toEqual([]);
    // Hints from before the rebuild are consumed; later ones stay.
    expect(h.hints()).toEqual([`meet:Written Meanwhile`, `nat:${JSON.stringify(['USAW', 'Failed'])}`]);
    expect(h.fake.rows('view_state')[0].rebuilding).toBe(false);
  });
});
