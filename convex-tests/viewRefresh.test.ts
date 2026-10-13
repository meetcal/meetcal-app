import { getFunctionName } from 'convex/server';
import * as views from '../convex/views';
import { LEGACY_SEARCH_SHARD_SIZES_VIEWS, MEET_INDEX_VIEW, meetKey, natKey, RESULT_NAMES_VIEW, SEARCH_SHARD_SIZES_VIEW, searchShardKey } from '../convex/lib/viewKeys';
import { search } from '../convex/results';
import { jsonChunks, readViewJsonAnyAge, readViewTextAnyAge, textChunks, writeView } from '../convex/lib/views';
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
  // A hint is deleted once its group's builds succeed, and a view with no
  // pending hint is served as fresh: a hint that reached no builder would
  // leave a stale view served as fresh (#139).
  it('sends every hint kind to the builder of each view it can change, and only then consumes it', async () => {
    const h = harness(
      {
        meets: [{ name: 'Known Meet' }],
        view_hints: [
          hint('nat', nat('Open')),
          hint('meet', 'Known Meet'),
          hint('athlete', 'ann lee'),
          hint('table', 'records'),
          hint('adaptive', '1'),
          hint('table', 'athletes'),
          hint('table', 'wso_records'),
          hint('name', 'Ann Lee'),
        ],
      },
      builders({ syncResultNames: () => null, pendingShardChanges: () => [] }),
    );
    await seedMeets(h, { 'Known Meet': { keys: ['bo kim'] }, 'Roster Meet': { keys: ['ann lee'] } });
    expect(await refresh(h)).toMatchObject({ failed: 0, deferred: 0 });
    expect(h.called('buildNat')).toEqual([{ federation: 'USAW', ageCategory: 'Open' }]);
    expect(h.called('buildMeet')).toEqual([{ meet: 'Known Meet' }]);
    // The athlete's results feed the year bests and stats of every meet whose roster lists them.
    expect(h.called('buildMeetTimelines').map((a) => a.meet).sort()).toEqual(['Known Meet', 'Roster Meet']);
    expect(h.called('statsBuildPlan').map((a) => a.meet).sort()).toEqual(['Known Meet', 'Roster Meet']);
    expect(h.called('buildReferenceTables')).toHaveLength(1);
    expect(h.called('buildClubs')).toHaveLength(1);
    expect(h.called('buildWso')).toHaveLength(1);
    expect(h.called('syncResultNames')).toEqual([{ names: ['Ann Lee'] }]);
    expect(h.hints()).toEqual([]);
  });

  it('starts a full rebuild instead when the hints overflow, and builds nothing itself', async () => {
    const h = harness({ view_hints: Array.from({ length: 2001 }, (_, i) => hint('meet', `Meet ${i}`)) }, builders());
    expect(await refresh(h)).toEqual({ full: 1 });
    expect(h.called('buildMeet')).toEqual([]);
    expect(h.scheduled.filter((s) => s.name === 'views:rebuildStage').map((s) => s.args.stage)).toEqual(['scan']);
    expect(h.hints()).toHaveLength(2001);
  });

  it('handles a backlog of cheap hints a page per refresh, never with a full rebuild (#215)', async () => {
    // 2,000 athletes' results: an athlete and a name hint each.
    const backlog = Array.from({ length: 2000 }, (_, i) => [hint('athlete', `lifter ${i}`), hint('name', `Lifter ${i}`)]).flat();
    const h = harness({ view_hints: backlog }, builders({ syncResultNames: () => null, pendingShardChanges: () => [] }));
    await seedMeets(h, { 'Roster Meet': { keys: ['lifter 1', 'lifter 3999'] } });
    const first = await refresh(h);
    expect(first).toMatchObject({ hints: 3500, more: 1, deferred: 0 });
    expect(h.hints()).toHaveLength(500);
    expect(h.scheduled.map((s) => s.name)).toEqual(['views:refresh']);
    expect(await handlerOf(views.refresh)(h.ctx, h.scheduled[0].args)).toMatchObject({ hints: 500, deferred: 0 });
    expect(h.hints()).toEqual([]);
    expect(h.calls.some((c) => c.name === 'rebuildStage')).toBe(false);
    expect(h.scheduled.filter((s) => s.name === 'views:rebuildStage')).toEqual([]);
  });

  it('pages past a full page of hints whose builds keep failing, so later ones are built (#215)', async () => {
    const failing = Array.from({ length: 3500 }, (_, i) => ({ ...hint('nat', nat(`Broken ${i}`)), retry: true }));
    const h = harness(
      { view_hints: [...failing, hint('table', 'records')] },
      builders({ buildNat: () => { throw new Error('still broken'); } }),
    );
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(await refresh(h)).toMatchObject({ hints: 3500, handled: 0, more: 1 });
    expect(h.called('buildReferenceTables')).toHaveLength(0);
    const next = h.scheduled.find((s) => s.name === 'views:refresh' && s.args.after !== undefined)!;
    expect(next).toBeDefined();
    expect(await handlerOf(views.refresh)(h.ctx, next.args)).toMatchObject({ hints: 1, failed: 0 });
    error.mockRestore();
    expect(h.called('buildReferenceTables')).toHaveLength(1);
    expect(h.hints()).toHaveLength(3500);
    expect(h.hints()).not.toContain('table:records');
  });

  it('waits for a running rebuild, keeping the hints for after it', async () => {
    const h = harness(
      {
        view_hints: [hint('meet', 'Known Meet')],
        view_state: [{ name: 'refresh', scheduled: false, baseline: [], rebuilding: true, rebuildHeartbeat: Date.now() }],
      },
      builders(),
    );
    expect(await refresh(h)).toEqual({ waiting: 1 });
    expect(h.called('buildMeet')).toEqual([]);
    expect(h.hints()).toEqual(['meet:Known Meet']);
  });

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

  it('keeps a hint a write renewed while its view was being built', async () => {
    const h: ReturnType<typeof harness> = harness(
      { view_hints: [hint('nat', nat('Open')), hint('nat', nat('Youth'))] },
      builders({
        // A result written mid-build: the write bumps the hint's `seq`.
        buildNat: async ({ ageCategory }) => {
          const row = h.fake.docs('view_hints').find((r) => r.key === nat('Open'));
          if (ageCategory === 'Open' && row) await h.fake.db.patch(row._id, { seq: 1, updatedAt: 2 });
          return 1;
        },
      }),
    );
    await refresh(h);
    expect(h.hints()).toEqual([`nat:${nat('Open')}`]);
  });

  it('retries a rebuild’s failed builds in a targeted refresh, however many, and alerts until they succeed', async () => {
    const failed = Array.from({ length: 2001 }, (_, i) => ({ ...hint('nat', nat(`Class ${i}`)), retry: true }));
    const h = harness(
      { view_hints: failed, view_state: [{ name: 'refresh', scheduled: false, baseline: [], rebuildFailures: 3 }] },
      builders({ buildNat: ({ ageCategory }) => { if (ageCategory === 'Class 0') throw new Error('still broken'); return 1; } }),
    );
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(handlerOf(views.refreshJob)(h.ctx, {})).rejects.toThrow('the last full rebuild could not build 3 group(s)');
    expect(h.called('buildNat')).toHaveLength(2001);
    expect(h.scheduled.some((s) => s.name === 'views:rebuildStage')).toBe(false);
    expect(h.hints()).toEqual([`nat:${nat('Class 0')}`]);
    // Once it builds, the alert clears.
    const ok = harness({ view_hints: h.fake.rows('view_hints'), view_state: h.fake.rows('view_state') }, builders());
    await handlerOf(views.refreshJob)(ok.ctx, {});
    error.mockRestore();
    expect(ok.fake.rows('view_state')[0].rebuildFailures).toBeUndefined();
  });

  it('only fails the hourly job when a build failed', async () => {
    const h = harness({ view_hints: [hint('nat', nat('Open'))] }, builders({ buildNat: () => { throw new Error('boom'); } }));
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(handlerOf(views.refreshJob)(h.ctx, {})).rejects.toThrow('1 view build(s) failed');
    error.mockRestore();
  });
});

