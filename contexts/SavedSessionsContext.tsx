import React, { createContext, useContext, useEffect } from 'react';
import { useSavedSessions as useHook, SavedSession } from '@/hooks/useSavedSessions';
import { LiftResult } from '@/data/types/athletes';
import { MeetName } from '@/data/types/meet';
import type { Schedule as ScheduleType } from '@/types/schedule';

interface SavedSessionsContextType {
  savedSessions: SavedSession[];
  isLoading: boolean;
  /** A `/users/me/*` call answered 401: saved sessions are not syncing. */
  authExpired: boolean;
  loadSavedSessions: () => Promise<void>;
  saveSessionsFromAthletes: (athletes: LiftResult[], meet: MeetName, scheduleOverride?: ScheduleType) => Promise<boolean>;
  saveSession: (session: SavedSession) => Promise<boolean>;
  removeSession: (sessionId: string) => Promise<boolean>;
  isSessionSaved: (sessionId: string) => boolean;
  resetAllSessions: (meet?: MeetName) => Promise<boolean>;
  migrateLegacySessions: (currentMeet: MeetName) => Promise<boolean>;
}

const SavedSessionsContext = createContext<SavedSessionsContextType | undefined>(undefined);
let hasWarnedMissingProvider = false;

const fallbackContext: SavedSessionsContextType = {
  savedSessions: [],
  isLoading: false,
  authExpired: false,
  loadSavedSessions: async () => {},
  saveSessionsFromAthletes: async () => false,
  saveSession: async () => false,
  removeSession: async () => false,
  isSessionSaved: () => false,
  resetAllSessions: async () => false,
  migrateLegacySessions: async () => false,
};

export function SavedSessionsProvider({ children }: { children: React.ReactNode }) {
  // `useHook` returns a memoised object (its actions are `useCallback`s), so
  // the provider value only changes when hook state does. Passing a fresh
  // object each render re-rendered every consumer on every provider render.
  const hook = useHook();

  return (
    <SavedSessionsContext.Provider value={hook}>
      {children}
    </SavedSessionsContext.Provider>
  );
}

export function useSavedSessions() {
  const context = useContext(SavedSessionsContext);
  const isMissingProvider = context === undefined;
  // Warn once per app run; from an effect, since flipping a module flag
  // during render is a side effect the render may repeat or discard.
  useEffect(() => {
    if (isMissingProvider && !hasWarnedMissingProvider) {
      console.error('[SavedSessionsContext] useSavedSessions called outside SavedSessionsProvider');
      hasWarnedMissingProvider = true;
    }
  }, [isMissingProvider]);
  return context ?? fallbackContext;
}
