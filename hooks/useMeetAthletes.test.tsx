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
  act(() => { tree.unmount(); });
});
