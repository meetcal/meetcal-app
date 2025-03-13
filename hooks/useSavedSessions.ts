import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { schedule } from '@/data/schedule';
import { LiftResult } from '@/data/athletes';
import { MeetName } from '@/data/types/meet';

const SAVED_SESSIONS_KEY = '@saved_sessions';

// Function to generate unique session IDs
function generateSessionId(meet: MeetName, sessionNumber: number | string, platform: string): string {
  return `${meet}-${sessionNumber}-${platform}`.replace(/\s+/g, '-');
}

export interface SavedSession {
  id: string;
  sessionNumber: number;
  platform: string;
  weightClass: string;
  startTime: string;
  weighInTime: string;
  date: string;
  athleteNames?: string[];
  meet: MeetName;
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
        const parsedSessions = JSON.parse(saved);
        // Ensure all sessions have meet information
        const validSessions = parsedSessions.filter((session: SavedSession) => session.meet);
        setSavedSessions(validSessions);
      }
    } catch (error) {
      console.error('Error loading saved sessions:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const saveSessionsFromAthletes = async (athletes: LiftResult[], meet: MeetName) => {
    try {
      const sessionMap = new Map<string, { session: any, athletes: string[] }>();
      
      athletes
        .filter(athlete => athlete.session)
        .forEach(athlete => {
          const sessionId = generateSessionId(meet, athlete.session!.number, athlete.session!.platform);
          
          if (!sessionMap.has(sessionId)) {
            const platformDetails = getSessionPlatformDetails(
              athlete.session!.number,
              athlete.session!.platform
            );
            
            if (platformDetails) {
              sessionMap.set(sessionId, {
                session: {
                  id: sessionId,
                  sessionNumber: athlete.session!.number,
                  platform: athlete.session!.platform,
                  weightClass: platformDetails.weightClass,
                  startTime: platformDetails.startTime,
                  weighInTime: platformDetails.weighInTime,
                  date: platformDetails.date,
                  athleteNames: [],
                  meet,
                },
                athletes: []
              });
            }
          }
          
          const sessionData = sessionMap.get(sessionId);
          if (sessionData) {
            sessionData.athletes.push(athlete.name);
          }
        });
      
      const uniqueSessions = Array.from(sessionMap.values()).map(({ session, athletes }) => {
        return {
          ...session,
          athleteNames: athletes
        };
      });

      const allSessions = [...savedSessions];
      uniqueSessions.forEach(session => {
        const existingSessionIndex = allSessions.findIndex(saved => saved.id === session.id);
        
        if (existingSessionIndex >= 0) {
          const existingSession = allSessions[existingSessionIndex];
          const existingNames = existingSession.athleteNames || [];
          const newNames = session.athleteNames || [];
          
          allSessions[existingSessionIndex] = {
            ...existingSession,
            athleteNames: [...new Set([...existingNames, ...newNames])],
            meet: session.meet,
          };
        } else {
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
      if (!session.meet) {
        console.error('Cannot save session without meet information');
        return false;
      }

      // Load current sessions to ensure we have the complete list
      const currentSaved = await AsyncStorage.getItem(SAVED_SESSIONS_KEY);
      let currentSessions: SavedSession[] = [];
      if (currentSaved) {
        currentSessions = JSON.parse(currentSaved);
      }

      if (currentSessions.some(s => s.id === session.id)) {
        const updatedSessions = currentSessions.map(s => 
          s.id === session.id ? { ...s, meet: session.meet } : s
        );
        await AsyncStorage.setItem(SAVED_SESSIONS_KEY, JSON.stringify(updatedSessions));
        setSavedSessions(updatedSessions);
        return true;
      }

      const updatedSessions = [...currentSessions, session];
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