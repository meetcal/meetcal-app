import React, { createContext, useContext } from 'react';
import { useSavedSessions as useHook, SavedSession } from '@/hooks/useSavedSessions';

interface SavedSessionsContextType {
  savedSessions: SavedSession[];
  isLoading: boolean;
  saveSessionsFromAthletes: (athletes: any[]) => Promise<boolean>;
  saveSession: (session: SavedSession) => Promise<boolean>;
  removeSession: (sessionId: string) => Promise<boolean>;
  isSessionSaved: (sessionId: string) => boolean;
}

const SavedSessionsContext = createContext<SavedSessionsContextType | undefined>(undefined);

export function SavedSessionsProvider({ children }: { children: React.ReactNode }) {
  const hook = useHook();

  return (
    <SavedSessionsContext.Provider value={hook}>
      {children}
    </SavedSessionsContext.Provider>
  );
}

export function useSavedSessions() {
  const context = useContext(SavedSessionsContext);
  if (context === undefined) {
    throw new Error('useSavedSessions must be used within a SavedSessionsProvider');
  }
  return context;
} 