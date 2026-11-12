import AsyncStorage from '@react-native-async-storage/async-storage';
import * as fc from 'fast-check';

import type { AthleteMeetResult } from '@/data/types/athletes';
import { getAllCachedLiftingResultsForAthlete, saveAthleteHistoryBatch } from '@/lib/database/athlete-history-store';
import { getMeetLiftingResults } from '@/lib/database/meet-data-reads';
import { saveMeetLiftingResults } from '@/lib/database/meet-data-saves';
import { faultPlanArb, installStorageChaos, storageFaultArb, type StorageFault } from '@/test-support/chaos';
import { bulkyLiftResults, liftResultArb, liftResultsArb } from '@/test-support/lift-result-arbitraries';

jest.mock('@/lib/api/server-clock', () => ({ getTrustedNow: () => null }));

type RestartedStore = Pick<typeof import('@/lib/database/meet-data-reads'), 'getMeetLiftingResults'> &
  Pick<typeof import('@/lib/database/meet-data-saves'), 'saveMeetLiftingResults'>;

const asyncStorageModule: unknown = jest.requireMock('@react-native-async-storage/async-storage');

function restartedStore(): RestartedStore {
  let store: RestartedStore | undefined;
  jest.isolateModules(() => {
    jest.doMock('@react-native-async-storage/async-storage', () => asyncStorageModule);
    const reads = jest.requireActual<typeof import('@/lib/database/meet-data-reads')>('@/lib/database/meet-data-reads');
    const saves = jest.requireActual<typeof import('@/lib/database/meet-data-saves')>('@/lib/database/meet-data-saves');
    store = {
      getMeetLiftingResults: reads.getMeetLiftingResults,
      saveMeetLiftingResults: saves.saveMeetLiftingResults,
    };
  });
  if (!store) throw new Error('the offline store did not load');
  return store;
}

const PER_CASE_BUDGET_MS = (fc.readConfigureGlobal().numRuns ?? 100) * 150;
jest.setTimeout(Math.max(30_000, PER_CASE_BUDGET_MS));
const BUDGET_WHEN_EVERY_CASE_RELOADS_THE_STORE_MS = Math.max(60_000, PER_CASE_BUDGET_MS);

const MEET = 'Chaos Test Meet';

type Storage = { __INTERNAL_MOCK_STORAGE__: Record<string, string> };

const honestFaultArb: fc.Arbitrary<StorageFault> = fc.constantFrom<StorageFault>(
  { kind: 'pass' },
  { kind: 'pass' },
  { kind: 'reject' },
  { kind: 'quota' },
  { kind: 'lose-write' },
);

function legacyRowsFrom(plan: readonly StorageFault[]): unknown[][] {
  const rows: unknown[][] = [];
  for (const fault of plan) {
    if (fault.kind !== 'corrupt-read') continue;
    try {
      const parsed: unknown = JSON.parse(fault.value);
      if (Array.isArray(parsed)) {
        rows.push(
          parsed.filter(
            (row) =>
              typeof row === 'object' &&
              row !== null &&
              !Array.isArray(row) &&
              typeof (row as { name?: unknown }).name === 'string',
          ),
        );
      }
    } catch {
    }
  }
  return rows;
}