describe('full rebuild', () => {
  it('prunes the histories of names gone from the directory', async () => {
    const h = harness(
      { athlete_summary: ['ann lee', 'bo kim', 'gone athlete'].map((nameKey) => ({ nameKey })) },
      builders({ textViewAnyAge: () => 'Ann Lee\nBo Kim', buildHistories: () => 0 }),
    );
    expect(await handlerOf(views.rebuildStage)(h.ctx, { stage: 'prune', offset: 0, again: false, startedAt: 5 })).toBe('prune -> nat@0');
    expect(h.called('buildHistories')).toEqual([{ keys: ['gone athlete'] }]);
    expect(h.scheduled.map((s) => s.args.stage)).toEqual(['nat']);
  });

  it('sweeps only hints last written before the rebuild began', async () => {
    const h = harness({
      view_hints: [
        { kind: 'meet', key: 'old', seq: 0, updatedAt: 500 },
        { kind: 'meet', key: 'new', seq: 0, updatedAt: 1500 },
        { kind: 'meet', key: 'legacy', seq: 0 },
      ],
    });
    expect(await handlerOf(views.deleteHintsUpdatedBefore)(h.ctx, { before: 1000 })).toBe(1);
    expect(h.hints()).toEqual(['meet:legacy', 'meet:new']);
  });

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

  it('counts the builds a rebuild left pending', async () => {
    const h = harness({ view_state: [{ name: 'refresh', scheduled: false, baseline: [] }] }, builders({ buildNat: () => { throw new Error('boom'); } }));
    await writeView(h.ctx as never, 'rebuild|classes', jsonChunks([nat('Open'), nat('Youth')]), []);
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    await handlerOf(views.rebuildStage)(h.ctx, { stage: 'nat', offset: 0, again: false, startedAt: 5 });
    error.mockRestore();
    expect(h.fake.rows('view_state')[0].rebuildFailures).toBe(2);
    expect(h.fake.rows('view_hints').every((row) => row.retry === true)).toBe(true);
  });

  it('sweeps large orphans a few at a time, within a transaction’s read limit', async () => {
    const orphans = Array.from({ length: 7 }, (_, i) => ({ key: natKey('USAW', `Gone ${i}`), etag: 'e', chunk_count: 5, built_at: 10, sources: STAMP }));
    const h = harness({ views: orphans });
    const first = (await handlerOf(views.sweepViewsPage)(h.ctx, { after: '', before: 100 })) as { after: string | null; deleted: number };
    expect(first).toEqual({ after: natKey('USAW', 'Gone 0'), deleted: 1 });
    await handlerOf(views.rebuildStage)(h.ctx, { stage: 'sweep', offset: 0, again: false, startedAt: 100 });
    expect(h.fake.rows('views')).toEqual([]);
  });

  it('finishes a rebuild scheduled before the sweep existed by consuming the hints it read', async () => {
    const h = harness({ view_hints: [hint('meet', 'Read Then'), hint('meet', 'Written Later')] });
    const [readThen] = h.fake.docs('view_hints');
    await handlerOf(views.rebuildStage)(h.ctx, { stage: 'sweep', offset: 0, again: false, hints: [{ id: readThen._id, seq: 0 }], versions: [] });
    expect(h.hints()).toEqual(['meet:Written Later']);
    expect(h.scheduled.map((s) => s.name)).toEqual(['views:refresh']);
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

describe('search shards after a change to the fold (#348)', () => {
  const NAMES = ["Brandyn O'Neal", 'Colin O\u2019Neal', 'Nick  Eudy'];

  /** The directory, with shards and a size table built under the old fold (curly apostrophes not folded). */
  async function oldShards(h: ReturnType<typeof harness>) {
    const ctx = h.ctx as never;
    await writeView(ctx, RESULT_NAMES_VIEW, textChunks(NAMES.join('\n')), [], { text: true });
    await writeView(ctx, searchShardKey("o'"), textChunks("Brandyn O'Neal"), [], { text: true });
    await writeView(ctx, searchShardKey("'n"), textChunks("Brandyn O'Neal"), [], { text: true });
    await writeView(ctx, LEGACY_SEARCH_SHARD_SIZES_VIEWS[0], jsonChunks([["o'", 1], ["'n", 1]]), []);
  }

  it('reads the whole directory, not old shards, until the new size table is built', async () => {
    const h = harness({}, builders());
    await oldShards(h);
    const answer = (await handlerOf(search)(h.ctx, { query: "O'Neal" })) as { suggestions: string[] };
    expect(answer.suggestions).toEqual(["Brandyn O'Neal", 'Colin O\u2019Neal']);
  });

  it('never starts a size table from a patch, and the hourly job builds the shards', async () => {
    const h = harness({}, builders());
    await oldShards(h);
    await handlerOf(views.patchSearchShards)(h.ctx, { bigrams: ['ni'], added: ['Nick  Eudy'], removed: [] });
    expect(await readViewJsonAnyAge(h.ctx as never, SEARCH_SHARD_SIZES_VIEW)).toBeNull();

    expect(await handlerOf(views.refreshJob)(h.ctx, {})).toMatchObject({ searchShards: 3 });
    expect(await readViewJsonAnyAge(h.ctx as never, SEARCH_SHARD_SIZES_VIEW)).not.toBeNull();
    expect(await readViewJsonAnyAge(h.ctx as never, LEGACY_SEARCH_SHARD_SIZES_VIEWS[0])).toBeNull();
    expect(await readViewTextAnyAge(h.ctx as never, searchShardKey("o'"))).toBe("Brandyn O'Neal\nColin O\u2019Neal");
    const answer = (await handlerOf(search)(h.ctx, { query: 'Colin O\u2019Neal' })) as { suggestions: string[] };
    expect(answer.suggestions).toEqual(['Colin O\u2019Neal']);
  });
});

