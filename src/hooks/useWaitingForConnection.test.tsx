import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';

import { WAITING_FOR_CONNECTION_AFTER_MS } from '@/lib/api/network-policy';
import { LoadingLabel } from '@/components/ui/LoadingLabel';
import { useWaitingForConnection, WAITING_FOR_CONNECTION_LABEL } from './useWaitingForConnection';

function Probe({ waiting }: { waiting: boolean }) {
  return <Text>{useWaitingForConnection(waiting) ? 'waited' : 'not yet'}</Text>;
}

function textOf(renderer: ReactTestRenderer): string {
  return renderer.root.findAllByType(Text).map((node) => String(node.props.children)).join('|');
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('says nothing until the wait passes, then says it is waiting for the connection', () => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<Probe waiting />);
  });
  act(() => jest.advanceTimersByTime(WAITING_FOR_CONNECTION_AFTER_MS - 1));
  expect(textOf(renderer)).toBe('not yet');
  act(() => jest.advanceTimersByTime(1));
  expect(textOf(renderer)).toBe('waited');
});

it('clears once data stops being awaited, and starts the wait over the next time', () => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<Probe waiting />);
  });
  act(() => jest.advanceTimersByTime(WAITING_FOR_CONNECTION_AFTER_MS));
  act(() => renderer.update(<Probe waiting={false} />));
  expect(textOf(renderer)).toBe('not yet');
  act(() => renderer.update(<Probe waiting />));
  expect(textOf(renderer)).toBe('not yet');
  act(() => jest.advanceTimersByTime(WAITING_FOR_CONNECTION_AFTER_MS));
  expect(textOf(renderer)).toBe('waited');
});

it('turns the loading label into the waiting label, and hides an empty label until then', () => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <>
        <LoadingLabel />
        <LoadingLabel label="" />
      </>,
    );
  });
  expect(textOf(renderer)).toBe('Loading...');
  act(() => jest.advanceTimersByTime(WAITING_FOR_CONNECTION_AFTER_MS));
  expect(textOf(renderer)).toBe(`${WAITING_FOR_CONNECTION_LABEL}|${WAITING_FOR_CONNECTION_LABEL}`);
});
