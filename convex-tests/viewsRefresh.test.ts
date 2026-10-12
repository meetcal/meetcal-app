import { getFunctionName } from 'convex/server';
import { fakeMutationCtx, handlerOf } from './fakeDb';
import { deleteHintsUpdatedBefore, finishRefresh, rebuildStage, refresh } from '../convex/views';
import { ADAPTIVE_RECORDS_SEASON_START } from '../convex/lib/referenceData';
import { adaptiveKey, MEET_VIEW_PARTS, meetKey, natKey, REF_VIEWS } from '../convex/lib/viewKeys';

// The refresh decides which views a batch of writes can have changed (#139):
// a view it does not rebuild it restamps as fresh, so a hint that reaches no
// builder would leave a stale view served as fresh.

type Call = { name: string; args: Record<string, unknown> };

/** An action context whose `run*` calls answer from `answers` by function name and are recorded in order. */
function fakeActionCtx(answers: Record<string, unknown | ((args: Record<string, unknown>) => unknown)>) {
  const calls: Call[] = [];
  const scheduled: Call[] = [];
  const run = async (fn: unknown, args: Record<string, unknown> = {}) => {
    const name = getFunctionName(fn as never);
    calls.push({ name, args });
    const answer = answers[name];
    return typeof answer === 'function' ? (answer as (args: Record<string, unknown>) => unknown)(args) : answer;
  };
  const scheduler = {
    runAfter: async (_delayMs: number, fn: unknown, args: Record<string, unknown>) => {
      scheduled.push({ name: getFunctionName(fn as never), args });
    },
  };
  const named = (name: string) => calls.filter((call) => call.name === name).map((call) => call.args);
  return { ctx: { runQuery: run, runMutation: run, runAction: run, scheduler }, calls, scheduled, named };
}

const versions = [
  { table: 'lifting_results', version: 7 },
  { table: 'athletes', version: 3 },
];

function begin(hints: { kind: string; key: string }[], extra: Record<string, unknown> = {}) {
  return {
    hints: hints.map((hint, i) => ({ id: `view_hints:${i}`, seq: 0, ...hint })),
    overflow: false,
    versions,
    baseline: versions,
    rebuilding: false,
    rebuildHeartbeat: null,
    lease: 1,
    busy: false,
    ...extra,
  };
}

const refreshAnswers = (start: ReturnType<typeof begin>) => ({
  'views:beginRefresh': start,
  'views:meetNames': ['Known Meet', 'Roster Meet', 'Quiet Meet'],
  'views:viewKeysWithPrefix': ({ prefix }: Record<string, unknown>) => (prefix === 'meet|Known Meet|session|' ? ['meet|Known Meet|session|1'] : []),
  'views:meetsListingAny': ({ meets }: Record<string, unknown>) => (meets as string[]).filter((meet) => meet === 'Roster Meet'),
  'views:statsBuildPlan': { sources: [], wanted: [] },
  'views:viewKeys': [REF_VIEWS.wso_list, 'wso|Florida', REF_VIEWS.records, meetKey('Quiet Meet', 'stats')],
  'views:pendingShardChanges': [],
  'views:finishRefresh': 0,
});

