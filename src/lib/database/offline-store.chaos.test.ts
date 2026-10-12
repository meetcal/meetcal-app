import AsyncStorage from '@react-native-async-storage/async-storage';
import * as fc from 'fast-check';

import type { SupabaseLiftResult } from '@/data/types/athletes';
import {
  getAllCachedLiftingResultsForAthlete,
  getMeetLiftingResults,
  saveAthleteHistoryBatch,
  saveMeetLiftingResults,
} from '@/lib/database/offline-store';
import { faultPlanArb, installStorageChaos, storageFaultArb, type StorageFault } from '@/test-support/chaos';
import { bulkyLiftResults, liftResultArb, liftResultsArb } from '@/test-support/lift-result-arbitraries';

/**
 * Lifting results under storage failure. The write is crash-safe by design
 * (`writeStoredLiftingResultsBatch`): new chunks go under a fresh key
 * generation, the manifest is the commit point, a failed write restores the
 * previous manifest. So after any failure a read sees the previous copy or
 * the new one, whole; and the read itself never throws (`getMeetLiftingResults`
 * reports a failure as no cached results).
 */

jest.mock('@/lib/api/meetcal-api', () => ({ getTrustedNow: () => null }));

type OfflineStoreModule = typeof import('@/lib/database/offline-store');

/** The AsyncStorage mock this file's disk lives in, shared with every restarted store. */
const asyncStorageModule: unknown = jest.requireMock('@react-native-async-storage/async-storage');

/**
 * `offline-store` as the app has it after a restart: the same disk, none of
 * the old copy's in-memory state. The crash tests below simulate a process
 * dying mid-write with a storage call that never settles. A meet's saves run
 * one after another on a per-meet write chain (`meetDataWrites`), so in the
 * same module copy every later save of that meet would wait on the dead one
 * forever; a real crash takes that chain with it. What happens after a
 * crash (a read, a later rewrite) therefore runs on a restarted store.
 */
function restartedStore(): OfflineStoreModule {
  let store: OfflineStoreModule | undefined;
  jest.isolateModules(() => {
    jest.doMock('@react-native-async-storage/async-storage', () => asyncStorageModule);
    store = jest.requireActual<OfflineStoreModule>('@/lib/database/offline-store');
  });
  if (!store) throw new Error('offline-store did not load');
  return store;
}

jest.setTimeout(Math.max(10_000, (fc.readConfigureGlobal().numRuns ?? 100) * 150));

const MEET = 'Chaos Test Meet';

type Storage = { __INTERNAL_MOCK_STORAGE__: Record<string, string> };

/** Failures storage reports honestly: it rejects, it is full, or it says it wrote and did not. */
const honestFaultArb: fc.Arbitrary<StorageFault> = fc.constantFrom<StorageFault>(
  { kind: 'pass' },
  { kind: 'pass' },
  { kind: 'reject' },
  { kind: 'quota' },
  { kind: 'lose-write' },
);

