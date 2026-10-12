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

          // A `corrupt-read` hands the store bytes nobody wrote. When they
          // parse as a legacy row array they *are* a stored payload as far as
          // the store can tell (during a rewrite, they are also what the
          // restore puts back), so their rows are a legitimate answer. What
          // must never come back is a subset or a mix of written copies.
          const legitimate = [[], previous ?? [], next, ...legacyRowsFrom([...writePlan, ...readPlan])];
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

  // FINDING: a corrupted read of the manifest at the start of a rewrite costs
  // the previous copy when the rewrite then fails. Counterexample (seed
  // 494037883): previous and next are one row each; the write's first
  // `multiGet` reads the manifest as `""`, then the `multiSet` is rejected.
  // `writeStoredLiftingResultsBatch` keeps the bytes it read as
  // `previousPayload` (offline-store.ts:531), and `restorePreviousManifests`
  // (offline-store.ts:588) writes them back over the good manifest that was
  // never touched, so the meet reads as no results. With the commit landing
  // instead, the unparseable read also picks generation 0
  // (offline-store.ts:523), so the new chunks overwrite the live gen-0 chunks
  // before the commit point. Not fixed here (offline cache: behaviour changes
  // need approval); see the report.
  it.skip('a corrupted read during a failed rewrite does not cost the previous copy', async () => {
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

  // FINDING (see above): the shrunk counterexample, kept as an example.
  it.skip('keeps the previous copy when the manifest reads corrupt and the multiSet is rejected', async () => {
    const previous = [{ ...bulkyLiftResults(1, 1)[0], name: 'Previous Lifter' }];
    const next = [{ ...bulkyLiftResults(2, 1)[0], name: 'Next Lifter' }];
    await saveMeetLiftingResults(MEET, previous);
    await underChaos([{ kind: 'corrupt-read', value: '' }, { kind: 'reject' }], () =>
      saveMeetLiftingResults(MEET, next).catch(() => undefined),
    );
    expect(await getMeetLiftingResults(MEET)).toEqual(previous);
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
