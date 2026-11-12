import AsyncStorage from '@react-native-async-storage/async-storage';
import * as fc from 'fast-check';
import { HISTORY_REFRESH_TTL_MS, pruneHistorySyncedAt } from '@/lib/database/history-download-state';

jest.mock('@/lib/networkUtils', () => ({ isNetworkAvailable: jest.fn(async () => true) }));

jest.mock('@/lib/database/queries', () => ({
  fetchSchedule: jest.fn(async () => []),
  fetchAthletesWithSession: jest.fn(async () => []),
}));

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
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
