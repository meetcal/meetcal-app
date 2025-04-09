import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LiftResult } from '@/data/types/athletes';
import { MeetName } from '@/data/types/meet';
import { getSchedule } from '@/data/meets/scheduleManager';
import { calculateWeighInTime } from '@/utils/time';
import { useUser } from '@clerk/clerk-expo';

// Function to generate unique session IDs
function generateSessionId(meet: MeetName, sessionNumber: number | string, platform: string): string {
  return `${meet}-${sessionNumber}-${platform}`.replace(/\s+/g, '-');
}

// Function to get user-specific storage key
const getSavedSessionsKey = (userId: string) => `@saved_sessions_${userId}`;

export interface SavedSession {
  id: string;
  meet: MeetName;
  sessionNumber: number;
  platform: string;
  weightClass: string;
  startTime: string;
  weighInTime: string;
  date: string;
  notes?: string;
  athleteNames?: string[];
  athleteName?: string; // For backward compatibility
}

export function useSavedSessions() {
  const { user } = useUser();
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Clear sessions when user logs out
  useEffect(() => {
    if (!user?.id) {
      setSavedSessions([]);
      setIsLoading(false);
    }
  }, [user?.id]);

  // Load sessions when user logs in
  useEffect(() => {
    if (user?.id) {
      loadSavedSessions();
    }
  }, [user?.id]);

  const loadSavedSessions = async () => {
    if (!user?.id) {
      setSavedSessions([]);
      setIsLoading(false);
      return;
    }
    
    try {
      const saved = await AsyncStorage.getItem(getSavedSessionsKey(user.id));
      if (saved) {
        const parsedSessions = JSON.parse(saved);
        // Ensure all sessions have meet information
        const validSessions = parsedSessions.filter((session: SavedSession) => session.meet);
        setSavedSessions(validSessions);
      } else {
        setSavedSessions([]);
      }
    } catch (error) {
      console.error('Error loading saved sessions:', error);
      setSavedSessions([]);
    } finally {
      setIsLoading(false);
    }
  };

  const saveSessionsFromAthletes = async (athletes: LiftResult[], meet: MeetName) => {
    if (!user?.id) return false;
    
    try {
      const sessionMap = new Map<string, { session: SavedSession, athletes: string[] }>();
      const schedule = getSchedule(meet);
      
      athletes
        .filter(athlete => athlete.session)
        .forEach(athlete => {
          const sessionId = generateSessionId(meet, athlete.session!.number, athlete.session!.platform);
          
          if (!sessionMap.has(sessionId)) {
            // Find session details in schedule
            const sessionDay = schedule.find(day => 
              day.sessions.some(s => s.number === athlete.session?.number)
            );
            
            const scheduleSession = sessionDay?.sessions.find(s => 
              s.number === athlete.session?.number
            );
            
            const platform = scheduleSession?.platforms.find(p => 
              p.platform === athlete.session?.platform
            );
            
            if (sessionDay && scheduleSession && platform) {
              // Use platform-specific time if available
              const startTime = platform.platformStartTime || scheduleSession.startTime;
              const weighInTime = calculateWeighInTime(startTime);
              
              sessionMap.set(sessionId, {
                session: {
                  id: sessionId,
                  meet,
                  sessionNumber: athlete.session!.number,
                  platform: athlete.session!.platform,
                  weightClass: platform.weightClass,
                  startTime,
                  weighInTime,
                  date: sessionDay.fullDate,
                  athleteNames: []
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
            weightClass: session.weightClass,
          };
        } else {
          allSessions.push(session);
        }
      });

      await AsyncStorage.setItem(getSavedSessionsKey(user.id), JSON.stringify(allSessions));
      setSavedSessions(allSessions);
      return true;
    } catch (error) {
      console.error('Error saving sessions:', error);
      return false;
    }
  };

  const saveSession = async (session: SavedSession) => {
    if (!user?.id) return false;
    
    try {
      if (!session.meet) {
        console.error('Cannot save session without meet information');
        return false;
      }

      // Load current sessions to ensure we have the complete list
      const currentSaved = await AsyncStorage.getItem(getSavedSessionsKey(user.id));
      let currentSessions: SavedSession[] = [];
      if (currentSaved) {
        currentSessions = JSON.parse(currentSaved);
      }

      const existingSessionIndex = currentSessions.findIndex(s => s.id === session.id);
      if (existingSessionIndex >= 0) {
        const existingSession = currentSessions[existingSessionIndex];
        // Merge notes if both sessions have them
        if (session.notes && existingSession.notes) {
          session.notes = `${existingSession.notes}\n\n${session.notes}`;
        } else if (!session.notes) {
          session.notes = existingSession.notes;
        }
        // Preserve athlete names
        if (existingSession.athleteNames && !session.athleteNames) {
          session.athleteNames = existingSession.athleteNames;
        }
        currentSessions[existingSessionIndex] = { ...existingSession, ...session };
      } else {
        currentSessions.push(session);
      }

      await AsyncStorage.setItem(getSavedSessionsKey(user.id), JSON.stringify(currentSessions));
      setSavedSessions(currentSessions);
      return true;
    } catch (error) {
      console.error('Error saving session:', error);
      return false;
    }
  };

  const isSessionSaved = (sessionId: string) => {
    if (!user?.id) return false;
    return savedSessions.some(session => session.id === sessionId);
  };

  const removeSession = async (sessionId: string) => {
    if (!user?.id) return false;
    
    try {
      const updatedSessions = savedSessions.filter(session => session.id !== sessionId);
      await AsyncStorage.setItem(getSavedSessionsKey(user.id), JSON.stringify(updatedSessions));
      setSavedSessions(updatedSessions);
      return true;
    } catch (error) {
      console.error('Error removing session:', error);
      return false;
    }
  };

  const resetAllSessions = async () => {
    if (!user?.id) return false;
    
    try {
      await AsyncStorage.setItem(getSavedSessionsKey(user.id), JSON.stringify([]));
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