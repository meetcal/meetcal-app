import React from 'react';
import { act, create } from 'react-test-renderer';
import { useSessionAthletes } from './useMeetAthletes';
import { getMeetData, getSessionAthletesFromMeetCache, saveSessionAthletes } from '@/lib/database/offline-store';
import { fetchAthletesWithSession } from '@/lib/database/queries';
import type { LiftResult } from '@/data/types/athletes';

jest.mock('@/lib/networkUtils', () => ({
  subscribeToNetworkChanges: jest.fn(() => () => {}),
}));
jest.mock('@/lib/database/offline-store', () => ({
  getMeetData: jest.fn(),
  getSessionAthletesFromMeetCache: jest.fn(async () => []),
  saveSessionAthletes: jest.fn(),
}));
jest.mock('@/lib/database/queries', () => ({
  fetchAthletesWithSession: jest.fn(async () => []),
}));

it('does not decode the full meet again after the session cache reader returns empty', async () => {
  let current!: ReturnType<typeof useSessionAthletes>;
  function Harness() {
    current = useSessionAthletes('Test Meet', 1, 'Red');
    return null;
  }
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(<Harness />); });
  expect(getSessionAthletesFromMeetCache).toHaveBeenCalledTimes(1);
  expect(getMeetData).not.toHaveBeenCalled();
  expect(fetchAthletesWithSession).toHaveBeenCalledTimes(1);
  expect(current.athletes).toEqual([]);
  expect(current.isLoading).toBe(false);
  // An empty answer is "no athletes", not a failure.
  expect(current.loadError).toBeNull();
  act(() => { tree.unmount(); });
});

// Regression: after an empty answer, a failed refresh was filed as a
// refresh error only, and the card kept treating the session as empty.
it('reports a failed refresh as a load failure after an empty answer', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  let current!: ReturnType<typeof useSessionAthletes>;
  function Harness() {
    current = useSessionAthletes('Empty Then Failed Meet', 3, 'Red');
    return null;
  }
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(<Harness />); });
  expect(current.athletes).toEqual([]);
  expect(current.loadError).toBeNull();

  (fetchAthletesWithSession as jest.Mock).mockRejectedValueOnce(new Error('Offline'));
  await act(async () => { await current.refreshAthletes(); });

  expect(current.athletes).toEqual([]);
  expect(current.loadError).toBe('Offline');
  act(() => { tree.unmount(); });
  jest.restoreAllMocks();
});

// Regression: the hook dropped `error`, so a failed load made the whole
// "Session Athletes" card disappear as if the session had no one in it.
it('reports a failed load when nothing is cached', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  (fetchAthletesWithSession as jest.Mock).mockRejectedValueOnce(new Error('Offline'));
  let current!: ReturnType<typeof useSessionAthletes>;
  function Harness() {
    current = useSessionAthletes('Failed Meet', 2, 'Blue');
    return null;
  }
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(<Harness />); });
  expect(current.athletes).toEqual([]);
  expect(current.loadError).toBe('Offline');
  act(() => { tree.unmount(); });
  jest.restoreAllMocks();
});

// Regression (#313): an empty answer replaced the cached roster and was
// written over the session key, and the card vanished.
it('keeps the cached session athletes when the fresh answer is empty, and does not save it', async () => {
  const cached = [{ name: 'Cached Lifter', session: { number: 4, platform: 'Red' } }] as unknown as LiftResult[];
  (getSessionAthletesFromMeetCache as jest.Mock).mockResolvedValue(cached);
  (fetchAthletesWithSession as jest.Mock).mockResolvedValue([]);
  let current!: ReturnType<typeof useSessionAthletes>;
  function Harness() {
    current = useSessionAthletes('Reimport Meet', 4, 'Red');
    return null;
  }
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(<Harness />); });
  await act(async () => { await current.refreshAthletes(); });

  expect(fetchAthletesWithSession).toHaveBeenCalled();
  expect(current.athletes).toEqual(cached);
  expect(current.loadError).toBeNull();
  expect(saveSessionAthletes).not.toHaveBeenCalled();
  act(() => { tree.unmount(); });
  (getSessionAthletesFromMeetCache as jest.Mock).mockResolvedValue([]);
});