async function underChaos<T>(plan: readonly StorageFault[], run: () => Promise<T>): Promise<T> {
  const chaos = installStorageChaos(plan);
  try {
    return await run();
  } finally {
    chaos.restore();
  }
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('meet lifting results under storage chaos', () => {
  it('a failed rewrite keeps the previous copy or lands the new one, whole', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.option(liftResultsArb, { nil: null }),
        liftResultsArb,
        faultPlanArb(honestFaultArb, 10),
        faultPlanArb(honestFaultArb, 6),
        async (previous, next, writePlan, readPlan) => {
          await AsyncStorage.clear();
          if (previous) await saveMeetLiftingResults(MEET, previous);

          await underChaos(writePlan, () => saveMeetLiftingResults(MEET, next).catch(() => undefined));

          const landed = previous ? [previous, next] : [[], next];
          const chaoticRead = await underChaos(readPlan, () => getMeetLiftingResults(MEET));
          expect([[], ...landed]).toContainEqual(chaoticRead);
          expect(landed).toContainEqual(await getMeetLiftingResults(MEET));
        },
      ),
    );
  });

  it('with corrupted reads too, a read is a whole copy, a miss, or what the corrupt bytes say', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.option(liftResultsArb, { nil: null }),
        liftResultsArb,
        faultPlanArb(storageFaultArb, 10),
        faultPlanArb(storageFaultArb, 6),
        liftResultsArb,
        async (previous, next, writePlan, readPlan, healing) => {
          await AsyncStorage.clear();
          if (previous) await saveMeetLiftingResults(MEET, previous);

          await underChaos(writePlan, () => saveMeetLiftingResults(MEET, next).catch(() => undefined));
          const read = await underChaos(readPlan, () => getMeetLiftingResults(MEET));

          const legitimate = [[], previous ?? [], next, ...legacyRowsFrom(readPlan)];
          expect(legitimate).toContainEqual(read);

          await saveMeetLiftingResults(MEET, healing);
          const healed = await getMeetLiftingResults(MEET);
          if (healing.length > 0) expect(healed).toEqual(healing);
          else expect(legitimate).toContainEqual(healed);
        },
      ),
    );
  });

  it('a corrupted read during a failed rewrite does not cost the previous copy', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(liftResultArb, { minLength: 1, maxLength: 4 }),
        fc.array(liftResultArb, { minLength: 1, maxLength: 4 }),
        faultPlanArb(storageFaultArb, 8),
        async (previous, next, writePlan) => {
          await AsyncStorage.clear();
          await saveMeetLiftingResults(MEET, previous);
          await underChaos(writePlan, () => saveMeetLiftingResults(MEET, next).catch(() => undefined));
          expect([previous, next]).toContainEqual(await getMeetLiftingResults(MEET));
        },
      ),
    );
  });

  it('keeps the previous copy when the manifest reads corrupt and the multiSet is rejected', async () => {
    const previous = [{ ...bulkyLiftResults(1, 1)[0], name: 'Previous Lifter' }];
    const next = [{ ...bulkyLiftResults(2, 1)[0], name: 'Next Lifter' }];
    await saveMeetLiftingResults(MEET, previous);
    await underChaos([{ kind: 'corrupt-read', value: '' }, { kind: 'pass' }, { kind: 'pass' }, { kind: 'reject' }], () =>
      saveMeetLiftingResults(MEET, next).catch(() => undefined),
    );
    expect(await getMeetLiftingResults(MEET)).toEqual(previous);
  });

  it('does not write corrupt bytes that read as legacy rows back over a landed rewrite', async () => {
    const previous = [{ ...bulkyLiftResults(1, 1)[0], name: 'Previous Lifter' }];
    const next = [{ ...bulkyLiftResults(2, 1)[0], name: 'Next Lifter' }];
    await saveMeetLiftingResults(MEET, previous);
    const multiGet = AsyncStorage.multiGet as jest.Mock;
    const realMultiGet = multiGet.getMockImplementation() as (keys: string[]) => Promise<[string, string | null][]>;
    multiGet
      .mockImplementationOnce(async (keys: string[]) =>
        (await realMultiGet(keys)).map(([key, value]) => [key, value === null ? null : '[]']),
      )
      .mockImplementationOnce(realMultiGet)
      .mockImplementationOnce(async () => {
        throw new Error('chaos: storage unavailable');
      });
    await expect(saveMeetLiftingResults(MEET, next)).rejects.toThrow('chaos: storage unavailable');
    expect(await getMeetLiftingResults(MEET)).toEqual(next);
  });

  it('writes past every chunk generation on disk when the manifest is unreadable, then prunes them', async () => {
    const { getMeetLiftingResults, saveMeetLiftingResults } = restartedStore();
    const storage = (AsyncStorage as unknown as Storage).__INTERNAL_MOCK_STORAGE__;
    const chunkKeys = () => Object.keys(storage).filter((key) => key.includes('__chunk_')).sort();
    const previous = [{ ...bulkyLiftResults(1, 1)[0], name: 'Previous Lifter' }];
    const next = [{ ...bulkyLiftResults(2, 1)[0], name: 'Next Lifter' }];
    await saveMeetLiftingResults(MEET, previous);
    storage[`meetcal_lifting_results_${MEET}__chunk_0_g4`] = 'orphan';
    const liveChunk = storage[`meetcal_lifting_results_${MEET}__chunk_0`];

    const multiSet = AsyncStorage.multiSet as jest.Mock;
    const realMultiSet = multiSet.getMockImplementation() as (pairs: [string, string][]) => Promise<null>;
    multiSet.mockImplementationOnce(async (pairs: [string, string][]) => {
      await realMultiSet(pairs.filter(([key]) => key.includes('__chunk_')));
      return new Promise(() => {});
    });
    void underChaos([{ kind: 'corrupt-read', value: 'not json' }], () => saveMeetLiftingResults(MEET, next));
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
    expect(storage[`meetcal_lifting_results_${MEET}__chunk_0`]).toBe(liveChunk);
    expect(chunkKeys()).toContain(`meetcal_lifting_results_${MEET}__chunk_0_g5`);
    expect(await getMeetLiftingResults(MEET)).toEqual(previous);

    const restarted = restartedStore();
    await underChaos([{ kind: 'corrupt-read', value: 'not json' }], () =>
      restarted.saveMeetLiftingResults(MEET, next),
    );
    expect(await restarted.getMeetLiftingResults(MEET)).toEqual(next);
    expect(chunkKeys()).toEqual([`meetcal_lifting_results_${MEET}__chunk_0_g6`]);
  });

  it('a crash part-way through the chunk writes leaves the previous copy readable', async () => {
    const multiSet = AsyncStorage.multiSet as jest.Mock;
    const realMultiSet = multiSet.getMockImplementation() as (pairs: [string, string][]) => Promise<null>;

    await fc.assert(
      fc.asyncProperty(
        fc.option(liftResultsArb, { nil: null }),
        liftResultsArb.filter((rows) => rows.length > 0),
        fc.nat(),
        async (previous, next, crashAfter) => {
          await AsyncStorage.clear();
          const { getMeetLiftingResults, saveMeetLiftingResults } = restartedStore();
          if (previous) await saveMeetLiftingResults(MEET, previous);

          let total = 0;
          let persisted = 0;
          multiSet.mockImplementationOnce(async (pairs: [string, string][]) => {
            total = pairs.length;
            persisted = Math.min(crashAfter % (pairs.length + 1), pairs.length);
            await realMultiSet(pairs.slice(0, persisted));
            return new Promise(() => {});
          });
          let settled = false;
          void saveMeetLiftingResults(MEET, next).finally(() => {
            settled = true;
          });
          for (let i = 0; i < 50 && total === 0 && !settled; i++) {
            await new Promise((resolve) => setImmediate(resolve));
          }
          if (total === 0) {
            multiSet.mockReset();
            multiSet.mockImplementation(realMultiSet);
            expect(settled).toBe(true);
            expect(await getMeetLiftingResults(MEET)).toEqual(next);
            return;
          }

          const expected = persisted === total ? next : (previous ?? []);
          expect(await getMeetLiftingResults(MEET)).toEqual(expected);
        },
      ),
    );
  }, BUDGET_WHEN_EVERY_CASE_RELOADS_THE_STORE_MS);

  it('keeps the previous multi-chunk copy when the process dies after the first new chunk', async () => {
    const { getMeetLiftingResults, saveMeetLiftingResults } = restartedStore();
    const previous = bulkyLiftResults(3, 900);
    const next = bulkyLiftResults(5, 900);
    await saveMeetLiftingResults(MEET, previous);
    const multiSet = AsyncStorage.multiSet as jest.Mock;
    const realMultiSet = multiSet.getMockImplementation() as (pairs: [string, string][]) => Promise<null>;
    multiSet.mockImplementationOnce(async (pairs: [string, string][]) => {
      await realMultiSet(pairs.slice(0, 1));
      return new Promise(() => {});
    });
    void saveMeetLiftingResults(MEET, next);
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
    expect(Object.keys((AsyncStorage as unknown as Storage).__INTERNAL_MOCK_STORAGE__)).toContain(
      `meetcal_lifting_results_${MEET}__chunk_0_g1`,
    );
    expect(await getMeetLiftingResults(MEET)).toEqual(previous);
  });
});

