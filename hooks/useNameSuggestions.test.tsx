import React from 'react';
import { act, create } from 'react-test-renderer';
import {
  filterNameSuggestions,
  MAX_NAME_SUGGESTIONS,
  SUGGESTION_DEBOUNCE_MS,
  useNameSuggestions,
} from './useNameSuggestions';

type Pending = { query: string; resolve: (names: string[]) => void; reject: (e: unknown) => void };

let pending: Pending[] = [];
const fetchNames = jest.fn(
  (query: string) =>
    new Promise<string[]>((resolve, reject) => {
      pending.push({ query, resolve, reject });
    }),
);

let hook!: ReturnType<typeof useNameSuggestions>;
function Harness() {
  hook = useNameSuggestions(fetchNames);
  return null;
}

let tree!: ReturnType<typeof create>;

function type(text: string) {
  act(() => {
    hook.onQueryChange(text);
  });
}

function pauseTyping() {
  act(() => {
    jest.advanceTimersByTime(SUGGESTION_DEBOUNCE_MS);
  });
}

async function answer(query: string, names: string[]) {
  const request = pending.find((p) => p.query === query);
  if (!request) throw new Error(`no request for ${query}`);
  await act(async () => {
    request.resolve(names);
  });
}

describe('useNameSuggestions', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    pending = [];
    fetchNames.mockClear();
    act(() => {
      tree = create(<Harness />);
    });
  });

  afterEach(() => {
    act(() => {
      tree.unmount();
    });
    jest.useRealTimers();
  });

  it('sends one request per typing pause, not per keystroke', () => {
    for (const text of ['john', 'john ', 'john s', 'john sm']) type(text);
    expect(fetchNames).not.toHaveBeenCalled();
    pauseTyping();
    expect(fetchNames).toHaveBeenCalledTimes(1);
    expect(fetchNames).toHaveBeenCalledWith('john sm');
  });

  it('does not query below the minimum length', () => {
    type('joh');
    pauseTyping();
    expect(fetchNames).not.toHaveBeenCalled();
  });

  // Out-of-order answers: the older, slower request must not paint over the
  // newer one.
  it('ignores an answer for a query the user has typed past', async () => {
    type('john');
    pauseTyping();
    type('john smi');
    pauseTyping();
    expect(fetchNames).toHaveBeenCalledTimes(2);

    await answer('john smi', ['John Smith']);
    expect(hook.suggestions).toEqual(['John Smith']);
    expect(hook.loadingSuggestions).toBe(false);

    await answer('john', ['John Adams', 'John Smith', 'Johnny Doe']);
    expect(hook.suggestions).toEqual(['John Smith']);
  });

  it('does not reopen the dropdown after a suggestion was picked', async () => {
    type('john');
    pauseTyping();
    act(() => {
      hook.dismissSuggestions();
    });
    await answer('john', ['John Smith']);
    expect(hook.showSuggestions).toBe(false);
    expect(hook.loadingSuggestions).toBe(false);
  });

  it('drops a lookup still waiting on the debounce when dismissed or unmounted', () => {
    type('john');
    act(() => {
      hook.dismissSuggestions();
    });
    pauseTyping();
    type('jane');
    act(() => {
      tree.unmount();
    });
    pauseTyping();
    expect(fetchNames).not.toHaveBeenCalled();
    // afterEach unmounts again; give it a fresh tree.
    act(() => {
      tree = create(<Harness />);
    });
  });

  it('clears suggestions when the request fails', async () => {
    type('john');
    pauseTyping();
    await answer('john', ['John Smith']);
    type('john q');
    pauseTyping();
    await act(async () => {
      pending.find((p) => p.query === 'john q')!.reject(new Error('offline'));
    });
    expect(hook.suggestions).toEqual([]);
    expect(hook.loadingSuggestions).toBe(false);
  });

  // A stale failure is as out of order as a stale success: it must not wipe
  // the newer query's names or stop its spinner early.
  it('ignores a failure for a query the user has typed past', async () => {
    type('john');
    pauseTyping();
    type('john smi');
    pauseTyping();
    type('john smit');
    pauseTyping();
    expect(fetchNames).toHaveBeenCalledTimes(3);

    // Older request fails while the newest is still in flight: spinner stays.
    await act(async () => {
      pending.find((p) => p.query === 'john')!.reject(new Error('timeout'));
    });
    expect(hook.loadingSuggestions).toBe(true);

    await answer('john smit', ['John Smith']);
    expect(hook.suggestions).toEqual(['John Smith']);

    // Older request fails after the newest painted: its names stay.
    await act(async () => {
      pending.find((p) => p.query === 'john smi')!.reject(new Error('late'));
    });
    expect(hook.suggestions).toEqual(['John Smith']);
    expect(hook.loadingSuggestions).toBe(false);
  });

  it('closes the dropdown when the query drops below the minimum', async () => {
    type('john');
    pauseTyping();
    await answer('john', ['John Smith']);
    expect(hook.showSuggestions).toBe(true);
    type('jo');
    expect(hook.showSuggestions).toBe(false);
    expect(hook.loadingSuggestions).toBe(false);
  });
});

describe('filterNameSuggestions', () => {
  it('keeps names containing every query word, capped', () => {
    const names = Array.from({ length: 20 }, (_, i) => `John Smith ${i}`);
    expect(filterNameSuggestions(['John Smith', 'Jane Smith', 'Smith, John'], 'smith john')).toEqual([
      'John Smith',
      'Smith, John',
    ]);
    expect(filterNameSuggestions(names, 'john')).toHaveLength(MAX_NAME_SUGGESTIONS);
  });
});
