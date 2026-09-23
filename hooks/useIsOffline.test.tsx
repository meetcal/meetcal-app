import React from 'react';
import { act, create } from 'react-test-renderer';
import { useIsOffline } from './useIsOffline';
import { isNetworkAvailable, subscribeToNetworkChanges } from '@/lib/networkUtils';

jest.mock('@/lib/networkUtils', () => ({
  isNetworkAvailable: jest.fn(),
  subscribeToNetworkChanges: jest.fn(),
}));

it.each([true, false])('keeps the latest network event when the initial probe resolves %s', async (probeResult) => {
  let finishProbe!: (connected: boolean) => void;
  let notify!: (connected: boolean) => void;
  let offline = false;
  const unsubscribe = jest.fn();
  jest.mocked(isNetworkAvailable).mockReturnValue(new Promise((resolve) => {
    finishProbe = resolve;
  }));
  jest.mocked(subscribeToNetworkChanges).mockImplementation((listener) => {
    notify = listener;
    return unsubscribe;
  });
  function Harness() {
    [offline] = useIsOffline();
    return null;
  }
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<Harness />); });
  act(() => { notify(!probeResult); });
  expect(offline).toBe(probeResult);
  await act(async () => { finishProbe(probeResult); });
  expect(offline).toBe(probeResult);
  act(() => { tree.unmount(); });
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});
