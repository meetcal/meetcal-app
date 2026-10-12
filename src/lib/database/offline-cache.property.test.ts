import AsyncStorage from '@react-native-async-storage/async-storage';
import * as fc from 'fast-check';

import {
  getOfflineCache,
  readBoundedCacheEntry,
  setOfflineCache,
  writeBoundedCacheEntry,
} from '@/lib/database/offline-cache';
import { corruptedArb, hostileStringArb } from '@/test-support/arbitraries';
import { faultPlanArb, installStorageChaos, storageFaultArb } from '@/test-support/chaos';

/**
 * The offline cache (`offline-cache.ts`) keeps reference data and browse
 * caches as `{ data, lastSynced }` blobs. It has no expiry of its own:
 * `lastSynced` is shown as "Last synced …" and callers decide what is stale.
 * So the clock properties here are that every entry carries the time *it* was
 * written, whatever the clock did in between (including running backwards),
 * and that a bounded cache evicts by write order, never by timestamp.
 */

const KEY = '@offline_cache/property';

/** Device clocks, in any order: a sequence of these runs forwards and backwards. */
const clockArb = fc.integer({ min: 0, max: 4_102_444_800_000 });

const storedBytesArb: fc.Arbitrary<string> = fc.oneof(
  hostileStringArb,
  fc.jsonValue({ maxDepth: 3 }).map((value) => JSON.stringify(value)),
  corruptedArb({ data: { rows: [{ a: 1 }, { b: 'x' }] }, lastSynced: 1_700_000_000_000 }).map(
    (value) => JSON.stringify(value) ?? '',
  ),
  corruptedArb({
    data: [
      { key: 'Men 89', data: [1, 2], lastSynced: 10 },
      { key: 'Women 71', data: null, lastSynced: 20 },
    ],
    lastSynced: 20,
  }).map((value) => JSON.stringify(value) ?? ''),
);

function jsonRoundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.useFakeTimers();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('getOfflineCache', () => {
  it('reads any stored bytes as a well-formed entry or as no entry, never a throw', async () => {
    await fc.assert(
      fc.asyncProperty(storedBytesArb, async (bytes) => {
        await AsyncStorage.clear();
        await AsyncStorage.setItem(KEY, bytes);
        const entry = await getOfflineCache<unknown>(KEY);
        if (entry === null) return;
        // Not a half-valid object: exactly what was stored, with the shape
        // every caller reads.
        expect(typeof entry).toBe('object');
        expect(Array.isArray(entry)).toBe(false);
        expect('data' in entry).toBe(true);
        expect(Number.isFinite(entry.lastSynced)).toBe(true);
        expect(entry).toEqual(JSON.parse(bytes));
      }),
    );
  });

  it('round-trips any JSON data with the write time as lastSynced', async () => {
    await fc.assert(
      fc.asyncProperty(fc.jsonValue({ maxDepth: 4 }), clockArb, async (data, now) => {
        await AsyncStorage.clear();
        jest.setSystemTime(now);
        const written = await setOfflineCache(KEY, data);
        expect(written.lastSynced).toBe(now);
        expect(await getOfflineCache(KEY)).toEqual({ data: jsonRoundTrip(data), lastSynced: now });
      }),
    );
  });

  it('never throws to the caller under storage faults', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.jsonValue({ maxDepth: 2 }),
        faultPlanArb(storageFaultArb, 4),
        async (data, plan) => {
          await AsyncStorage.clear();
          const chaos = installStorageChaos(plan);
          try {
            await setOfflineCache(KEY, data);
            const entry = await getOfflineCache(KEY);
            if (entry !== null) expect(Number.isFinite(entry.lastSynced)).toBe(true);
          } finally {
            chaos.restore();
          }
        },
      ),
    );
  });
});

describe('bounded browse caches', () => {
  const writeArb = fc.record({
    key: fc.constantFrom('Men 89', 'Women 71', 'Club A', 'Club B', 'WSO', '__proto__', ''),
    data: fc.jsonValue({ maxDepth: 2 }),
    now: clockArb,
  });

  it('holds the newest maxEntries writes, each stamped with its own write time, whatever the clock does', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 5 }), fc.array(writeArb, { maxLength: 20 }), async (max, writes) => {
        await AsyncStorage.clear();
        // The model: write order, oldest first, one slot per key.
        let model: { key: string; data: unknown; at: number }[] = [];
        for (const write of writes) {
          jest.setSystemTime(write.now);
          const result = await writeBoundedCacheEntry(KEY, write.key, write.data, max);
          expect(result.lastUpdatedAt).toBe(write.now);
          model = [...model.filter((entry) => entry.key !== write.key), {
            key: write.key,
            data: jsonRoundTrip(write.data),
            at: write.now,
          }].slice(-max);

          const stored = await getOfflineCache<{ key: string }[]>(KEY);
          expect(stored?.data.length).toBeLessThanOrEqual(max);
          expect(stored?.data.map((record) => record.key)).toEqual(model.map((entry) => entry.key));
        }
        for (const key of new Set(writes.map((write) => write.key))) {
          const expected = model.find((entry) => entry.key === key);
          expect(await readBoundedCacheEntry(KEY, key)).toEqual(
            expected ? { data: expected.data, lastUpdatedAt: expected.at } : null,
          );
        }
      }),
    );
  });

  it('stays bounded over any stored blob, legacy shape or corrupt', async () => {
    await fc.assert(
      fc.asyncProperty(storedBytesArb, fc.integer({ min: 1, max: 4 }), async (bytes, max) => {
        await AsyncStorage.clear();
        await AsyncStorage.setItem(KEY, bytes);
        await writeBoundedCacheEntry(KEY, 'fresh', { ok: true }, max);
        const stored = await getOfflineCache<{ key: string; data: unknown; lastSynced: number }[]>(KEY);
        expect(Array.isArray(stored?.data)).toBe(true);
        expect(stored!.data.length).toBeLessThanOrEqual(max);
        expect(stored!.data.at(-1)).toMatchObject({ key: 'fresh', data: { ok: true } });
        for (const record of stored!.data) {
          expect(typeof record.key).toBe('string');
          expect(Number.isFinite(record.lastSynced)).toBe(true);
        }
      }),
    );
  });

  it('under storage faults never throws, stays bounded, and keeps only records it wrote', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 4 }),
        fc.array(writeArb, { minLength: 1, maxLength: 10 }),
        faultPlanArb(storageFaultArb, 12),
        async (max, writes, plan) => {
          await AsyncStorage.clear();
          const chaos = installStorageChaos(plan);
          try {
            for (const write of writes) {
              jest.setSystemTime(write.now);
              await writeBoundedCacheEntry(KEY, write.key, write.data, max);
              await readBoundedCacheEntry(KEY, write.key);
            }
          } finally {
            chaos.restore();
          }

          const stored = await getOfflineCache<{ key: string; data: unknown; lastSynced: number }[]>(KEY);
          if (stored === null) return;
          expect(stored.data.length).toBeLessThanOrEqual(max);
          // A corrupt read can hand the writer a blob nobody wrote, which it
          // then keeps as if it were the cache; with honest storage every
          // record is one of the writes.
          if (plan.some((fault) => fault.kind === 'corrupt-read')) return;
          for (const record of stored.data) {
            expect(
              writes.some(
                (write) =>
                  write.key === record.key &&
                  write.now === record.lastSynced &&
                  JSON.stringify(jsonRoundTrip(write.data)) === JSON.stringify(record.data),
              ),
            ).toBe(true);
          }
        },
      ),
    );
  });
});
