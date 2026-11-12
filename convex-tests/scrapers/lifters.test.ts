import { itemAt } from '../../convex/lib/json';
import { getFunctionName } from 'convex/server';
import { describeFailure } from '../../convex/lib/cronAlerts';
import {
  backfill,
  BACKFILL_ATTEMPTS,
  BACKFILL_CLASSES_PER_RUN,
  BACKFILL_RUN_BUDGET_MS,
  IN_FLIGHT_WRITE_MS,
  NAMES_PER_LINK,
  SIGHTINGS_PER_STORE,
  byAthleteBatches,
  NIGHTLY_LINK_BUDGET_MS,
  NIGHTLY_READ_BUDGET_MS,
  BACKFILL_RETRY_DELAY_MS,
  classesOfResults,
  rankingsWindows,
  run,
  SPORT80_CONCURRENCY,
} from '../../convex/scrapers/lifters';
import { Sport80, Sport80HttpError } from '../../convex/scrapers/lib/sport80Api';
import { handlerOf } from '../fakeDb';

type Dict = Record<string, unknown>;

const mockApi = {
  rankingsTable: jest.fn(async (): Promise<Dict> => ({ filters: [{ name: 'weight_class', items: mockClassItems }] })),
  rankings: jest.fn(async (_classId: number, _from: string, _to: string): Promise<Dict[]> => []),
  athleteResults: jest.fn(async (_athleteId: string): Promise<Dict[]> => []),
};

let mockClassItems: { text: string; value: number }[] = [];

jest.mock('../../convex/scrapers/lib/sport80Api', () => ({
  ...jest.requireActual('../../convex/scrapers/lib/sport80Api'),
  Sport80: { connect: jest.fn(async () => mockApi) },
}));

const rankingRow = (athleteId: string, extra: Dict = {}): Dict => ({
  name: 'Taylor Johnson',
  gender: 'M',
  lifter_age: 27,
  club: { type: 'unset' },
  membership: `m${athleteId}`,
  lift_date: '2026-10-20',
  wso: 'Tennessee-Kentucky',
  action: [{ route: `/public/rankings/member/${athleteId}/category/1` }],
  ...extra,
});

const historyRow = (extra: Dict = {}): Dict => ({
  meet: 'Kentucky Open',
  date: '2026-10-20',
  age_category: "Open Men's 95kg",
  lifter: 'Taylor Johnson',
  best_snatch: 100,
  'best_c&j': 130,
  total: 230,
  ...extra,
});

type Call = { name: string; args: Dict; delay?: number };

function fakeCtx(
  answers: { unlinked?: Dict[]; queued?: string[]; lifters?: { nameKey: string; athleteIds: string[]; sport80Results?: boolean }[]; names?: Dict; lastComplete?: number } = {},
) {
  const mutations: Call[] = [];
  const completes: number[] = [];
  const scheduled: Call[] = [];
  const ctx = {
    runQuery: jest.fn(async (ref: unknown, args: Dict) => {
      const name = getFunctionName(ref as never);
      if (name === 'lifters:unlinkedResultsPage') return { rows: answers.unlinked ?? [], cursor: 'end', isDone: true };
      if (name === 'lifters:liftersByName') {
        const known = answers.lifters ?? ((answers.names?.names ?? []) as { nameKey: string; athleteIds: string[] }[]);
        return known.filter((l) => (args.nameKeys as string[]).includes(l.nameKey)).map((l) => ({ sport80Results: true, ...l }));
      }
      if (name === 'lifters:lifterNamesPage') {
        const page = answers.names ?? { names: [], done: true };
        return { ...page, names: (page.names as { nameKey: string }[]).map((n) => n.nameKey) };
      }
      if (name === 'lifters:queuedRelinks') return answers.queued ?? [];
      if (name === 'lifters:lastCompleteRun') return answers.lastComplete ?? null;
      throw new Error(`unexpected query ${name}`);
    }),
    runMutation: jest.fn(async (ref: unknown, args: Dict) => {
      const name = getFunctionName(ref as never);
      if (name === 'lifters:recordCompleteRun') {
        completes.push(args.startedAt as number);
        return null;
      }
      mutations.push({ name, args });
      if (name === 'ingest:upsertLifters') return { inserted: 2, updated: 0, unchanged: 0, changedKeys: ['taylor johnson'] };
      if (name === 'ingest:linkLifterResults') return { history: 1, fit: 0, unlinked: 0, changed: 1, stale: [] };
      if (name === 'ingest:queueLifterRelinks') return null;
      throw new Error(`unexpected mutation ${name}`);
    }),
    scheduler: {
      runAfter: jest.fn(async (delay: number, ref: unknown, args: Dict) => {
        scheduled.push({ name: getFunctionName(ref as never), args, delay });
      }),
    },
  };
  return { ctx, mutations, scheduled, completes };
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.mocked(Sport80.connect).mockClear();
  mockClassItems = [
    { text: "Open Men's 95kg", value: 939 },
    { text: "Open Women's 71kg", value: 940 },
  ];
  mockApi.rankings.mockReset().mockResolvedValue([]);
  mockApi.athleteResults.mockReset().mockResolvedValue([]);
});
afterEach(() => jest.restoreAllMocks());

