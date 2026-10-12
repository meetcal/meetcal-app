import AsyncStorage from '@react-native-async-storage/async-storage';
import * as fc from 'fast-check';

import { getMeetLiftingResults, saveMeetLiftingResults } from '@/lib/database/offline-store';
import { corruptedArb, hostileStringArb } from '@/test-support/arbitraries';
import { bulkyLiftResults, liftResultsArb } from '@/test-support/lift-result-arbitraries';

/**
 * Meet lifting results are stored deflated, base64'd and split into 180 KB
 * chunks behind a manifest (`offline-store.ts`). Whatever happens to those
 * bytes on disk, a read returns all of what was written or nothing: never a
 * subset, never someone else's rows, never a pako or JSON error.
 */

jest.mock('@/lib/api/meetcal-api', () => ({ getTrustedNow: () => null }));

// A multi-chunk case deflates and inflates ~300 KB; leave room for the
// nightly run's larger case count.
jest.setTimeout(Math.max(10_000, (fc.readConfigureGlobal().numRuns ?? 100) * 100));

const MEET = 'Property Test Meet';
const RESULTS_KEY = `meetcal_lifting_results_${MEET}`;

function storage(): Record<string, string> {
  return (AsyncStorage as unknown as { __INTERNAL_MOCK_STORAGE__: Record<string, string> }).__INTERNAL_MOCK_STORAGE__;
}

/** The chunk keys the stored manifest names, in order. */
function chunkKeys(): string[] {
  return Object.keys(storage())
    .filter((key) => key.startsWith(`${RESULTS_KEY}__chunk_`))
    .sort((a, b) => Number(a.split('__chunk_')[1].split('_')[0]) - Number(b.split('__chunk_')[1].split('_')[0]));
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('meet lifting results encoding', () => {
  it('reads back exactly the rows it wrote: empty, unicode, hostile and multi-chunk sets', async () => {
    await fc.assert(
      fc.asyncProperty(liftResultsArb, async (rows) => {
        await AsyncStorage.clear();
        await saveMeetLiftingResults(MEET, rows);
        expect(await getMeetLiftingResults(MEET)).toEqual(rows);
      }),
    );
  });

  it('a rewrite replaces the previous set entirely, whatever its size', async () => {
    await fc.assert(
      fc.asyncProperty(liftResultsArb, liftResultsArb, async (first, second) => {
        await AsyncStorage.clear();
        await saveMeetLiftingResults(MEET, first);
        await saveMeetLiftingResults(MEET, second);
        // An empty answer never overwrites a stored set: an upcoming meet has
        // no results yet, and a stored copy is better than none.
        const expected = second.length === 0 ? first : second;
        expect(await getMeetLiftingResults(MEET)).toEqual(expected);
        // Only the live generation's chunks are left behind.
        const manifest = JSON.parse(storage()[RESULTS_KEY]) as { chunks: number };
        expect(chunkKeys()).toHaveLength(manifest.chunks);
      }),
    );
  });

  it('splits a blob larger than one chunk and reads it back whole', async () => {
    const rows = bulkyLiftResults(7, 1500);
    await saveMeetLiftingResults(MEET, rows);
    expect(chunkKeys().length).toBeGreaterThan(1);
    expect(await getMeetLiftingResults(MEET)).toEqual(rows);
  });
});

describe('corrupted lifting results on disk', () => {
  const allOrNothing = (read: unknown, rows: unknown) => {
    expect([[], rows]).toContainEqual(read);
  };

  it('a broken manifest reads as all the rows or none', async () => {
    const rows = bulkyLiftResults(11, 900);
    await saveMeetLiftingResults(MEET, rows);
    const manifest: unknown = JSON.parse(storage()[RESULTS_KEY]);
    const pristine = { ...storage() };

    await fc.assert(
      fc.asyncProperty(corruptedArb(manifest), async (broken) => {
        await AsyncStorage.clear();
        await AsyncStorage.multiSet(Object.entries(pristine));
        if (broken === undefined) await AsyncStorage.removeItem(RESULTS_KEY);
        else await AsyncStorage.setItem(RESULTS_KEY, JSON.stringify(broken));
        allOrNothing(await getMeetLiftingResults(MEET), rows);
      }),
    );
  });

  it('a damaged, truncated, missing or swapped chunk reads as all the rows or none', async () => {
    const rows = bulkyLiftResults(13, 1200);
    await saveMeetLiftingResults(MEET, rows);
    const keys = chunkKeys();
    expect(keys.length).toBeGreaterThan(1);
    const pristine = { ...storage() };

    const damageArb = fc.oneof(
      fc.record({ kind: fc.constant('replace' as const), value: hostileStringArb }),
      fc.record({ kind: fc.constant('truncate' as const), keep: fc.double({ min: 0, max: 1, noNaN: true }) }),
      fc.record({ kind: fc.constant('remove' as const) }),
      fc.record({ kind: fc.constant('swap' as const) }),
      fc.record({ kind: fc.constant('flip' as const), at: fc.nat() }),
    );

    await fc.assert(
      fc.asyncProperty(fc.nat({ max: keys.length - 1 }), damageArb, async (index, damage) => {
        await AsyncStorage.clear();
        await AsyncStorage.multiSet(Object.entries(pristine));
        const key = keys[index];
        const chunk = pristine[key];
        switch (damage.kind) {
          case 'replace':
            await AsyncStorage.setItem(key, damage.value);
            break;
          case 'truncate':
            await AsyncStorage.setItem(key, chunk.slice(0, Math.floor(chunk.length * damage.keep)));
            break;
          case 'remove':
            await AsyncStorage.removeItem(key);
            break;
          case 'swap': {
            const other = keys[(index + 1) % keys.length];
            await AsyncStorage.multiSet([
              [key, pristine[other]],
              [other, chunk],
            ]);
            break;
          }
          case 'flip': {
            // One base64 character changed: a single flipped byte on disk.
            const at = damage.at % chunk.length;
            const replacement = chunk[at] === 'A' ? 'B' : 'A';
            await AsyncStorage.setItem(key, chunk.slice(0, at) + replacement + chunk.slice(at + 1));
            break;
          }
        }
        allOrNothing(await getMeetLiftingResults(MEET), rows);
      }),
    );
  });
});