describe('refresh: each hint reaches the builder of every view it can change', () => {
  const run = handlerOf<Record<string, never>, Record<string, number>>(refresh);

  it('rebuilds, and leaves out of the restamp, exactly the views the hints name', async () => {
    const start = begin([
      { kind: 'nat', key: '["USAW","Open"]' },
      { kind: 'meet', key: 'Known Meet' },
      { kind: 'meet', key: 'Results Only Meet' },
      { kind: 'athlete', key: 'ann lee' },
      { kind: 'table', key: 'records' },
      { kind: 'table', key: 'athletes' },
      { kind: 'table', key: 'wso_records' },
      { kind: 'name', key: 'Ann Lee' },
    ]);
    const { ctx, named } = fakeActionCtx(refreshAnswers(start));
    await run(ctx, {});

    expect(named('views:buildNat')).toEqual([{ federation: 'USAW', ageCategory: 'Open' }]);
    expect(named('views:buildMeet')).toEqual([{ meet: 'Known Meet' }]);
    // A meet with neither a meet row nor a roster: its views are deleted, not left to be restamped.
    expect(named('views:deleteMeetViews')).toEqual([{ meets: ['Results Only Meet'] }]);
    // The athlete's results feed the year bests and stats of every meet whose roster lists them.
    expect(named('views:buildMeetTimelines').map((a) => a.meet).sort()).toEqual(['Known Meet', 'Roster Meet']);
    expect(named('views:buildMeetStats').map((a) => a.meet).sort()).toEqual(['Known Meet', 'Roster Meet']);
    expect(named('views:buildReferenceTables')).toHaveLength(1);
    expect(named('views:buildClubs')).toHaveLength(1);
    expect(named('views:buildWso')).toHaveLength(1);
    expect(named('views:syncResultNames')).toEqual([{ names: ['Ann Lee'] }]);

    const [finish] = named('views:finishRefresh');
    expect(finish.restamp).toBe(true);
    expect(finish.versions).toEqual(versions);
    expect(finish.hints).toEqual(start.hints.map(({ id, seq }) => ({ id, seq })));
    expect(new Set(finish.rebuilt as string[])).toEqual(
      new Set([
        natKey('USAW', 'Open'),
        ...MEET_VIEW_PARTS.map((part) => meetKey('Known Meet', part)),
        'meet|Known Meet|session|1',
        meetKey('Roster Meet', 'timelines'),
        meetKey('Roster Meet', 'stats'),
        REF_VIEWS.records,
        REF_VIEWS.standards,
        REF_VIEWS.qualifying_totals,
        REF_VIEWS.intl_rankings,
        adaptiveKey('men', 'BWL', ADAPTIVE_RECORDS_SEASON_START),
        adaptiveKey('women', 'BWL', ADAPTIVE_RECORDS_SEASON_START),
        REF_VIEWS.clubs,
        REF_VIEWS.wso_list,
        'wso|Florida',
      ]),
    );
    // A meet no hint touched is restamped, not rebuilt.
    expect(finish.rebuilt).not.toContain(meetKey('Quiet Meet', 'stats'));
    expect(named('views:releaseRefresh')).toEqual([{ lease: 1 }]);
  });

  it('rebuilds the reference tables for an adaptive result', async () => {
    const { ctx, named } = fakeActionCtx(refreshAnswers(begin([{ kind: 'adaptive', key: '1' }])));
    await run(ctx, {});
    expect(named('views:buildReferenceTables')).toHaveLength(1);
    expect(named('views:finishRefresh')[0].rebuilt).toContain(adaptiveKey('women', 'BWL', ADAPTIVE_RECORDS_SEASON_START));
  });

  it('starts a full rebuild instead when the hints overflow, and restamps nothing', async () => {
    const { ctx, named, scheduled } = fakeActionCtx(refreshAnswers(begin([{ kind: 'meet', key: 'Known Meet' }], { overflow: true })));
    expect(await run(ctx, {})).toEqual({ full: 1 });
    expect(named('views:buildMeet')).toEqual([]);
    expect(named('views:finishRefresh')).toEqual([]);
    expect(named('views:setRebuilding')).toEqual([{ rebuilding: true, restarted: false }]);
    expect(scheduled.map((s) => [s.name, s.args.stage])).toEqual([['views:rebuildStage', 'scan']]);
  });

  it('waits for a running rebuild, and restarts one that stopped beating', async () => {
    const alive = fakeActionCtx(refreshAnswers(begin([{ kind: 'meet', key: 'Known Meet' }], { rebuilding: true, rebuildHeartbeat: Date.now() })));
    expect(await run(alive.ctx, {})).toEqual({ waiting: 1 });
    expect(alive.named('views:finishRefresh')).toEqual([]);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const stopped = fakeActionCtx(refreshAnswers(begin([], { rebuilding: true, rebuildHeartbeat: Date.now() - 60 * 60 * 1000 })));
    expect(await run(stopped.ctx, {})).toEqual({ restarted: 1 });
    expect(stopped.named('views:setRebuilding')).toEqual([{ rebuilding: true, restarted: true }]);
    jest.restoreAllMocks();
  });
});