describe('the nightly lifter links', () => {
  const unlinked = [{ nameKey: 'taylor johnson', age: "Open Men's 95kg", date: '2026-10-20', federation: 'USAW', storedAt: 1 }];

  it('reads the rankings of the classes recent unlinked results are in, stores the lifters, and links the name with each lifter’s history', async () => {
    mockApi.rankings.mockResolvedValue([rankingRow('1'), rankingRow('2', { lifter_age: 50 })]);
    mockApi.athleteResults.mockImplementation(async (id: string) => (id === '1' ? [historyRow()] : []));
    const { ctx, mutations } = fakeCtx({ unlinked, lifters: [{ nameKey: 'taylor johnson', athleteIds: ['1', '2'] }] });
    const answer = await handlerOf<{ dryRun?: boolean }, Dict>(run)(ctx, {});

    expect(mockApi.rankings).toHaveBeenCalledTimes(1);
    expect(itemAt(itemAt(mockApi.rankings.mock.calls, 0), 0)).toBe(939);
    const stored = mutations.find((m) => m.name === 'ingest:upsertLifters')!.args.sightings as Dict[];
    expect(stored.map((s) => [s.athleteId, s.birthYear])).toEqual([
      ['1', 1999],
      ['2', 1976],
    ]);
    const linked = mutations.find((m) => m.name === 'ingest:linkLifterResults')!.args as { names: { nameKey: string; histories: { athleteId: string; results: Dict[] }[] }[] };
    expect(linked.names).toEqual([
      {
        nameKey: 'taylor johnson',
        histories: [
          { athleteId: '1', results: [{ date: '2026-10-20', meet: 'Kentucky Open', age: "Open Men's 95kg", total: 230, snatchBest: 100, cjBest: 130 }] },
          { athleteId: '2', results: [] },
        ],
      },
    ]);
    expect(answer).toMatchObject({ unlinked: 1, classes: 1, names: 1, links: { history: 1 } });
  });

  it('leaves a name whose class could not be read for the next run, links the rest, then fails naming the class', async () => {
    mockClassItems = [...mockClassItems, { text: "Open Men's 95kg", value: 1939 }];
    mockApi.rankings.mockImplementation(async (classId: number) => {
      if (classId === 1939) throw new Error('POST /api/categories/all/rankings/table/data failed with 502');
      return [rankingRow('1')];
    });
    const { ctx, mutations } = fakeCtx({
      unlinked: [...unlinked, { nameKey: 'ann lee', age: "Open Women's 71kg", date: '2026-10-20', federation: 'USAW', storedAt: 1 }],
      queued: ['taylor johnson'],
      lifters: [
        { nameKey: 'taylor johnson', athleteIds: ['1'] },
        { nameKey: 'ann lee', athleteIds: ['3'] },
      ],
    });
    const failure = await handlerOf<{ dryRun?: boolean }, Dict>(run)(ctx, {}).catch((error: unknown) => error);
    expect(mutations.map((m) => [m.name, (m.args.names as Dict[] | undefined)?.map((n) => n.nameKey)])).toEqual([
      ['ingest:upsertLifters', undefined],
      ['ingest:linkLifterResults', ['ann lee']],
    ]);
    expect(describeFailure(failure).failedSources).toEqual(["rankings Open Men's 95kg (class 1939)"]);
  });

  it('does not reach Sport80 when every recent result is linked', async () => {
    const { ctx, mutations } = fakeCtx();
    expect(await handlerOf<{ dryRun?: boolean }, Dict>(run)(ctx, {})).toMatchObject({ unlinked: 0 });
    expect(mockApi.rankings).not.toHaveBeenCalled();
    expect(mutations).toEqual([]);
  });

  it('relinks other federations’ new results by fit, without reading any rankings for them', async () => {
    const { ctx, mutations } = fakeCtx({
      unlinked: [{ nameKey: 'sara rubin', age: "Women's Masters (40-44) 64kg", date: '2025-03-26', federation: 'USAMW', storedAt: 1 }],
      lifters: [{ nameKey: 'sara rubin', athleteIds: ['11207'] }],
    });
    await handlerOf<{ dryRun?: boolean }, Dict>(run)(ctx, {});
    expect(mockApi.rankings).not.toHaveBeenCalled();
    expect(mutations.map((m) => m.name)).toEqual(['ingest:linkLifterResults']);
    expect((itemAt(mutations, 0).args.names as Dict[]).map((n) => n.nameKey)).toEqual(['sara rubin']);
  });

  it('asks for the unlinked results stored in the last days, whatever their meet date', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 10, 11));
    const { ctx } = fakeCtx();
    await handlerOf<{ dryRun?: boolean }, Dict>(run)(ctx, {});
    expect(ctx.runQuery.mock.calls.find((call) => getFunctionName(call[0] as never) === 'lifters:unlinkedResultsPage')![1]).toEqual({ insertedSince: Date.UTC(2026, 10, 1), cursor: null });
  });

  it('relinks the names queued by an earlier run whose relink failed, even when nothing new was stored', async () => {
    const { ctx, mutations } = fakeCtx({ queued: ['taylor johnson'], lifters: [{ nameKey: 'taylor johnson', athleteIds: ['1', '2'] }] });
    mockApi.athleteResults.mockResolvedValue([historyRow()]);
    const answer = await handlerOf<{ dryRun?: boolean }, Dict>(run)(ctx, {});
    expect(mockApi.rankings).not.toHaveBeenCalled();
    expect(mutations.map((m) => m.name)).toEqual(['ingest:linkLifterResults']);
    expect(answer).toMatchObject({ unlinked: 0, queued: 1, names: 1 });
  });

  it('relinks a name left with no lifter, so its rows lose links to a lifter who moved to another name', async () => {
    const { ctx, mutations } = fakeCtx({ queued: ['old name'], lifters: [{ nameKey: 'old name', athleteIds: [] }] });
    await handlerOf<{ dryRun?: boolean }, Dict>(run)(ctx, {});
    expect(mutations).toEqual([{ name: 'ingest:linkLifterResults', args: { names: [{ nameKey: 'old name' }], dryRun: false } }]);
  });

  it('fails a name whose Sport80 history came back with rows it cannot read, rather than link it by fit alone', async () => {
    mockApi.athleteResults.mockResolvedValue([{ meet: 'Kentucky Open', date: '2026-10-20', athlete_name: 'Taylor Johnson', total: 230 }]);
    const { ctx, mutations } = fakeCtx({ queued: ['taylor johnson'], lifters: [{ nameKey: 'taylor johnson', athleteIds: ['1', '2'] }] });
    const failure = await handlerOf<{ dryRun?: boolean }, Dict>(run)(ctx, {}).catch((error: unknown) => error);
    expect(mutations).toEqual([{ name: 'ingest:queueLifterRelinks', args: { nameKeys: ['taylor johnson'] } }]);
    expect(describeFailure(failure).failedSources).toEqual(['history of taylor johnson (athlete 1)']);
    expect(String(failure)).toContain('none of its 1 history rows readable');
  });

  it('links a name whose lifter Sport80 no longer has, by fit alone for that lifter, instead of failing it every night', async () => {
    mockApi.athleteResults.mockImplementation(async (id: string) => {
      if (id === '2') throw new Sport80HttpError('POST', '/api/athletes/2/table/data', 404);
      return [historyRow()];
    });
    const { ctx, mutations } = fakeCtx({ queued: ['taylor johnson'], lifters: [{ nameKey: 'taylor johnson', athleteIds: ['1', '2'] }] });
    await handlerOf<{ dryRun?: boolean }, Dict>(run)(ctx, {});
    const linked = mutations.find((m) => m.name === 'ingest:linkLifterResults')!.args as { names: { histories: { athleteId: string; results: unknown[] }[] }[] };
    expect(itemAt(linked.names, 0).histories.map((h) => [h.athleteId, h.results.length])).toEqual([
      ['1', 1],
      ['2', 0],
    ]);
  });

  it('links only names with no USAW result while Sport80 is down, queues the rest, and leaves the new USAW results for the next run', async () => {
    jest.mocked(Sport80.connect).mockRejectedValueOnce(new Error('sport80: rankings page failed with 503'));
    const { ctx, mutations } = fakeCtx({
      unlinked: [...unlinked, { nameKey: 'sara rubin', age: "Women's Masters (40-44) 64kg", date: '2025-03-26', federation: 'USAMW', storedAt: 1 }],
      queued: ['ann lee', 'max ray'],
      lifters: [
        { nameKey: 'taylor johnson', athleteIds: ['1', '2'] },
        { nameKey: 'sara rubin', athleteIds: ['11207'], sport80Results: false },
        { nameKey: 'ann lee', athleteIds: ['3'] },
        { nameKey: 'max ray', athleteIds: ['4', '5'] },
      ],
    });
    const failure = await handlerOf<{ dryRun?: boolean }, Dict>(run)(ctx, {}).catch((error: unknown) => error);
    expect(mutations.map((m) => [m.name, (m.args.names as Dict[] | undefined)?.map((n) => n.nameKey) ?? m.args.nameKeys])).toEqual([
      ['ingest:linkLifterResults', ['sara rubin']],
      ['ingest:queueLifterRelinks', ['ann lee', 'max ray']],
    ]);
    expect(describeFailure(failure).failedSources).toEqual(['history of ann lee (athlete 3)', 'history of max ray (athlete 4)', 'rankings']);
  });

  it('fails a name whose every lifter Sport80 answers 404 for when no history answered, rather than drop its history links', async () => {
    mockApi.athleteResults.mockImplementation(async (id: string) => {
      throw new Sport80HttpError('POST', `/api/athletes/${id}/table/data`, 404);
    });
    const { ctx, mutations } = fakeCtx({ queued: ['taylor johnson'], lifters: [{ nameKey: 'taylor johnson', athleteIds: ['1', '2'] }] });
    const failure = await handlerOf<{ dryRun?: boolean }, Dict>(run)(ctx, {}).catch((error: unknown) => error);
    expect(mutations).toEqual([{ name: 'ingest:queueLifterRelinks', args: { nameKeys: ['taylor johnson'] } }]);
    expect(describeFailure(failure).failedSources).toEqual(['histories of taylor johnson']);
  });

  it('reads the window of the longest-stored results first, and fails naming the windows it had no time for, so they are read next run', async () => {
    let now = Date.UTC(2026, 10, 11);
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    mockApi.rankings.mockImplementation(async () => {
      now += NIGHTLY_READ_BUDGET_MS;
      return [rankingRow('1')];
    });
    const { ctx, mutations } = fakeCtx({
      unlinked: [
        { nameKey: 'early', age: "Open Men's 95kg", date: '2026-06-01', federation: 'USAW', storedAt: 20 },
        { nameKey: 'late', age: "Open Men's 95kg", date: '2026-10-20', federation: 'USAW', storedAt: 10 },
      ],
      lifters: [
        { nameKey: 'early', athleteIds: ['1'] },
        { nameKey: 'late', athleteIds: ['2'] },
      ],
    });
    const failure = await handlerOf<{ dryRun?: boolean }, Dict>(run)(ctx, {}).catch((error: unknown) => error);
    expect(mockApi.rankings).toHaveBeenCalledTimes(1);
    expect(mutations.map((m) => [m.name, (m.args.names as Dict[] | undefined)?.map((n) => n.nameKey)])).toEqual([
      ['ingest:upsertLifters', undefined],
      ['ingest:linkLifterResults', ['late']],
    ]);
    expect(String(failure)).toContain('1 of 2 date windows not read in time');
  });

  it('stops starting class reads once its time is spent, even within one window, leaving their results for the next run', async () => {
    let now = Date.UTC(2026, 10, 11);
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    mockClassItems = Array.from({ length: SPORT80_CONCURRENCY * 3 }, (_, i) => ({ text: `Open Men's ${i}kg`, value: i }));
    mockApi.rankings.mockImplementation(async () => {
      now += NIGHTLY_READ_BUDGET_MS;
      return [];
    });
    const unlinkedRows = mockClassItems.map((c, i) => ({ nameKey: `n${i}`, age: c.text, date: '2026-10-20', federation: 'USAW', storedAt: 1 }));
    const { ctx, mutations, completes } = fakeCtx({ unlinked: unlinkedRows, lifters: unlinkedRows.map((r) => ({ nameKey: r.nameKey, athleteIds: ['1'] })) });
    const failure = await handlerOf<{ dryRun?: boolean }, Dict>(run)(ctx, {}).catch((error: unknown) => error);
    const read = mockApi.rankings.mock.calls.map((call) => call[0]);
    expect(read.length).toBeLessThan(mockClassItems.length);
    const linked = mutations.filter((m) => m.name === 'ingest:linkLifterResults').flatMap((m) => (m.args.names as Dict[]).map((n) => n.nameKey));
    expect(linked.sort()).toEqual(read.map((id) => `n${id}`).sort());
    expect(completes).toEqual([]);
    expect(String(failure)).toContain('classes not read in time');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining(`, ${read.length} classes read,`));
  });

  it('leaves a USAW result in a division no rankings class is named for, and fails naming the division', async () => {
    const { ctx, mutations } = fakeCtx({
      unlinked: [{ nameKey: 'taylor johnson', age: 'Mystery Division', date: '2026-10-20', federation: 'USAW', storedAt: 1 }],
      lifters: [{ nameKey: 'taylor johnson', athleteIds: ['1'] }],
    });
    const failure = await handlerOf<{ dryRun?: boolean }, Dict>(run)(ctx, {}).catch((error: unknown) => error);
    expect(mutations).toEqual([]);
    expect(describeFailure(failure).failedSources).toEqual(['rankings class "Mystery Division"']);
  });

  it('links a name whose every lifter Sport80 answers 404 for once another history was read, so a removed lifter is not retried for ever', async () => {
    mockApi.athleteResults.mockImplementation(async (id: string) => {
      if (id === '1') return [historyRow()];
      throw new Sport80HttpError('POST', `/api/athletes/${id}/table/data`, 404);
    });
    const { ctx, mutations } = fakeCtx({
      queued: ['ann lee', 'taylor johnson'],
      lifters: [
        { nameKey: 'ann lee', athleteIds: ['1', '9'] },
        { nameKey: 'taylor johnson', athleteIds: ['2', '3'] },
      ],
    });
    await handlerOf<{ dryRun?: boolean }, Dict>(run)(ctx, {});
    const linked = mutations.find((m) => m.name === 'ingest:linkLifterResults')!.args.names as Dict[];
    expect(linked.map((n) => n.nameKey)).toEqual(['ann lee', 'taylor johnson']);
  });

  it('decides a name whose lifters all answer 404 after the run’s other histories, whatever order the answers come in', async () => {
    mockApi.athleteResults.mockImplementation(async (id: string) => {
      if (id === '1') return [historyRow()];
      throw new Sport80HttpError('POST', `/api/athletes/${id}/table/data`, 404);
    });
    const { ctx, mutations } = fakeCtx({
      queued: ['taylor johnson', 'ann lee'],
      lifters: [
        { nameKey: 'taylor johnson', athleteIds: ['2', '3'] },
        { nameKey: 'ann lee', athleteIds: ['9', '1'] },
      ],
    });
    await handlerOf<{ dryRun?: boolean }, Dict>(run)(ctx, {});
    const linked = mutations.filter((m) => m.name === 'ingest:linkLifterResults').flatMap((m) => (m.args.names as Dict[]).map((n) => n.nameKey));
    expect(linked.sort()).toEqual(['ann lee', 'taylor johnson']);
  });

  it('reads only the results stored since its last complete run, and records a run complete only when nothing failed', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 10, 11));
    const clean = fakeCtx({ lastComplete: Date.UTC(2026, 10, 10) });
    await handlerOf<{ dryRun?: boolean }, Dict>(run)(clean.ctx, {});
    expect(clean.ctx.runQuery.mock.calls.find((call) => getFunctionName(call[0] as never) === 'lifters:unlinkedResultsPage')![1]).toEqual({
      insertedSince: Date.UTC(2026, 10, 10) - IN_FLIGHT_WRITE_MS,
      cursor: null,
    });
    expect(clean.completes).toEqual([Date.UTC(2026, 10, 11)]);

    const dry = fakeCtx();
    await handlerOf<{ dryRun?: boolean }, Dict>(run)(dry.ctx, { dryRun: true });
    expect(dry.completes).toEqual([]);

    mockApi.rankings.mockRejectedValue(new Error('POST /api/categories/all/rankings/table/data failed with 502'));
    const failing = fakeCtx({ unlinked, lifters: [{ nameKey: 'taylor johnson', athleteIds: ['1'] }] });
    await handlerOf<{ dryRun?: boolean }, Dict>(run)(failing.ctx, {}).catch(() => undefined);
    expect(failing.completes).toEqual([]);
  });

  it('stops reading histories once its time is spent, even partway through a batch, and queues the names it did not reach', async () => {
    let now = Date.UTC(2026, 10, 11);
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    mockApi.athleteResults.mockImplementation(async () => {
      now += NIGHTLY_LINK_BUDGET_MS / 2;
      return [historyRow()];
    });
    const queued = ['a', 'b', 'c', 'd', 'e', 'f'];
    const { ctx, mutations } = fakeCtx({ queued, lifters: queued.map((nameKey, i) => ({ nameKey, athleteIds: [String(i)] })) });
    await handlerOf<{ dryRun?: boolean }, Dict>(run)(ctx, {});
    expect(mockApi.athleteResults.mock.calls.length).toBeLessThan(queued.length);
    const linked = mutations.filter((m) => m.name === 'ingest:linkLifterResults').flatMap((m) => (m.args.names as Dict[]).map((n) => n.nameKey));
    const requeued = mutations.filter((m) => m.name === 'ingest:queueLifterRelinks').flatMap((m) => m.args.nameKeys as string[]);
    expect([...linked, ...requeued].sort()).toEqual(queued);
    expect(requeued.length).toBeGreaterThan(0);
  });

  it('queues the names it has no time left to relink', async () => {
    let now = Date.UTC(2026, 10, 11);
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const queued = Array.from({ length: 60 }, (_, i) => `n${String(i).padStart(2, '0')}`);
    const { ctx, mutations } = fakeCtx({ queued, lifters: queued.map((nameKey) => ({ nameKey, athleteIds: ['1'] })) });
    ctx.runMutation.mockImplementation(async (ref: unknown, args: Dict) => {
      mutations.push({ name: getFunctionName(ref as never), args });
      now += NIGHTLY_LINK_BUDGET_MS;
      return { history: 0, fit: 1, unlinked: 0, changed: 1, stale: [] };
    });
    await handlerOf<{ dryRun?: boolean }, Dict>(run)(ctx, {});
    expect(mutations.map((m) => m.name)).toEqual(['ingest:linkLifterResults', 'ingest:queueLifterRelinks', 'lifters:recordCompleteRun']);
    expect(itemAt(mutations, 1).args.nameKeys).toEqual(queued.slice(NAMES_PER_LINK));
  });

  it('stores no lifter in a dry run, and asks for the links as a dry run', async () => {
    mockApi.rankings.mockResolvedValue([rankingRow('1')]);
    const { ctx, mutations } = fakeCtx({ unlinked, lifters: [{ nameKey: 'taylor johnson', athleteIds: ['1'] }] });
    await handlerOf<{ dryRun?: boolean }, Dict>(run)(ctx, { dryRun: true });
    expect(mutations.map((m) => [m.name, m.args.dryRun])).toEqual([['ingest:linkLifterResults', true]]);
  });
});

