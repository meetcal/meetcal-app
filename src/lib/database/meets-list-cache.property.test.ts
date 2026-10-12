import AsyncStorage from '@react-native-async-storage/async-storage';
import * as fc from 'fast-check';

import type { Meet } from '@/data/types/meet';
import {
  getCachedMeetByName,
  getCachedMeets,
  MEETS_LIST_CACHE_KEY,
  setCachedMeets,
} from '@/lib/database/meets-list-cache';
import { corruptedArb, hostileStringArb, timeZoneArb } from '@/test-support/arbitraries';
import { faultPlanArb, installStorageChaos, storageFaultArb } from '@/test-support/chaos';

/**
 * The cached `/meets` list is the offline source for the meet picker and
 * every meet-local time conversion. Whatever is on disk, a read is a list of
 * meets a screen can render, or an empty list; never a throw.
 */

const meet = (name: string, timeZoneIdentifier = 'America/New_York'): Meet =>
  ({
    id: name,
    name,
    venue: { name: 'V', address: { street: 's', city: 'c', state: 'OH', zip: '43215' } },
    time: { timeZone: 'Eastern', timeZoneIdentifier, abbreviation: 'EDT', utcOffset: 4 },
    dates: { start: '2026-06-20', end: '2026-06-21' },
    status: 'upcoming',
  }) as Meet;

const VALID_LIST = [meet('Nationals'), meet('Masters', 'America/Denver')];

const storedBytesArb: fc.Arbitrary<string> = fc.oneof(
  hostileStringArb,
  fc.jsonValue({ maxDepth: 3 }).map((value) => JSON.stringify(value)),
  corruptedArb(VALID_LIST).map((value) => JSON.stringify(value) ?? ''),
);

/** What every screen dereferences on a cached meet without a guard. */
function assertRenderable(value: Meet): void {
  expect(typeof value.name).toBe('string');
  expect(value.name.length).toBeGreaterThan(0);
  expect(value.dates !== null && typeof value.dates === 'object').toBe(true);
  expect(typeof value.dates.start).toBe('string');
  expect(typeof value.dates.end).toBe('string');
  expect(value.time !== null && typeof value.time === 'object').toBe(true);
  expect(isRuntimeTimeZone(value.time.timeZoneIdentifier)).toBe(true);
}

function isRuntimeTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('cached meets list', () => {
  it('reads any stored bytes as renderable meets, in stored order, or as none', async () => {
    await fc.assert(
      fc.asyncProperty(storedBytesArb, async (bytes) => {
        await AsyncStorage.clear();
        await AsyncStorage.setItem(MEETS_LIST_CACHE_KEY, bytes);
        const meets = await getCachedMeets();
        expect(Array.isArray(meets)).toBe(true);
        meets.forEach(assertRenderable);

        let parsed: unknown = null;
        try {
          parsed = JSON.parse(bytes);
        } catch {
          // Unparseable: must read as empty, checked below.
        }
        if (!Array.isArray(parsed)) {
          expect(meets).toEqual([]);
          return;
        }
        // The meets returned are stored rows, unchanged, in their order.
        let cursor = 0;
        for (const row of meets) {
          while (cursor < parsed.length && JSON.stringify(parsed[cursor]) !== JSON.stringify(row)) cursor += 1;
          expect(cursor).toBeLessThan(parsed.length);
          cursor += 1;
        }
      }),
    );
  });

  it('a lookup by name over any stored bytes finds a renderable meet or null, never throws', async () => {
    await fc.assert(
      fc.asyncProperty(storedBytesArb, fc.oneof(fc.constantFrom('Nationals', 'Masters'), hostileStringArb), async (bytes, name) => {
        await AsyncStorage.clear();
        await AsyncStorage.setItem(MEETS_LIST_CACHE_KEY, bytes);
        const found = await getCachedMeetByName(name);
        if (found !== null) {
          assertRenderable(found);
          expect(found.name).toBe(name);
        }
      }),
    );
  });

  it('round-trips a list and never throws under storage faults', async () => {
    await fc.assert(
      fc.asyncProperty(faultPlanArb(storageFaultArb, 3), async (plan) => {
        await AsyncStorage.clear();
        const chaos = installStorageChaos(plan);
        let meets: Meet[];
        try {
          await setCachedMeets(VALID_LIST);
          meets = await getCachedMeets();
        } finally {
          chaos.restore();
        }
        meets.forEach(assertRenderable);
        if (plan.every((fault) => fault.kind === 'pass')) expect(meets).toEqual(VALID_LIST);
      }),
    );
  });

  // Regression: `isCachedMeet` used to accept any string zone, so a corrupted
  // row reached `components/saved/SessionCard.tsx`, whose
  // `toLocaleDateString({ timeZone })` throws a RangeError mid-render for an
  // unknown id (`"__proto__"`). The API mapper never writes one (`mapApiMeet`
  // falls back to a known zone), so such a row now reads as a miss.
  it('only returns meets whose time zone the runtime can format in', async () => {
    const zoneArb = fc.oneof(timeZoneArb, hostileStringArb);
    await fc.assert(
      fc.asyncProperty(fc.array(zoneArb, { minLength: 1, maxLength: 3 }), async (zones) => {
        await AsyncStorage.clear();
        const list = zones.map((zone, i) => meet(`Meet ${i}`, zone));
        await AsyncStorage.setItem(MEETS_LIST_CACHE_KEY, JSON.stringify(list));
        for (const cached of await getCachedMeets()) {
          expect(isRuntimeTimeZone(cached.time.timeZoneIdentifier)).toBe(true);
        }
      }),
    );
  });

  // The counterexamples of the regression above (seed 1047305090 shrank to `""`).
  it('drops a cached meet whose time zone is not a zone', async () => {
    await AsyncStorage.setItem(
      MEETS_LIST_CACHE_KEY,
      JSON.stringify([meet('Nationals', '__proto__'), meet('Open', ''), meet('Masters', 'America/Denver')]),
    );
    expect((await getCachedMeets()).map((m) => m.name)).toEqual(['Masters']);
  });
});
