import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import { RESUME_RECYCLE_AFTER_MS, watchConnectionLifecycle } from './connection-lifecycle';

type NetListener = (state: { isConnected: boolean | null; isInternetReachable: boolean | null; type: string }) => void;
type AppListener = (status: string) => void;

describe('watchConnectionLifecycle', () => {
  let network: NetListener;
  let appState: AppListener;
  let recycle: jest.Mock;
  let stop: () => void;
  const unsubscribeNetwork = jest.fn();
  const removeAppState = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(NetInfo, 'addEventListener').mockImplementation((listener) => {
      network = listener as unknown as NetListener;
      return unsubscribeNetwork;
    });
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      appState = listener as unknown as AppListener;
      return { remove: removeAppState } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
    recycle = jest.fn();
    stop = watchConnectionLifecycle(recycle);
  });

  afterEach(() => {
    stop();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const online = (type = 'wifi') => network({ isConnected: true, isInternetReachable: true, type });
  const offline = () => network({ isConnected: false, isInternetReachable: false, type: 'none' });

  it('does not recycle on the first report or while nothing changes', () => {
    online();
    online();
    expect(recycle).not.toHaveBeenCalled();
  });

  it('recycles when the network comes back', () => {
    online();
    offline();
    expect(recycle).not.toHaveBeenCalled();
    online();
    expect(recycle).toHaveBeenCalledTimes(1);
  });

  it('recycles when the device moves to another network', () => {
    online('wifi');
    online('cellular');
    expect(recycle).toHaveBeenCalledTimes(1);
  });

  it('recycles on a return from a long spell in the background, not a short one', () => {
    appState('background');
    jest.advanceTimersByTime(RESUME_RECYCLE_AFTER_MS - 1000);
    appState('active');
    expect(recycle).not.toHaveBeenCalled();

    appState('background');
    appState('inactive');
    jest.advanceTimersByTime(RESUME_RECYCLE_AFTER_MS);
    appState('active');
    expect(recycle).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes both listeners', () => {
    stop();
    expect(unsubscribeNetwork).toHaveBeenCalled();
    expect(removeAppState).toHaveBeenCalled();
  });
});
