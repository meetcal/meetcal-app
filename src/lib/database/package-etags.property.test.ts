import AsyncStorage from '@react-native-async-storage/async-storage';
import * as fc from 'fast-check';
import { getStoredPackageEtag, savePackageEtag } from '@/lib/database/package-etags';
import { corruptedArb, hostileStringArb } from '@/test-support/arbitraries';

jest.mock('@/lib/networkUtils', () => ({ isNetworkAvailable: jest.fn(async () => true) }));

jest.mock('@/lib/database/queries', () => ({
  fetchSchedule: jest.fn(async () => []),
  fetchAthletesWithSession: jest.fn(async () => []),
}));

const ETAG_KEY = '@meet_package_etag_v1';

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
        if (meet !== '__proto__') expect(await getStoredPackageEtag(meet)).toBe(etag);
      }),
    );
  });
});
