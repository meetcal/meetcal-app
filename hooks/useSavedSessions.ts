import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LiftResult } from '@/data/types/athletes';
import { MeetName } from '@/data/types/meet';
import { calculateWeighInTime } from '@/utils/time';
import { useUser } from '@clerk/clerk-expo';
import { supabase } from '@/lib/supabase'; // Import supabase client
import { scheduleNotification } from '@/utils/notifications';
import { getPlatformStartTime } from '@/data/types/schedule';
import { fetchSchedule } from '@/lib/database/queries'; // Import fetchSchedule

// Function to generate unique session IDs
function generateSessionId(meet: MeetName, sessionNumber: number | string, platform: string): string {
  return `${meet}-${sessionNumber}-${platform}`.replace(/\s+/g, '-');
}

// Function to get user-specific storage key
const getSavedSessionsKey = (userId: string) => `@saved_sessions_${userId}`;

const NOTIFICATION_ENABLED_KEY = '@notification_enabled';

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
    
    setIsLoading(true); // Set loading true at the start
    try {
      // Fetch from Supabase first
      const { data: supabaseSessions, error: supabaseError } = await supabase
        .from('saved_sessions')
        .select('*')
        .eq('user_id', user.id);

      if (supabaseError) {
        console.error('Error fetching saved sessions from Supabase:', supabaseError);
        // Fallback to local storage if Supabase fails? Or show error?
        // For now, load local as a fallback
        const saved = await AsyncStorage.getItem(getSavedSessionsKey(user.id));
        if (saved) {
          const parsedSessions = JSON.parse(saved);
          const validSessions = parsedSessions.filter((session: SavedSession) => session.meet);
          setSavedSessions(validSessions);
        } else {
          setSavedSessions([]);
        }
      } else if (supabaseSessions) {
        // Map Supabase data to SavedSession interface
        const formattedSessions = supabaseSessions.map(s => ({
          id: s.id,
          meet: s.meet as MeetName,
          sessionNumber: s.session_number,
          platform: s.platform,
          weightClass: s.weight_class,
          startTime: s.start_time,
          // Assuming weighInTime is derived or needs calculation if not stored
          weighInTime: calculateWeighInTime(s.start_time), 
          date: s.date || '', // Make sure 'date' is fetched if needed, or derived
          notes: s.notes,
          athleteNames: s.athlete_names,
        }));

        // Update local storage with Supabase data
        await AsyncStorage.setItem(getSavedSessionsKey(user.id), JSON.stringify(formattedSessions));
        setSavedSessions(formattedSessions);
      } else {
         // No sessions in Supabase, clear local storage too?
         await AsyncStorage.removeItem(getSavedSessionsKey(user.id));
         setSavedSessions([]);
      }
    } catch (error) {
      console.error('Error loading saved sessions:', error);
      // Attempt to load from local storage as a final fallback
      try {
        const saved = await AsyncStorage.getItem(getSavedSessionsKey(user.id));
        if (saved) {
          const parsedSessions = JSON.parse(saved);
          const validSessions = parsedSessions.filter((session: SavedSession) => session.meet);
          setSavedSessions(validSessions);
        } else {
          setSavedSessions([]);
        }
      } catch (localError) {
        console.error('Error loading saved sessions from AsyncStorage fallback:', localError);
        setSavedSessions([]);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const saveSessionsFromAthletes = async (athletes: LiftResult[], meet: MeetName) => {
    if (!user?.id) return false;
    
    try {
      const sessionMap = new Map<string, { session: SavedSession, athletes: string[] }>();
      const schedule = await fetchSchedule(meet);
      
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

      // 1. Update local state and AsyncStorage
      const currentSaved = await AsyncStorage.getItem(getSavedSessionsKey(user.id));
      let currentSessions: SavedSession[] = [];
      if (currentSaved) {
        currentSessions = JSON.parse(currentSaved);
      }

      const existingSessionIndex = currentSessions.findIndex(s => s.id === session.id);
      let updatedSession: SavedSession;
      if (existingSessionIndex >= 0) {
        const existingSession = currentSessions[existingSessionIndex];
        updatedSession = { ...existingSession, ...session }; // Merge new data over existing
        currentSessions[existingSessionIndex] = updatedSession;
      } else {
        updatedSession = session;
        currentSessions.push(updatedSession);
      }

      await AsyncStorage.setItem(getSavedSessionsKey(user.id), JSON.stringify(currentSessions));
      setSavedSessions(currentSessions);

      // 2. Upsert to Supabase
      const { error: supabaseError } = await supabase
        .from('saved_sessions')
        .upsert({
          id: updatedSession.id,
          user_id: user.id,
          meet: updatedSession.meet,
          session_number: updatedSession.sessionNumber,
          platform: updatedSession.platform,
          weight_class: updatedSession.weightClass,
          start_time: updatedSession.startTime,
          date: updatedSession.date, // Ensure 'date' is saved to Supabase
          notes: updatedSession.notes,
          athlete_names: updatedSession.athleteNames,
          // Add created_at and updated_at if managed by client? DB defaults usually handle this.
        });

      if (supabaseError) {
        console.error('Error saving session to Supabase:', supabaseError);
        // Handle error - maybe revert local changes or show message?
        // For now, just log the error. The local save already succeeded.
        return false; // Indicate partial failure
      }

      // 3. Schedule local notification 1 hour before session start time if notifications are enabled
      try {
        const notificationsEnabled = await AsyncStorage.getItem(NOTIFICATION_ENABLED_KEY);
        console.log('Notification Scheduling Check - Enabled:', notificationsEnabled);

        if (notificationsEnabled === 'true') {
          const meetName = updatedSession.meet;
          const sessionNumber = updatedSession.sessionNumber;
          const platform = updatedSession.platform;
          console.log(`Notification Scheduling - Fetching schedule for: ${meetName}, Session ${sessionNumber}, Platform ${platform}`);
          const schedule = await fetchSchedule(meetName);
          console.log('Notification Scheduling - Schedule fetched:', schedule ? `${schedule.length} days` : 'null or empty');

          if (!schedule || schedule.length === 0) {
             console.error(`Notification Scheduling - Could not fetch or schedule is empty for meet: ${meetName}`);
             return true; // Still return true as the session was saved
          }

          let foundSession = null;
          let sessionDayDate = '';
          for (const day of schedule) {
            const session = day.sessions.find(s => s.number === sessionNumber);
            if (session) {
              foundSession = session;
              sessionDayDate = day.fullDate; // YYYY-MM-DD from transformed data
              break;
            }
          }
          console.log('Notification Scheduling - Session found:', foundSession ? `Yes (Date: ${sessionDayDate})` : 'No');

          if (foundSession && sessionDayDate) {
            const startTime = getPlatformStartTime(foundSession, platform);
            console.log(`Notification Scheduling - Start time found: ${startTime}`);
            
            const [time, period] = startTime.split(' ');
            let [hours, minutes] = time.split(':').map(Number);
            if (period === 'PM' && hours !== 12) hours += 12;
            if (period === 'AM' && hours === 12) hours = 0;
            
            console.log(`Notification Scheduling - Parsing Date/Time: Date='${sessionDayDate}', H=${hours}, M=${minutes}`);

            const sessionDate = new Date(sessionDayDate);
            // Ensure date part is correct (avoid potential UTC issues with new Date(string))
            const [year, month, day] = sessionDayDate.split('-').map(Number);
            sessionDate.setFullYear(year, month - 1, day); // Use setFullYear for clarity
            sessionDate.setHours(hours, minutes, 0, 0); 

            const triggerDate = new Date(sessionDate.getTime() - 60 * 60 * 1000);
            const now = new Date();
            console.log(`Notification Scheduling - Session Date: ${sessionDate.toISOString()}`);
            console.log(`Notification Scheduling - Trigger Date: ${triggerDate.toISOString()}`);
            console.log(`Notification Scheduling - Current Time: ${now.toISOString()}`);
            console.log(`Notification Scheduling - triggerDate > now: ${triggerDate > now}`);

            if (triggerDate > now) {
              console.log('Notification Scheduling - Condition met, attempting to schedule...');
              await scheduleNotification(
                `Session Reminder`,
                `Session ${updatedSession.sessionNumber} ${updatedSession.platform} starts in 1 hour.`,
                triggerDate
              );
              console.log('Notification Scheduling - scheduleNotification called successfully.');
            } else {
              console.log('Notification Scheduling - Trigger date is in the past, not scheduling.');
            }
          } else {
            console.log('Notification Scheduling - Session not found or date missing, cannot schedule.');
          }
        } else {
          console.log('Notification Scheduling - Notifications are disabled in settings.');
        }
      } catch (notifError) {
        console.error('Notification Scheduling - Error caught during scheduling block:', notifError);
      }

      return true; // Indicate success
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
      // 1. Update local state and AsyncStorage
      const updatedSessions = savedSessions.filter(session => session.id !== sessionId);
      await AsyncStorage.setItem(getSavedSessionsKey(user.id), JSON.stringify(updatedSessions));
      setSavedSessions(updatedSessions);

      // 2. Delete from Supabase
      const { error: supabaseError } = await supabase
        .from('saved_sessions')
        .delete()
        .match({ id: sessionId, user_id: user.id }); // Match both id and user_id

      if (supabaseError) {
        console.error('Error removing session from Supabase:', supabaseError);
        // Handle error - maybe revert local changes or show message?
        // For now, just log the error. The local removal already succeeded.
        return false; // Indicate partial failure
      }

      return true; // Indicate success
    } catch (error) {
      console.error('Error removing session:', error);
      return false;
    }
  };

  const resetAllSessions = async (meet?: MeetName) => {
    if (!user?.id) return false;
    try {
      if (meet) {
        // Filter out sessions for the selected meet locally
        const currentSaved = await AsyncStorage.getItem(getSavedSessionsKey(user.id));
        let currentSessions: SavedSession[] = [];
        if (currentSaved) {
          currentSessions = JSON.parse(currentSaved);
        }
        const filteredSessions = currentSessions.filter(s => s.meet !== meet);
        await AsyncStorage.setItem(getSavedSessionsKey(user.id), JSON.stringify(filteredSessions));
        setSavedSessions(filteredSessions);
        // Delete only sessions for this meet from Supabase
        const { error: supabaseError } = await supabase
          .from('saved_sessions')
          .delete()
          .match({ user_id: user.id, meet });
        if (supabaseError) {
          console.error('Error deleting sessions for meet from Supabase:', supabaseError);
        }
      } else {
        // 1. Clear all local storage and state
        await AsyncStorage.setItem(getSavedSessionsKey(user.id), JSON.stringify([]));
        setSavedSessions([]);
        // 2. Delete all sessions for this user from Supabase
        const { error: supabaseError } = await supabase
          .from('saved_sessions')
          .delete()
          .match({ user_id: user.id });
        if (supabaseError) {
          console.error('Error deleting sessions from Supabase:', supabaseError);
        }
      }
      return true;
    } catch (error) {
      console.error('Error resetting sessions:', error);
      return false;
    }
  };

  return {
    savedSessions,
    isLoading,
    loadSavedSessions,
    saveSessionsFromAthletes,
    saveSession,
    removeSession,
    isSessionSaved,
    resetAllSessions,
  };
} 