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

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('keeps an athlete history under the folded name', async () => {
  await saveBrowsedAthleteResults('Jane  Lifter', [result('Jane Lifter', 'Meet A')]);
  await expect(readBrowsedAthleteResults('jane lifter')).resolves.toEqual([result('Jane Lifter', 'Meet A')]);
});

it(`keeps only the ${MAX_BROWSED_ATHLETES} most recently opened athletes`, async () => {
  for (let index = 0; index <= MAX_BROWSED_ATHLETES; index += 1) {
    await saveBrowsedAthleteResults(`Lifter ${index}`, [result(`Lifter ${index}`, 'Meet')]);
  }
  await expect(readBrowsedAthleteResults('Lifter 0')).resolves.toBeNull();
  await expect(readBrowsedAthleteResults(`Lifter ${MAX_BROWSED_ATHLETES}`)).resolves.toHaveLength(1);
});

it('keeps nothing for an empty history or a blank name', async () => {
  await saveBrowsedAthleteResults('Jane Lifter', []);
  await saveBrowsedAthleteResults('  ', [result('x', 'Meet')]);
  await expect(readBrowsedAthleteResults('Jane Lifter')).resolves.toBeNull();
  await expect(AsyncStorage.getItem(OFFLINE_CACHE_KEYS.athleteResultsBrowse)).resolves.toBeNull();
});

it('drops malformed stored rows and reads a corrupt entry as nothing', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  const stored = [{ key: 'jane lifter', data: [result('Jane Lifter', 'Meet A'), 7, null], lastSynced: 1 }];
  await AsyncStorage.setItem(OFFLINE_CACHE_KEYS.athleteResultsBrowse, JSON.stringify({ data: stored, lastSynced: 1 }));
  await expect(readBrowsedAthleteResults('Jane Lifter')).resolves.toEqual([result('Jane Lifter', 'Meet A')]);

  const corrupt = [{ key: 'jane lifter', data: 'not rows', lastSynced: 1 }];
  await AsyncStorage.setItem(OFFLINE_CACHE_KEYS.athleteResultsBrowse, JSON.stringify({ data: corrupt, lastSynced: 1 }));
  await expect(readBrowsedAthleteResults('Jane Lifter')).resolves.toBeNull();
});

it('is cleared with the other browse caches', async () => {
  expect(BROWSE_CACHE_KEYS).toContain(OFFLINE_CACHE_KEYS.athleteResultsBrowse);
  await saveBrowsedAthleteResults('Jane Lifter', [result('Jane Lifter', 'Meet A')]);
  await clearBrowseCaches();
  await expect(readBrowsedAthleteResults('Jane Lifter')).resolves.toBeNull();
});
