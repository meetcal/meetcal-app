import AsyncStorage from '@react-native-async-storage/async-storage';
import * as fc from 'fast-check';
import { touchMeetAccess } from '@/lib/database/meet-cache-eviction';
import { corruptedArb, hostileStringArb } from '@/test-support/arbitraries';

jest.mock('@/lib/networkUtils', () => ({ isNetworkAvailable: jest.fn(async () => true) }));

jest.mock('@/lib/database/queries', () => ({
  fetchSchedule: jest.fn(async () => []),
  fetchAthletesWithSession: jest.fn(async () => []),
}));

const CACHE_INFO_KEY = '@meet_cache_info';

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
