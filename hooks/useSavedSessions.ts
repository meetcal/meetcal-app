import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { schedule } from '@/data/schedule';
import { LiftResult } from '@/data/athletes';

const SAVED_SESSIONS_KEY = '@saved_sessions';

export interface SavedSession {
  id: string;
  sessionNumber: number;
  platform: string;
  weightClass: string;
  startTime: string;
  weighInTime: string;
  date: string;
}

function getSessionPlatformDetails(sessionNumber: number, platformName: string) {
  for (const day of schedule) {
    const session = day.sessions.find(s => s.number === sessionNumber);
    if (session) {
      const platform = session.platforms.find(p => p.platform === platformName);
      if (platform) {
        return {
          weightClass: platform.weightClass,
          date: day.fullDate,
          startTime: session.startTime,
          weighInTime: session.weighInTime,
        };
      }
    }
  }
  return null;
}

export function useSavedSessions() {
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadSavedSessions();
  }, []);

  const loadSavedSessions = async () => {
    try {
      const saved = await AsyncStorage.getItem(SAVED_SESSIONS_KEY);
      if (saved) {
        setSavedSessions(JSON.parse(saved));
      }
    } catch (error) {
      console.error('Error loading saved sessions:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const saveSessionsFromAthletes = async (athletes: LiftResult[]) => {
    try {
      const uniqueSessions = athletes
        .filter(athlete => athlete.session)
        .map(athlete => {
          const platformDetails = getSessionPlatformDetails(
            athlete.session!.number,
            athlete.session!.platform
          );
          if (!platformDetails) return null;

          return {
            id: `session-${athlete.session!.number}-${athlete.session!.platform}`,
            sessionNumber: athlete.session!.number,
            platform: athlete.session!.platform,
            weightClass: platformDetails.weightClass,
            startTime: platformDetails.startTime,
            weighInTime: platformDetails.weighInTime,
            date: platformDetails.date,
          };
        })
        .filter((session): session is SavedSession => session !== null)
        .filter((session, index, self) => 
          index === self.findIndex(s => s.id === session.id)
        );

      const allSessions = [...savedSessions];
      uniqueSessions.forEach(session => {
        if (!allSessions.some(saved => saved.id === session.id)) {
          allSessions.push(session);
        }
      });

      await AsyncStorage.setItem(SAVED_SESSIONS_KEY, JSON.stringify(allSessions));
      setSavedSessions(allSessions);
      return true;
    } catch (error) {
      console.error('Error saving sessions:', error);
      return false;
    }
  };

  const saveSession = async (session: SavedSession) => {
    try {
      if (savedSessions.some(s => s.id === session.id)) {
        return true;
      }

      const updatedSessions = [...savedSessions, session];
      await AsyncStorage.setItem(SAVED_SESSIONS_KEY, JSON.stringify(updatedSessions));
      setSavedSessions(updatedSessions);
      return true;
    } catch (error) {
      console.error('Error saving session:', error);
      return false;
    }
  };

  const isSessionSaved = (sessionId: string) => {
    return savedSessions.some(session => session.id === sessionId);
  };

  const removeSession = async (sessionId: string) => {
    try {
      const updatedSessions = savedSessions.filter(session => session.id !== sessionId);
      await AsyncStorage.setItem(SAVED_SESSIONS_KEY, JSON.stringify(updatedSessions));
      setSavedSessions(updatedSessions);
      return true;
    } catch (error) {
      console.error('Error removing session:', error);
      return false;
    }
  };

  const resetAllSessions = async () => {
    try {
      await AsyncStorage.setItem(SAVED_SESSIONS_KEY, JSON.stringify([]));
      setSavedSessions([]);
      return true;
    } catch (error) {
      console.error('Error resetting sessions:', error);
      return false;
    }
  };

  return {
    savedSessions,
    isLoading,
    saveSessionsFromAthletes,
    saveSession,
    removeSession,
    isSessionSaved,
    resetAllSessions,
  };
} 