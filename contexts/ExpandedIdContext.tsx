import React, { createContext, useCallback, useContext, useState, useSyncExternalStore } from 'react';

/**
 * Which start-list row is expanded, as a tiny external store.
 *
 * Every row used to read `{ expandedId, setExpandedId }` from context, so one
 * tap re-rendered every mounted `AthleteItem` through `React.memo` (20 of 20
 * in the regression test) to change two of them. Rows now subscribe to a
 * boolean — "am I the expanded one?" — so a tap re-renders only the row that
 * opens and the row that closes.
 */
type ExpandedStore = {
  get: () => string | null;
  set: (next: string | null) => void;
  subscribe: (listener: () => void) => () => void;
};

function createExpandedStore(): ExpandedStore {
  let expandedId: string | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => expandedId,
    set: (next) => {
      if (next === expandedId) return;
      expandedId = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const ExpandedIdContext = createContext<ExpandedStore | undefined>(undefined);

export function ExpandedIdProvider({ children }: { children: React.ReactNode }) {
  // One store per provider, stable for its lifetime: the context value never
  // changes, so no row re-renders because the provider did.
  const [store] = useState(createExpandedStore);

  return (
    <ExpandedIdContext.Provider value={store}>
      {children}
    </ExpandedIdContext.Provider>
  );
}

/**
 * Whether the row `key` is expanded, and a toggle for it. `toggle` returns
 * `true` when it expanded the row. Re-renders the caller only when its own
 * expanded state flips.
 */
export function useExpandedRow(key: string): {
  isExpanded: boolean;
  toggle: () => boolean;
} {
  const store = useContext(ExpandedIdContext);
  if (store === undefined) {
    throw new Error('useExpandedRow must be used within an ExpandedIdProvider');
  }
  const isExpanded = useSyncExternalStore(
    store.subscribe,
    () => store.get() === key,
    () => store.get() === key,
  );
  const toggle = useCallback(() => {
    const willExpand = store.get() !== key;
    store.set(willExpand ? key : null);
    return willExpand;
  }, [store, key]);
  return { isExpanded, toggle };
}
