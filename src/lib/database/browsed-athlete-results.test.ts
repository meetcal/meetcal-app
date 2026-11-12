import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  MAX_BROWSED_ATHLETES,
  readBrowsedAthleteResults,
  saveBrowsedAthleteResults,
} from '@/lib/database/browsed-athlete-results';
import { BROWSE_CACHE_KEYS, clearBrowseCaches, OFFLINE_CACHE_KEYS } from '@/lib/database/offline-cache';
import type { AthleteMeetResult } from '@/types/athlete-results';

function result(name: string, meet: string): AthleteMeetResult {
  return {
    event_id: `${meet}-${name}`,
    meet,
    date: '2026-06-20',
    name,
    age: 30,
    body_weight: 88,
    snatch1: 100,
    snatch2: null,
    snatch3: null,
    snatch_best: 100,
    cj1: 120,
    cj2: null,
    cj3: null,
    cj_best: 120,
    total: 220,
  };
}

const DETAILS = { lifter: { id: '20730', name: 'Jane Lifter', label: 'Age 37' }, prs: { snatch: 0, cj: 0, total: 0 } };

const rowsOf = (saved: Awaited<ReturnType<typeof readBrowsedAthleteResults>>) => saved?.rows ?? null;

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('keeps an athlete history under the folded name', async () => {
  await saveBrowsedAthleteResults({ name: 'Jane  Lifter' }, [result('Jane Lifter', 'Meet A')], DETAILS);
  await expect(readBrowsedAthleteResults({ name: 'jane lifter' })).resolves.toEqual({ rows: [result('Jane Lifter', 'Meet A')], details: DETAILS });
});

it('keeps one lifter of a shared name, and the results no lifter holds, apart from the name', async () => {
  await saveBrowsedAthleteResults({ name: 'Jane Lifter', lifter: '20730' }, [result('Jane Lifter', 'Their Meet')], DETAILS);
  await saveBrowsedAthleteResults({ name: 'Jane Lifter', other: true }, [result('Jane Lifter', 'Unheld Meet')], { lifter: null, prs: DETAILS.prs });
  await expect(readBrowsedAthleteResults({ name: 'Jane Lifter' })).resolves.toBeNull();
  expect(rowsOf(await readBrowsedAthleteResults({ name: 'jane lifter', lifter: '20730' }))?.map((r) => r.meet)).toEqual(['Their Meet']);
  expect(rowsOf(await readBrowsedAthleteResults({ name: 'Jane Lifter', other: true }))?.map((r) => r.meet)).toEqual(['Unheld Meet']);
});

it('reads a history saved as plain rows by an older build, without PR marks', async () => {
  const stored = [{ key: 'jane lifter', data: [result('Jane Lifter', 'Meet A')], lastSynced: 1 }];
  await AsyncStorage.setItem(OFFLINE_CACHE_KEYS.athleteResultsBrowse, JSON.stringify({ data: stored, lastSynced: 1 }));
  await expect(readBrowsedAthleteResults({ name: 'Jane Lifter' })).resolves.toEqual({ rows: [result('Jane Lifter', 'Meet A')], details: null });
});

it(`keeps only the ${MAX_BROWSED_ATHLETES} most recently opened athletes`, async () => {
  for (let index = 0; index <= MAX_BROWSED_ATHLETES; index += 1) {
    await saveBrowsedAthleteResults({ name: `Lifter ${index}` }, [result(`Lifter ${index}`, 'Meet')], DETAILS);
  }
  await expect(readBrowsedAthleteResults({ name: 'Lifter 0' })).resolves.toBeNull();
  expect(rowsOf(await readBrowsedAthleteResults({ name: `Lifter ${MAX_BROWSED_ATHLETES}` }))).toHaveLength(1);
});

it('keeps nothing for an empty history or a blank name', async () => {
  await saveBrowsedAthleteResults({ name: 'Jane Lifter' }, [], DETAILS);
  await saveBrowsedAthleteResults({ name: '  ' }, [result('x', 'Meet')], DETAILS);
  await expect(readBrowsedAthleteResults({ name: 'Jane Lifter' })).resolves.toBeNull();
  await expect(AsyncStorage.getItem(OFFLINE_CACHE_KEYS.athleteResultsBrowse)).resolves.toBeNull();
});

it('drops malformed stored rows and reads a corrupt entry as nothing', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  const stored = [{ key: 'jane lifter', data: [result('Jane Lifter', 'Meet A'), 7, null], lastSynced: 1 }];
  await AsyncStorage.setItem(OFFLINE_CACHE_KEYS.athleteResultsBrowse, JSON.stringify({ data: stored, lastSynced: 1 }));
  expect(rowsOf(await readBrowsedAthleteResults({ name: 'Jane Lifter' }))).toEqual([result('Jane Lifter', 'Meet A')]);

  const corrupt = [{ key: 'jane lifter', data: 'not rows', lastSynced: 1 }];
  await AsyncStorage.setItem(OFFLINE_CACHE_KEYS.athleteResultsBrowse, JSON.stringify({ data: corrupt, lastSynced: 1 }));
  await expect(readBrowsedAthleteResults({ name: 'Jane Lifter' })).resolves.toBeNull();
});

it('is cleared with the other browse caches', async () => {
  expect(BROWSE_CACHE_KEYS).toContain(OFFLINE_CACHE_KEYS.athleteResultsBrowse);
  await saveBrowsedAthleteResults({ name: 'Jane Lifter' }, [result('Jane Lifter', 'Meet A')], DETAILS);
  await clearBrowseCaches();
  await expect(readBrowsedAthleteResults({ name: 'Jane Lifter' })).resolves.toBeNull();
});
