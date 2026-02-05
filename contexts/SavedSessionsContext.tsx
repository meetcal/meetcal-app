import React, { createContext, useContext } from 'react';
import { useSavedSessions as useHook, SavedSession } from '@/hooks/useSavedSessions';
import { MeetName } from '@/data/types/meet';

interface SavedSessionsContextType {
  savedSessions: SavedSession[];
  isLoading: boolean;
  loadSavedSessions: () => Promise<void>;
  saveSessionsFromAthletes: (athletes: any[], meet: MeetName) => Promise<boolean>;
  saveSession: (session: SavedSession) => Promise<boolean>;
  removeSession: (sessionId: string) => Promise<boolean>;
  isSessionSaved: (sessionId: string) => boolean;
  resetAllSessions: (meet?: MeetName) => Promise<boolean>;
}

const SavedSessionsContext = createContext<SavedSessionsContextType | undefined>(undefined);
let hasWarnedMissingProvider = false;

const fallbackContext: SavedSessionsContextType = {
  savedSessions: [],
  isLoading: false,
  loadSavedSessions: async () => {},
  saveSessionsFromAthletes: async () => false,
  saveSession: async () => false,
  removeSession: async () => false,
  isSessionSaved: () => false,
  resetAllSessions: async () => false,
};

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
    if (!hasWarnedMissingProvider) {
      console.error('[SavedSessionsContext] useSavedSessions called outside SavedSessionsProvider');
      hasWarnedMissingProvider = true;
    }
    return fallbackContext;
  }
  return context;
}