describe('the lifter backfill', () => {
  it('reads the rankings a slice of classes at a time, then moves to linking', async () => {
    mockClassItems = Array.from({ length: BACKFILL_CLASSES_PER_RUN + 1 }, (_, i) => ({ text: `Class ${i}`, value: i }));
    const { ctx, scheduled } = fakeCtx();
    await handlerOf<Dict, void>(backfill)(ctx, {});
    expect(mockApi.rankings).toHaveBeenCalledTimes(BACKFILL_CLASSES_PER_RUN);
    expect(scheduled).toEqual([{ name: 'scrapers/lifters:backfill', args: expect.objectContaining({ stage: 'rankings', offset: BACKFILL_CLASSES_PER_RUN }), delay: 0 }]);

    const last = fakeCtx();
    await handlerOf<Dict, void>(backfill)(last.ctx, { stage: 'rankings', offset: BACKFILL_CLASSES_PER_RUN });
    expect(last.scheduled).toEqual([{ name: 'scrapers/lifters:backfill', args: expect.objectContaining({ stage: 'link', after: '' }), delay: 0 }]);
  });

  it('stops starting classes once its time is spent, and carries on from the first one it did not read', async () => {
    mockClassItems = Array.from({ length: BACKFILL_CLASSES_PER_RUN }, (_, i) => ({ text: `Class ${i}`, value: i }));
    let now = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    mockApi.rankings.mockImplementation(async () => {
      now += BACKFILL_RUN_BUDGET_MS;
      return [];
    });
    const { ctx, scheduled } = fakeCtx();
    await handlerOf<Dict, void>(backfill)(ctx, {});
    expect(mockApi.rankings).toHaveBeenCalledTimes(SPORT80_CONCURRENCY);
    expect(itemAt(scheduled, 0).args).toMatchObject({ stage: 'rankings', offset: SPORT80_CONCURRENCY });
  });

  it('stops before linking when some classes could not be read, naming the arguments that read just those again', async () => {
    mockClassItems = [
      { text: 'Class 0', value: 0 },
      { text: 'Class 1', value: 1 },
    ];
    mockApi.rankings.mockImplementation(async (classId: number) => {
      if (classId === 1) throw new Error('The operation was aborted due to timeout');
      return [rankingRow('1')];
    });
    const { ctx, scheduled } = fakeCtx();
    const failure = await handlerOf<Dict, void>(backfill)(ctx, {}).catch((error: unknown) => error);
    expect(scheduled).toEqual([]);
    expect(String(failure)).toContain('stopped before linking');
    expect(String(failure)).toContain(JSON.stringify({ links: { history: 0, fit: 0, unlinked: 0, changed: 0 }, stage: 'rankings', classIds: [1] }));

    mockApi.rankings.mockReset().mockResolvedValue([rankingRow('2')]);
    const again = fakeCtx();
    await handlerOf<Dict, void>(backfill)(again.ctx, { stage: 'rankings', classIds: [1] });
    expect(mockApi.rankings.mock.calls.map((call) => call[0])).toEqual([1]);
    expect(itemAt(again.scheduled, 0).args).toMatchObject({ stage: 'link', after: '' });
  });

  it('links a page of names and carries on after the last one', async () => {
    const { ctx, scheduled, mutations } = fakeCtx({ names: { names: [{ nameKey: 'a', athleteIds: ['1'] }, { nameKey: 'b', athleteIds: ['2'] }], done: false } });
    await handlerOf<Dict, void>(backfill)(ctx, { stage: 'link', after: '' });
    expect(mutations.map((m) => m.name)).toEqual(['ingest:linkLifterResults']);
    expect(scheduled).toEqual([{ name: 'scrapers/lifters:backfill', args: expect.objectContaining({ stage: 'link', after: 'b', links: { history: 1, fit: 0, unlinked: 0, changed: 1 } }), delay: 0 }]);
  });

  it('stops linking once its time is spent, and carries on after the last name it linked', async () => {
    let now = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const names = Array.from({ length: 120 }, (_, i) => ({ nameKey: `n${String(i).padStart(3, '0')}`, athleteIds: ['1'] }));
    const { ctx, scheduled, mutations } = fakeCtx({ names: { names, done: true } });
    ctx.runMutation.mockImplementation(async () => {
      now += BACKFILL_RUN_BUDGET_MS;
      return { history: 0, fit: 1, unlinked: 0, changed: 1, stale: [] };
    });
    await handlerOf<Dict, void>(backfill)(ctx, { stage: 'link', after: '' });
    expect(ctx.runMutation).toHaveBeenCalledTimes(1);
    expect(mutations).toEqual([]);
    expect(itemAt(scheduled, 0).args).toMatchObject({ stage: 'link', after: `n${String(NAMES_PER_LINK - 1).padStart(3, '0')}` });
  });

  it('decides a page’s names whose lifters all answer 404 once the page’s other histories are read', async () => {
    mockApi.athleteResults.mockImplementation(async (id: string) => {
      if (id === '1') return [historyRow()];
      throw new Sport80HttpError('POST', `/api/athletes/${id}/table/data`, 404);
    });
    const names = [
      { nameKey: 'a', athleteIds: ['2', '3'] },
      { nameKey: 'b', athleteIds: ['1', '4'] },
    ];
    const { ctx, mutations } = fakeCtx({ names: { names, done: true } });
    await handlerOf<Dict, void>(backfill)(ctx, { stage: 'link', after: '' });
    const linked = mutations.filter((m) => m.name === 'ingest:linkLifterResults').flatMap((m) => (m.args.names as Dict[]).map((n) => n.nameKey));
    expect(linked.sort()).toEqual(['a', 'b']);
  });

  it('reads the history of a name with one lifter too, so a USAW result is linked only when that lifter’s history holds it', async () => {
    mockApi.athleteResults.mockResolvedValue([historyRow()]);
    const { ctx, mutations } = fakeCtx({ names: { names: [{ nameKey: 'a', athleteIds: ['1'] }], done: true } });
    await handlerOf<Dict, void>(backfill)(ctx, { stage: 'link', after: '' });
    expect(mockApi.athleteResults.mock.calls.map((call) => call[0])).toEqual(['1']);
    expect(itemAt(itemAt(mutations, 0).args.names as { histories: unknown[] }[], 0).histories).toHaveLength(1);
  });

  it('tries a failed run again a minute later, then stops naming the command that resumes it', async () => {
    const failing = () => {
      const fake = fakeCtx();
      fake.ctx.runQuery.mockRejectedValue(new Error('Convex is restarting'));
      return fake;
    };
    const args = { stage: 'link', after: 'k', links: { history: 3, fit: 1, unlinked: 0, changed: 4 }, failures: [{ source: 'x', error: 'y' }] };
    const first = failing();
    await handlerOf<Dict, void>(backfill)(first.ctx, args);
    expect(first.scheduled).toEqual([{ name: 'scrapers/lifters:backfill', args: { ...args, attempt: 2 }, delay: BACKFILL_RETRY_DELAY_MS }]);

    const last = failing();
    const failure = await handlerOf<Dict, void>(backfill)(last.ctx, { ...args, attempt: BACKFILL_ATTEMPTS }).catch((e: unknown) => e);
    expect(last.scheduled).toEqual([]);
    expect(String(failure)).toContain(`stopped after ${BACKFILL_ATTEMPTS} attempts: Convex is restarting`);
    expect(String(failure)).toContain(`with these arguments:\n${JSON.stringify(args)}`);
  });

  it('fails at the end naming the failures the stages carried', async () => {
    const { ctx } = fakeCtx({ names: { names: [], done: true } });
    const failure = await handlerOf<Dict, void>(backfill)(ctx, { stage: 'link', failures: [{ source: 'rankings X (class 1)', error: '502' }], failureCount: 1 }).catch((e: unknown) => e);
    expect(describeFailure(failure).failedSources).toEqual(['rankings X (class 1)']);
  });

  it('stores the lifters but only counts the links when previewing them, all the way down the chain', async () => {
    mockClassItems = [{ text: 'Class 0', value: 0 }];
    mockApi.rankings.mockResolvedValue([rankingRow('1')]);
    const rankings = fakeCtx();
    await handlerOf<Dict, void>(backfill)(rankings.ctx, { previewLinks: true });
    expect(rankings.mutations.map((m) => [m.name, m.args.queueRelinks])).toEqual([['ingest:upsertLifters', false]]);
    expect(itemAt(rankings.scheduled, 0).args).toMatchObject({ stage: 'link', previewLinks: true });

    const link = fakeCtx({ names: { names: [{ nameKey: 'a', athleteIds: ['1'] }], done: true } });
    await handlerOf<Dict, void>(backfill)(link.ctx, itemAt(rankings.scheduled, 0).args);
    expect(link.mutations.map((m) => [m.name, m.args.dryRun])).toEqual([['ingest:linkLifterResults', true]]);
  });
});