describe('finishRefresh: restamp safety', () => {
  const finish = handlerOf<{ hints: { id: string; seq: number }[]; versions: typeof versions; rebuilt: string[]; restamp: boolean }, number>(finishRefresh);
  const view = (key: string, sources: { table: string; version: number }[] | undefined) => ({ key, etag: 'e', chunk_count: 1, built_at: 1, sources });
  const baseline = [
    { table: 'lifting_results', version: 5 },
    { table: 'athletes', version: 3 },
  ];

  function seed() {
    return fakeMutationCtx({
      view_state: [{ name: 'refresh', scheduled: false, baseline }],
      views: [
        view('untouched', [{ table: 'lifting_results', version: 5 }]),
        view('rebuilt', [{ table: 'lifting_results', version: 6 }]),
        view('stale', [{ table: 'lifting_results', version: 4 }]),
        view('unversioned', undefined),
      ],
      view_hints: [
        { kind: 'meet', key: 'A', seq: 0, updatedAt: 1 },
        { kind: 'meet', key: 'B', seq: 2, updatedAt: 1 },
      ],
    });
  }

  it('restamps only views neither rebuilt nor older than the baseline, and keeps a hint written again since it was read', async () => {
    const store = seed();
    const hints = store.docs('view_hints').map((h) => ({ id: h._id, seq: 0 }));
    expect(await finish(store.ctx, { hints, versions, rebuilt: ['rebuilt'], restamp: true })).toBe(1);
    const stamps = Object.fromEntries(store.rows('views').map((v) => [v.key, v.sources]));
    expect(stamps).toEqual({
      untouched: [{ table: 'lifting_results', version: 7 }],
      rebuilt: [{ table: 'lifting_results', version: 6 }],
      // Built before the baseline: a write it missed may have left no hint
      // this refresh saw, so it stays stale until rebuilt.
      stale: [{ table: 'lifting_results', version: 4 }],
      unversioned: undefined,
    });
    expect(store.rows('view_hints').map((h) => h.key)).toEqual(['B']);
    expect(store.rows('view_state')[0].baseline).toEqual(versions);
  });

  it('restamps nothing for a full rebuild', async () => {
    const store = seed();
    expect(await finish(store.ctx, { hints: [], versions, rebuilt: [], restamp: false })).toBe(0);
    expect(store.rows('views').find((v) => v.key === 'untouched')?.sources).toEqual([{ table: 'lifting_results', version: 5 }]);
  });
});

describe('rebuildAll cleanup', () => {
  const stage = handlerOf<Record<string, unknown>, string>(rebuildStage);
  const stageArgs = (extra: Record<string, unknown>) => ({ offset: 0, hints: [{ id: 'view_hints:1', seq: 0 }], versions, again: true, startedAt: 1000, ...extra });

  it('ends by consuming the hints it covered, every older one, and its running flag, then refreshes for what came meanwhile', async () => {
    let sweeps = 0;
    const { ctx, named, calls, scheduled } = fakeActionCtx({
      'views:deleteHintsUpdatedBefore': () => (++sweeps < 3 ? 1000 : 10),
    });
    expect(await stage(ctx, stageArgs({ stage: 'reference' }))).toBe('done');
    expect(named('views:buildReferenceTables')).toHaveLength(1);
    expect(named('views:buildClubs')).toHaveLength(1);
    expect(named('views:buildWso')).toHaveLength(1);
    expect(named('views:finishRefresh')).toEqual([{ hints: [{ id: 'view_hints:1', seq: 0 }], versions, rebuilt: [], restamp: false }]);
    expect(named('views:deleteHintsUpdatedBefore')).toEqual([{ before: 1000 }, { before: 1000 }, { before: 1000 }]);
    expect(calls.at(-1)).toEqual({ name: 'views:setRebuilding', args: { rebuilding: false } });
    expect(scheduled.map((s) => s.name)).toEqual(['views:refresh']);
  });

  it('prunes the histories of names gone from the directory', async () => {
    const { ctx, named, scheduled } = fakeActionCtx({
      'views:textViewAnyAge': 'Ann Lee\nBo Kim',
      'views:summaryKeysAfter': ['ann lee', 'bo kim', 'gone athlete'],
    });
    expect(await stage(ctx, stageArgs({ stage: 'prune' }))).toBe('prune -> nat@0');
    expect(named('views:buildHistories')).toEqual([{ keys: ['gone athlete'] }]);
    expect(scheduled.map((s) => s.args.stage)).toEqual(['nat']);
  });

  it('sweeps only hints last written before the rebuild began', async () => {
    const store = fakeMutationCtx({
      view_hints: [
        { kind: 'meet', key: 'old', seq: 0, updatedAt: 500 },
        { kind: 'meet', key: 'new', seq: 0, updatedAt: 1500 },
        { kind: 'meet', key: 'legacy', seq: 0 },
      ],
    });
    expect(await handlerOf<{ before: number }, number>(deleteHintsUpdatedBefore)(store.ctx, { before: 1000 })).toBe(1);
    expect(store.rows('view_hints').map((h) => h.key)).toEqual(['new', 'legacy']);
  });
});
