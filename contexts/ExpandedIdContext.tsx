import React, { createContext, useContext, useState } from 'react';

type ExpandedIdContextType = {
  expandedId: string | null;
  setExpandedId: React.Dispatch<React.SetStateAction<string | null>>;
};

const ExpandedIdContext = createContext<ExpandedIdContextType | undefined>(undefined);

let _lastTapTime = 0;
export function recordExpandTapTime() {
  _lastTapTime = performance.now();
}

export function ExpandedIdProvider({ children }: { children: React.ReactNode }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  if (__DEV__ && _lastTapTime > 0) {
    const elapsed = performance.now() - _lastTapTime;
    console.log('[StartList] 1. Provider render', Math.round(elapsed), 'ms since tap');
    if (elapsed > 2000) {
      console.log('[StartList] Bottleneck: 0=tap, 1=Provider, 2=AthleteItem render, 3=commit. Whichever logs at ~10s is the cause.');
    }
    _lastTapTime = 0;
  }
  return (
    <ExpandedIdContext.Provider value={{ expandedId, setExpandedId }}>
      {children}
    </ExpandedIdContext.Provider>
  );
}

export function useExpandedId() {
  const context = useContext(ExpandedIdContext);
  if (context === undefined) {
    throw new Error('useExpandedId must be used within an ExpandedIdProvider');
  }
  return context;
}