describe('athlete history batches under storage chaos', () => {
  const namesArb = fc.uniqueArray(fc.constantFrom('Ana Lopez', 'Ben Ito', 'Cy Park', 'Di Moss', 'Ed Roy'), {
    minLength: 1,
    maxLength: 5,
  });
  const historyArb = fc.array(liftResultArb, { maxLength: 4 });

  it("each athlete reads back their previous history or the new one, never another's", async () => {
    await fc.assert(
      fc.asyncProperty(
        namesArb,
        fc.array(historyArb, { minLength: 5, maxLength: 5 }),
        fc.array(historyArb, { minLength: 5, maxLength: 5 }),
        faultPlanArb(honestFaultArb, 8),
        async (names, previousRows, nextRows, plan) => {
          await AsyncStorage.clear();
          await saveAthleteHistoryBatch(names.map((name, i) => ({ name, results: previousRows[i] })));

          await underChaos(plan, () =>
            saveAthleteHistoryBatch(names.map((name, i) => ({ name, results: nextRows[i] }))).catch(() => 0),
          );

          let sawPrevious = false;
          let sawNext = false;
          for (const [i, name] of names.entries()) {
            const read: AthleteMeetResult[] = await getAllCachedLiftingResultsForAthlete(name);
            const isPrevious = JSON.stringify(read) === JSON.stringify(previousRows[i]);
            const isNext = JSON.stringify(read) === JSON.stringify(nextRows[i]);
            expect(isPrevious || isNext).toBe(true);
            if (!isNext) sawPrevious = true;
            if (!isPrevious) sawNext = true;
          }
          expect(sawPrevious && sawNext).toBe(false);
        },
      ),
    );
  });
});
