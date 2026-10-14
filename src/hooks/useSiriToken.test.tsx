import React from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { syncSiriToken } from '@/lib/siri-token';
import { useSiriToken } from './useSiriToken';

const mockAuth = { isLoaded: true as boolean, isSignedIn: true as boolean, userId: 'user_a' as string | null, getToken: jest.fn(async () => 'clerk-token') };
const mockSubscription: { isSubscribed: boolean | null } = { isSubscribed: true };

jest.mock('@clerk/expo', () => ({ useAuth: () => mockAuth }));
jest.mock('@/contexts/SubscriptionContext', () => ({ useSubscription: () => mockSubscription }));
jest.mock('@/lib/siri-token', () => ({ syncSiriToken: jest.fn(async () => {}) }));

function Harness() {
  useSiriToken();
  return null;
}

let tree: ReactTestRenderer | null = null;
const render = () =>
  act(() => {
    if (tree) tree.update(<Harness />);
    else tree = create(<Harness />);
  });

let listener: ((state: AppStateStatus) => void) | undefined;
const originalOS = Platform.OS;

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  mockAuth.isLoaded = true;
  mockAuth.isSignedIn = true;
  mockAuth.userId = 'user_a';
  mockSubscription.isSubscribed = true;
  listener = undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    listener = handler as (state: AppStateStatus) => void;
    return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
});

afterEach(() => {
  act(() => tree?.unmount());
  tree = null;
  Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS });
});

const lastState = () => jest.mocked(syncSiriToken).mock.calls.at(-1)?.[0];

describe('useSiriToken', () => {
  it('checks the token at mount, on each change of user or subscription, and on return to the foreground', async () => {
    render();
    expect(lastState()).toMatchObject({ isLoaded: true, userId: 'user_a', subscribed: true });
    await expect(lastState()?.getClerkToken()).resolves.toBe('clerk-token');

    act(() => listener?.('background'));
    expect(syncSiriToken).toHaveBeenCalledTimes(1);
    act(() => listener?.('active'));
    expect(syncSiriToken).toHaveBeenCalledTimes(2);

    mockAuth.isSignedIn = false;
    mockAuth.userId = null;
    render();
    expect(syncSiriToken).toHaveBeenCalledTimes(3);
    expect(lastState()).toMatchObject({ userId: null });
  });

  it('passes only a confirmed subscription, and no user while Clerk loads', () => {
    mockSubscription.isSubscribed = null;
    mockAuth.isLoaded = false;
    render();
    expect(lastState()).toMatchObject({ isLoaded: false, userId: null, subscribed: false });
  });

  it('does nothing off iOS', () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    render();
    act(() => listener?.('active'));
    expect(syncSiriToken).not.toHaveBeenCalled();
  });
});
