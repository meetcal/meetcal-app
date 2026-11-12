import type { AthleteMeetResult } from '@/data/types/athletes';
import { historyForNames, startEarlyHistory } from '@/lib/session-history';

const row = (name: string, meet = 'Meet') => ({ name, meet, date: '2026-01-01' }) as unknown as AthleteMeetResult;

describe('session history read alongside the session athletes', () => {
  it('asks once for the cached names, before the fresh athletes are known', () => {
    const fetch = jest.fn(async () => [row('A Lifter')]);
    startEarlyHistory(['A Lifter', ' ', 'A Lifter', 'B Lifter'], fetch);
    expect(fetch).toHaveBeenCalledWith(['A Lifter', 'B Lifter']);
    expect(startEarlyHistory(['', '  '], fetch)).toBeNull();
  });

  it('answers from the early read when the fresh session holds the same athletes', async () => {
    const fetch = jest.fn(async (names: string[]) => names.map((name) => row(name)));
    const early = startEarlyHistory(['A Lifter', 'B Lifter'], fetch);
    await expect(historyForNames(['a lifter', 'B  Lifter'], early, fetch)).resolves.toEqual([row('A Lifter'), row('B Lifter')]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('asks only for the athletes the early read did not cover, and leaves out those who left', async () => {
    const fetch = jest.fn(async (names: string[]) => names.map((name) => row(name)));
    const early = startEarlyHistory(['A Lifter', 'Gone Lifter'], fetch);
    await expect(historyForNames(['A Lifter', 'New Lifter'], early, fetch)).resolves.toEqual([row('A Lifter'), row('New Lifter')]);
    expect(fetch).toHaveBeenLastCalledWith(['New Lifter']);
  });

  it('asks for every athlete when the early read failed or never ran', async () => {
    const failing = jest.fn(async () => {
      throw new Error('Network request failed');
    });
    const early = startEarlyHistory(['A Lifter'], failing);
    const fetch = jest.fn(async (names: string[]) => names.map((name) => row(name)));
    await expect(historyForNames(['A Lifter'], early, fetch)).resolves.toEqual([row('A Lifter')]);
    await expect(historyForNames(['B Lifter'], null, fetch)).resolves.toEqual([row('B Lifter')]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
