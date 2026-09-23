import React, { createContext, useContext, useState } from 'react';

type ExpandedIdContextType = {
  expandedId: string | null;
  setExpandedId: React.Dispatch<React.SetStateAction<string | null>>;
};

const ExpandedIdContext = createContext<ExpandedIdContextType | undefined>(undefined);

export function ExpandedIdProvider({ children }: { children: React.ReactNode }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