describe('how sightings are sent to be stored', () => {
  const sighting = (athleteId: string) => ({ athleteId, membership: null, name: 'A', gender: null, birthYear: null, club: null, wso: null, date: '2026-01-01' });

  it('sends at most a batch’s worth each time, never splitting one athlete across two, and never an empty batch', () => {
    const many = Array.from({ length: SIGHTINGS_PER_STORE + 5 }, (_, i) => sighting(String(i % 70)));
    const batches = byAthleteBatches(many);
    expect(batches.every((batch) => batch.length > 0 && batch.length <= SIGHTINGS_PER_STORE)).toBe(true);
    expect(batches.flat()).toHaveLength(many.length);
    const batchesOf = new Map<string, Set<number>>();
    batches.forEach((batch, i) => batch.forEach((s) => batchesOf.set(s.athleteId, (batchesOf.get(s.athleteId) ?? new Set()).add(i))));
    expect([...batchesOf.values()].every((indexes) => indexes.size === 1)).toBe(true);
    const one = Array.from({ length: SIGHTINGS_PER_STORE + 1 }, () => sighting('solo'));
    expect(byAthleteBatches([sighting('first'), ...one]).map((batch) => batch.length)).toEqual([1, SIGHTINGS_PER_STORE + 1]);
  });
});

