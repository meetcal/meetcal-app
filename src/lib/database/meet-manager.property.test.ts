import AsyncStorage from '@react-native-async-storage/async-storage';
import * as fc from 'fast-check';

import {
  getStoredPackageEtag,
  HISTORY_REFRESH_TTL_MS,
  pruneHistorySyncedAt,
  savePackageEtag,
  touchMeetAccess,
} from '@/lib/database/meet-manager';
import { corruptedArb, hostileStringArb } from '@/test-support/arbitraries';

/**
 * `meet-manager`'s own AsyncStorage blobs: the package ETag per meet, the
 * cache-eviction bookkeeping, the history-sync stamps. Each is read back from
 * whatever is on disk; garbage reads as "nothing recorded" and is dropped on
 * the next write, never trusted and never thrown.
 */

jest.mock('@/lib/networkUtils', () => ({ isNetworkAvailable: jest.fn(async () => true) }));
jest.mock('@/lib/database/queries', () => ({
  fetchSchedule: jest.fn(async () => []),
  fetchAthletesWithSession: jest.fn(async () => []),
}));

const ETAG_KEY = '@meet_package_etag_v1';
const CACHE_INFO_KEY = '@meet_cache_info';

const meetNameArb = fc.oneof(
  fc.constantFrom('Nationals', 'Masters Worlds', '__proto__', 'constructor', 'toString', 'hasOwnProperty'),
  hostileStringArb,
);

function bytesAround(valid: unknown): fc.Arbitrary<string> {
  return fc.oneof(
    hostileStringArb,
    fc.jsonValue({ maxDepth: 3 }).map((value) => JSON.stringify(value)),
    corruptedArb(valid).map((value) => JSON.stringify(value) ?? ''),
  );
}

function stored(key: string): unknown {
  const raw = (AsyncStorage as unknown as { __INTERNAL_MOCK_STORAGE__: Record<string, string> })
    .__INTERNAL_MOCK_STORAGE__[key];
  return raw === undefined ? undefined : JSON.parse(raw);
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('package ETags on disk', () => {
  const VALID = { Nationals: '"v1"', 'Masters Worlds': '"v7"' };

  it('reads a non-empty string the blob holds for that meet, or null', async () => {
    await fc.assert(
      fc.asyncProperty(bytesAround(VALID), meetNameArb, async (bytes, meet) => {
        await AsyncStorage.clear();
        await AsyncStorage.setItem(ETAG_KEY, bytes);
        const etag = await getStoredPackageEtag(meet);
        if (etag === null) return;
        expect(typeof etag).toBe('string');
        expect(etag.length).toBeGreaterThan(0);
        const parsed = JSON.parse(bytes) as Record<string, unknown>;
        expect(Object.prototype.hasOwnProperty.call(parsed, meet) && parsed[meet]).toBe(etag);
      }),
    );
  });

  it('a write over any blob keeps only usable tags and records the new one', async () => {
    await fc.assert(
      fc.asyncProperty(bytesAround(VALID), meetNameArb, fc.option(fc.constantFrom('"v2"', 'W/"x"'), { nil: null }), async (bytes, meet, etag) => {
        await AsyncStorage.clear();
        await AsyncStorage.setItem(ETAG_KEY, bytes);
        await savePackageEtag(meet, etag);
        const blob = stored(ETAG_KEY) as Record<string, unknown>;
        expect(blob !== null && typeof blob === 'object' && !Array.isArray(blob)).toBe(true);
        for (const value of Object.values(blob)) {
          expect(typeof value).toBe('string');
          expect((value as string).length).toBeGreaterThan(0);
        }
        // `__proto__` cannot be an own key of a plain object written this way;
        // every other name round-trips.
        if (meet !== '__proto__') expect(await getStoredPackageEtag(meet)).toBe(etag);
      }),
    );
  });
});

describe('cache-eviction bookkeeping on disk', () => {
  const VALID = {
    totalSize: 30,
    meets: { Nationals: { lastAccessed: 1_700_000_000_000, size: 10 }, Masters: { lastAccessed: 5, size: 20 } },
  };

  it('a meet access over any stored blob writes only well-formed entries, the accessed meet newest', async () => {
    await fc.assert(
      fc.asyncProperty(
        bytesAround(VALID),
        fc.constantFrom('Nationals', 'Masters', 'New Meet', 'constructor', 'toString'),
        fc.integer({ min: 0, max: 4_102_444_800_000 }),
        async (bytes, meet, now) => {
          await AsyncStorage.clear();
          await AsyncStorage.setItem(CACHE_INFO_KEY, bytes);
          jest.useFakeTimers({ now });
          await touchMeetAccess(meet);
          jest.useRealTimers();

          const info = stored(CACHE_INFO_KEY) as { totalSize: unknown; meets: Record<string, unknown> };
          expect(Number.isFinite(info.totalSize)).toBe(true);
          expect(info.meets !== null && typeof info.meets === 'object' && !Array.isArray(info.meets)).toBe(true);
          for (const entry of Object.values(info.meets)) {
            const { lastAccessed, size } = entry as { lastAccessed: unknown; size: unknown };
            expect(Number.isFinite(lastAccessed) && (lastAccessed as number) >= 0).toBe(true);
            expect(Number.isFinite(size) && (size as number) >= 0).toBe(true);
          }
          expect(Object.prototype.hasOwnProperty.call(info.meets, meet)).toBe(true);
          expect((info.meets[meet] as { lastAccessed: number }).lastAccessed).toBe(now);
        },
      ),
    );
  });
});

describe('pruneHistorySyncedAt', () => {
  it('keeps exactly the stamps younger than the TTL, under any clock', () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ maxLength: 8 }), fc.integer({ min: -4e12, max: 8e12 })),
        fc.integer({ min: 0, max: 4_102_444_800_000 }),
        (stamps, now) => {
          const kept = pruneHistorySyncedAt(stamps, now);
          for (const [meet, at] of Object.entries(stamps)) {
            if (now - at < HISTORY_REFRESH_TTL_MS) expect(kept[meet]).toBe(at);
            else expect(Object.prototype.hasOwnProperty.call(kept, meet)).toBe(false);
          }
          for (const meet of Object.keys(kept)) {
            expect(Object.prototype.hasOwnProperty.call(stamps, meet)).toBe(true);
          }
        },
      ),
    );
  });
});
