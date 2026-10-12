import React from 'react';
import { act, create } from 'react-test-renderer';
import { useSessionAthletes } from './useMeetAthletes';
import { getMeetData, getSessionAthletesFromMeetCache } from '@/lib/database/offline-store';
import { fetchAthletesWithSession } from '@/lib/database/queries';

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
