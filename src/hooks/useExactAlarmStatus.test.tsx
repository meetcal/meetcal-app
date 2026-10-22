import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, create } from 'react-test-renderer';

import { useExactAlarmStatus } from './useExactAlarmStatus';
import { type ExactAlarmStatus, readExactAlarmStatus } from '@/lib/exact-alarms';

jest.mock('@/lib/exact-alarms', () => ({
  readExactAlarmStatus: jest.fn(),
}));

const mockRead = readExactAlarmStatus as jest.MockedFunction<typeof readExactAlarmStatus>;

let seen: (ExactAlarmStatus | null)[] = [];
function Harness() {
  seen.push(useExactAlarmStatus());
  return null;
}

let listener: ((state: AppStateStatus) => void) | undefined;
const remove = jest.fn();

function deferred() {
  let resolve!: (status: ExactAlarmStatus) => void;
  const promise = new Promise<ExactAlarmStatus>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
  seen = [];
  listener = undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    listener = handler as (state: AppStateStatus) => void;
    return { remove } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('reads at mount and again on each return to the foreground', async () => {
  mockRead.mockResolvedValueOnce('denied').mockResolvedValueOnce('granted');
  await act(async () => {
    create(<Harness />);
  });
  expect(seen.at(-1)).toBe('denied');

  await act(async () => listener?.('background'));
  expect(mockRead).toHaveBeenCalledTimes(1);
  await act(async () => listener?.('active'));
  expect(mockRead).toHaveBeenCalledTimes(2);
  expect(seen.at(-1)).toBe('granted');
});

it('keeps the latest read when an older one lands after it', async () => {
  const first = deferred();
  const second = deferred();
  mockRead.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  await act(async () => {
    create(<Harness />);
  });
  await act(async () => listener?.('active'));

  await act(async () => second.resolve('granted'));
  await act(async () => first.resolve('denied'));

  expect(seen.at(-1)).toBe('granted');
});

it('stops listening, and drops a read in flight, at unmount', async () => {
  const pending = deferred();
  mockRead.mockReturnValueOnce(pending.promise);
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<Harness />);
  });
  await act(async () => tree.unmount());
  expect(remove).toHaveBeenCalledTimes(1);

  const rendersBefore = seen.length;
  await act(async () => pending.resolve('denied'));
  expect(seen).toHaveLength(rendersBefore);
  expect(seen.at(-1)).toBeNull();
});
