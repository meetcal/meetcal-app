import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, create } from 'react-test-renderer';

import { useDataWidgetRefresh } from './useDataWidgetRefresh';
import { refreshDataWidgets } from '@/lib/data-widgets-refresh';

jest.mock('@/lib/data-widgets-refresh', () => ({
  refreshDataWidgets: jest.fn(async () => 'synced'),
}));

it('refreshes at mount and on each return to the foreground, and stops at unmount', () => {
  let listener: ((state: AppStateStatus) => void) | undefined;
  const remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    listener = handler as (state: AppStateStatus) => void;
    return { remove } as unknown as ReturnType<typeof AppState.addEventListener>;
  });

  function Harness() {
    useDataWidgetRefresh();
    return null;
  }

  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<Harness />);
  });
  expect(refreshDataWidgets).toHaveBeenCalledTimes(1);

  act(() => listener?.('background'));
  expect(refreshDataWidgets).toHaveBeenCalledTimes(1);
  act(() => listener?.('active'));
  expect(refreshDataWidgets).toHaveBeenCalledTimes(2);

  act(() => tree.unmount());
  expect(remove).toHaveBeenCalledTimes(1);
});
