import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, create } from 'react-test-renderer';

import { useDataWidgetRefresh } from './useDataWidgetRefresh';
import { refreshDataWidgets } from '@/lib/data-widgets-refresh';
import { syncPremiumEntitlementHint } from '@/utils/dataWidgets';

let mockIsSubscribed: boolean | null = true;
let mockIsLoading = false;

jest.mock('@/contexts/SubscriptionContext', () => ({
  useSubscription: () => ({ isSubscribed: mockIsSubscribed, isLoading: mockIsLoading }),
}));
jest.mock('@/lib/data-widgets-refresh', () => ({
  refreshDataWidgets: jest.fn(async () => 'synced'),
}));
jest.mock('@/utils/dataWidgets', () => ({
  syncPremiumEntitlementHint: jest.fn(),
}));

function Harness() {
  useDataWidgetRefresh();
  return null;
}

let listener: ((state: AppStateStatus) => void) | undefined;
const remove = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockIsSubscribed = true;
  mockIsLoading = false;
  listener = undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    listener = handler as (state: AppStateStatus) => void;
    return { remove } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
});

it('refreshes at mount and on each return to the foreground, and stops at unmount', () => {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<Harness />);
  });
  expect(refreshDataWidgets).toHaveBeenCalledTimes(1);
  expect(refreshDataWidgets).toHaveBeenLastCalledWith(true);

  act(() => listener?.('background'));
  expect(refreshDataWidgets).toHaveBeenCalledTimes(1);
  act(() => listener?.('active'));
  expect(refreshDataWidgets).toHaveBeenCalledTimes(2);

  act(() => tree.unmount());
  expect(remove).toHaveBeenCalledTimes(1);
});

it('mirrors the entitlement and refreshes the widgets as soon as RevenueCat answers', () => {
  mockIsSubscribed = null;
  mockIsLoading = true;
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<Harness />);
  });
  // Still loading: unknown is passed through, so the hint keeps its last
  // value and the refresher leaves the widgets alone.
  expect(syncPremiumEntitlementHint).toHaveBeenLastCalledWith(null);
  expect(refreshDataWidgets).toHaveBeenLastCalledWith(null);
  mockIsLoading = false;

  mockIsSubscribed = false;
  act(() => tree.update(<Harness />));
  expect(syncPremiumEntitlementHint).toHaveBeenLastCalledWith(false);
  expect(refreshDataWidgets).toHaveBeenLastCalledWith(false);

  // A purchase: written at once, not at the next foreground.
  mockIsSubscribed = true;
  act(() => tree.update(<Harness />));
  expect(syncPremiumEntitlementHint).toHaveBeenLastCalledWith(true);
  expect(refreshDataWidgets).toHaveBeenLastCalledWith(true);

  // The foreground refresh uses the latest answer.
  act(() => listener?.('active'));
  expect(refreshDataWidgets).toHaveBeenLastCalledWith(true);
  act(() => tree.unmount());
});

it('locks the widgets and Siri when the entitlement stays unknown after loading', () => {
  // Offline with no cache, or a failed check with none: the premium screens
  // don't open on that, so the native surfaces don't show the data either.
  mockIsSubscribed = null;
  mockIsLoading = false;
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<Harness />);
  });
  expect(syncPremiumEntitlementHint).toHaveBeenLastCalledWith(false);
  expect(refreshDataWidgets).toHaveBeenLastCalledWith(false);
  act(() => tree.unmount());
});