/** Rows a `corrupt-read` value would decode to if it parsed as a legacy (pre-manifest) payload. */
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
      // Not JSON: it cannot decode to rows.
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
          // A read under failure may also miss, but never throws.
          const chaoticRead = await underChaos(readPlan, () => getMeetLiftingResults(MEET));
          expect([[], ...landed]).toContainEqual(chaoticRead);
          // Once storage is healthy again, what is on disk is one whole copy:
          // the previous one survives any failed rewrite.
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

          // A `corrupt-read` hands the read bytes nobody wrote. When they
          // parse as a legacy row array they *are* a stored payload as far as
          // the reader can tell, so their rows are a legitimate answer. A
          // rewrite never puts such bytes back on disk, so only the read's
          // own plan can produce them. What must never come back is a subset
          // or a mix of written copies.
          const legitimate = [[], previous ?? [], next, ...legacyRowsFrom(readPlan)];
          expect(legitimate).toContainEqual(read);

          // A later healthy write always lands, whatever chaos left behind
          // (orphaned chunks, a restored manifest, a corrupt one).
          await saveMeetLiftingResults(MEET, healing);
          const healed = await getMeetLiftingResults(MEET);
          if (healing.length > 0) expect(healed).toEqual(healing);
          else expect(legitimate).toContainEqual(healed);
        },
      ),
    );
  });

  // Regression: a rewrite used to keep whatever bytes its first read returned
  // and, on failure, write them back over the good manifest it never touched
  // (seed 494037883: the manifest read as `""`, then the `multiSet` was
  // rejected, and the meet read as no results). The unparseable read also
  // picked generation 0, so the new chunks overwrote the live ones before the
  // commit point. Now only a payload that parsed as a manifest is restored,
  // and an unreadable one takes its generation from a key listing.
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

  // The shrunk counterexample of the regression above.
  it('keeps the previous copy when the manifest reads corrupt and the multiSet is rejected', async () => {
    const previous = [{ ...bulkyLiftResults(1, 1)[0], name: 'Previous Lifter' }];
    const next = [{ ...bulkyLiftResults(2, 1)[0], name: 'Next Lifter' }];
    await saveMeetLiftingResults(MEET, previous);
    // The manifest read, the key listing, the listed chunks' read, the rejected multiSet.
    await underChaos([{ kind: 'corrupt-read', value: '' }, { kind: 'pass' }, { kind: 'pass' }, { kind: 'reject' }], () =>
      saveMeetLiftingResults(MEET, next).catch(() => undefined),
    );
    expect(await getMeetLiftingResults(MEET)).toEqual(previous);
  });

  it('does not write corrupt bytes that read as legacy rows back over a landed rewrite', async () => {
    const previous = [{ ...bulkyLiftResults(1, 1)[0], name: 'Previous Lifter' }];
    const next = [{ ...bulkyLiftResults(2, 1)[0], name: 'Next Lifter' }];
    await saveMeetLiftingResults(MEET, previous);
    // The manifest reads as `[]` (a legacy row array), the listed chunks read
    // fine, the commit lands, and the read-back that would confirm it is
    // rejected.
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
    // An orphan a failed write left behind, a generation past the live one.
    storage[`meetcal_lifting_results_${MEET}__chunk_0_g4`] = 'orphan';
    const liveChunk = storage[`meetcal_lifting_results_${MEET}__chunk_0`];

    // The manifest reads unparseable, then the process dies once the chunks
    // are down: the live generation-0 chunk must be untouched.
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

    // A rewrite that lands after an unreadable manifest read prunes every
    // generation the listing found. The app restarted after the crash.
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
          // Each case is a fresh launch: the previous case's crash left its
          // module copy's write chain waiting forever (see `restartedStore`).
          const { getMeetLiftingResults, saveMeetLiftingResults } = restartedStore();
          if (previous) await saveMeetLiftingResults(MEET, previous);

          // The data `multiSet` persists its first `crashAfter` pairs and the
          // process dies: the promise never settles, nothing after it runs.
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
            // Nothing to write: the stored bytes already matched.
            multiSet.mockReset();
            multiSet.mockImplementation(realMultiSet);
            expect(settled).toBe(true);
            expect(await getMeetLiftingResults(MEET)).toEqual(next);
            return;
          }

          // Chunks are written before the manifest, so only a write that got
          // every pair down (the manifest is the last) is visible.
          const expected = persisted === total ? next : (previous ?? []);
          expect(await getMeetLiftingResults(MEET)).toEqual(expected);
        },
      ),
    );
  });

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
            const read: SupabaseLiftResult[] = await getAllCachedLiftingResultsForAthlete(name);
            // An empty history blob reads as "nothing cached" (the reader then
            // scans meets, of which there are none here).
            const isPrevious = JSON.stringify(read) === JSON.stringify(previousRows[i]);
            const isNext = JSON.stringify(read) === JSON.stringify(nextRows[i]);
            expect(isPrevious || isNext).toBe(true);
            if (!isNext) sawPrevious = true;
            if (!isPrevious) sawNext = true;
          }
          // The batch commits together: one multiSet carries every manifest.
          expect(sawPrevious && sawNext).toBe(false);
        },
      ),
    );
  });
});