describe('what the nightly run reads', () => {
  const classes = [
    { id: 1, label: "Open Men's 95kg" },
    { id: 2, label: "(Inactive) Open Men's 85 kg" },
  ];

  it('picks each rankings class its results are in, and lists the divisions no class is named for', () => {
    const rows = [
      { nameKey: 'a', age: "Open Men's 95kg", date: '2026-10-01', federation: 'USAW', storedAt: 1 },
      { nameKey: 'b', age: "Open Men's 85 kg", date: '2026-10-01', federation: 'USAW', storedAt: 1 },
      { nameKey: 'c', age: 'Mystery Division', date: '2026-10-01', federation: 'USAW', storedAt: 1 },
      { nameKey: 'd', age: null, date: '2026-10-01', federation: 'USAW', storedAt: 1 },
      { nameKey: 'e', age: 'Masters Only Division', date: '2026-10-01', federation: 'USAMW', storedAt: 1 },
    ];
    expect(classesOfResults(rows, classes)).toEqual({ picked: classes, unknown: ['Mystery Division'] });
  });

  it('reads the rankings from 45 days before each run of nearby USAW dates, as an online meet runs a month, to a week after, never past today', () => {
    const row = (date: string, federation = 'USAW') => ({ nameKey: date, age: null, date, federation, storedAt: 1 });
    const windows = rankingsWindows([row('2026-11-08'), row('2026-10-10'), row('2026-08-01'), row('2025-03-01'), row('2020-01-01', 'USAMW')], '2026-11-11');
    expect(windows.map(({ from, to, rows }) => [from, to, rows.map((r) => r.date)])).toEqual([
      ['2025-01-15', '2025-03-08', ['2025-03-01']],
      ['2026-06-17', '2026-08-08', ['2026-08-01']],
      ['2026-08-26', '2026-11-11', ['2026-10-10', '2026-11-08']],
    ]);
  });

  it('joins runs of dates up to 52 days apart into one window, so no two windows read the same day twice', () => {
    const row = (date: string) => ({ nameKey: date, age: null, date, federation: 'USAW', storedAt: 1 });
    expect(rankingsWindows([row('2026-08-01'), row('2026-09-22')], '2026-12-31')).toHaveLength(1);
    const windows = rankingsWindows([row('2026-08-01'), row('2026-09-23')], '2026-12-31');
    expect(itemAt(windows, 1).from > itemAt(windows, 0).to).toBe(true);
  });

  it('reads the rankings of a month-long online meet back to its first day, so a lifter new to Sport80 who lifted early in it is found', () => {
    const window = itemAt(rankingsWindows([{ nameKey: 'a', age: "Open Women's 49kg", date: '2026-10-31', federation: 'USAW', storedAt: 1 }], '2026-11-11'), 0);
    expect(window.from <= '2026-10-01').toBe(true);
  });

  it('reads no rankings for a result stored without a meet date, which would otherwise widen the window to all time', () => {
    expect(rankingsWindows([{ nameKey: 'a', age: "Open Men's 95kg", date: '1970-01-01', federation: 'USAW', storedAt: 1 }], '2026-11-11')).toEqual([]);
  });
});
