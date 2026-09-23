import React, { createContext, useContext, useMemo, useState } from 'react';

type ExpandedIdContextType = {
  expandedId: string | null;
  setExpandedId: React.Dispatch<React.SetStateAction<string | null>>;
};

const ExpandedIdContext = createContext<ExpandedIdContextType | undefined>(undefined);

export function ExpandedIdProvider({ children }: { children: React.ReactNode }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Every start-list row reads this context. The value used to be an object
  // literal, so each render of the screen around the provider handed every
  // mounted row a new object and re-rendered it through `React.memo`.
  const value = useMemo(() => ({ expandedId, setExpandedId }), [expandedId]);

  return (
    <ExpandedIdContext.Provider value={value}>
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
