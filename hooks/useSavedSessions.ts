import { useState, useEffect, useRef, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LiftResult } from '@/data/types/athletes';
import { MeetName } from '@/data/types/meet';
import { calculateWeighInTime } from '@/utils/time';
import { useUser } from '@clerk/clerk-expo';
import { convex } from '@/lib/convex';
import { api } from '@/convex/_generated/api';
import { scheduleNotification, cancelNotification } from '@/utils/notifications';
import { getPlatformStartTime } from '@/data/types/schedule';
import { fetchSchedule } from '@/lib/database/queries'; // Import fetchSchedule
import { convertToUTC, getMeetConfig } from '@/data/meets/config'; // Import convertToUTC and getMeetConfig for proper timezone handling
import { useSelectedMeet } from '@/contexts/SelectedMeetContext';
import { syncSavedWidget, clearSavedWidget } from '@/utils/savedWidget';

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

function parseStoredSessions(raw: string | null): SavedSession[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((session): session is SavedSession => {
      return Boolean(
        session &&
          typeof session === 'object' &&
          'id' in session &&
          'meet' in session
      );
    });
  } catch {
    return [];
  }
}

export function useSavedSessions() {
  const { user } = useUser();
  const { selectedMeet } = useSelectedMeet();
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const sessionsRawRef = useRef<string | null>(null);
  const sessionsRef = useRef<SavedSession[]>([]);

  // Clear sessions when user logs out
  useEffect(() => {
    if (!user?.id) {
      setSavedSessions([]);
      setIsLoading(false);
      clearSavedWidget();
      sessionsRawRef.current = null;
      sessionsRef.current = [];
    }
  }, [user?.id]);

  useEffect(() => {
    if (!selectedMeet) {
      syncSavedWidget(null, savedSessions);
      return;
    }
    getMeetConfig(selectedMeet)
      .then(config =>
        syncSavedWidget(selectedMeet, savedSessions, config?.time?.timeZoneIdentifier ?? 'UTC')
      )
      .catch(() => syncSavedWidget(selectedMeet, savedSessions, 'UTC'));
  }, [selectedMeet, savedSessions]);

  // Load sessions when user logs in
  useEffect(() => {
    if (user?.id) {
      loadSavedSessions();
    }
  }, [user?.id]);

  const commitSessions = useCallback(async (nextSessions: SavedSession[]) => {
    if (!user?.id) return;
    const serialized = JSON.stringify(nextSessions);
    if (sessionsRawRef.current !== serialized) {
      await AsyncStorage.setItem(getSavedSessionsKey(user.id), serialized);
      sessionsRawRef.current = serialized;
    }
    sessionsRef.current = nextSessions;
    setSavedSessions(nextSessions);
  }, [user?.id]);

  const readStoredSessions = useCallback(async (forceStorageRead = false): Promise<SavedSession[]> => {
    if (!user?.id) return [];
    if (!forceStorageRead && sessionsRawRef.current !== null) {
      return sessionsRef.current;
    }
    const raw = await AsyncStorage.getItem(getSavedSessionsKey(user.id));
    if (raw && raw === sessionsRawRef.current) {
      return sessionsRef.current;
    }

    const parsedSessions = parseStoredSessions(raw).filter((session) => session.meet);
    sessionsRawRef.current = raw;
    sessionsRef.current = parsedSessions;
    return parsedSessions;
  }, [user?.id]);

  const loadSavedSessions = async () => {
    if (!user?.id) {
      setSavedSessions([]);
      setIsLoading(false);
      return;
    }
    
    setIsLoading(true); // Set loading true at the start
    try {
      // Hydrate from local storage first so navigation to Saved shows data immediately.
      const localRaw = await AsyncStorage.getItem(getSavedSessionsKey(user.id));
      const localSessions = parseStoredSessions(localRaw).filter((session) => session.meet);
      sessionsRawRef.current = localRaw;
      sessionsRef.current = localSessions;
      setSavedSessions(localSessions);

      // Fetch from Convex
      try {
        const convexSessions = await convex.query(api.savedSessions.getByUser, { userId: user.id });

        if (convexSessions && convexSessions.length > 0) {
          const formattedSessions = convexSessions.map(s => ({
            id: s.sessionId,
            meet: s.meet as MeetName,
            sessionNumber: s.sessionNumber,
            platform: s.platform,
            weightClass: s.weightClass ?? '',
            startTime: s.startTime ?? '',
            weighInTime: calculateWeighInTime(s.startTime ?? ''),
            date: s.date ?? '',
            notes: s.notes,
            athleteNames: s.athleteNames,
          }));
          await commitSessions(formattedSessions);
        } else {
          if (localSessions.length === 0) {
            await AsyncStorage.removeItem(getSavedSessionsKey(user.id));
            sessionsRawRef.current = null;
            sessionsRef.current = [];
            setSavedSessions([]);
          } else {
            setSavedSessions(localSessions);
          }
        }
      } catch (convexError) {
        console.error('Error fetching saved sessions from Convex:', convexError);
        setSavedSessions(localSessions);
      }
    } catch (error) {
      console.error('Error loading saved sessions:', error);
      
      // Check if it's a network/connection error
      if (error instanceof Error && (error.message.includes('network') || error.message.includes('fetch'))) {
        console.error('Network error detected, falling back to local storage');
      }
      
      // Attempt to load from local storage as a final fallback
      try {
        const saved = await AsyncStorage.getItem(getSavedSessionsKey(user.id));
        const validSessions = parseStoredSessions(saved).filter((session) => session.meet);
        sessionsRawRef.current = saved;
        sessionsRef.current = validSessions;
        setSavedSessions(validSessions);
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
      
      const uniqueSessionsToSave = Array.from(sessionMap.values()).map(({ session, athletes }) => {
        // Ensure athleteNames has unique values
        return {
          ...session,
          athleteNames: [...new Set(athletes)]
        };
      });

      // Use a temporary array to manage local state updates
      let updatedLocalSessions = [...savedSessions];

      // Loop through generated sessions and save each one (which handles local + Supabase)
      let allSavesSucceeded = true;
      for (const sessionToSave of uniqueSessionsToSave) {
        // Find existing local session to potentially merge *before* calling saveSession
        const existingLocalIndex = updatedLocalSessions.findIndex(s => s.id === sessionToSave.id);
        let sessionWithMergedData = { ...sessionToSave };

        if (existingLocalIndex >= 0) {
          const existingLocalSession = updatedLocalSessions[existingLocalIndex];
          // Merge athlete names from local and new data
          const combinedNames = [...new Set([...(existingLocalSession.athleteNames || []), ...(sessionToSave.athleteNames || [])])];
          sessionWithMergedData = {
            ...existingLocalSession, // Keep existing notes, etc.
            ...sessionToSave, // Overwrite with new schedule data (like time)
            athleteNames: combinedNames, // Use the merged names
          };
        }

        // Call saveSession for each session to handle upsert and local state
        const success = await saveSession(sessionWithMergedData);
        if (!success) {
          allSavesSucceeded = false;
          console.error(`Failed to save session ${sessionWithMergedData.id} from start list.`);
          // Decide if you want to stop or continue saving others
        }
      }

      // Note: saveSession already updates the main savedSessions state and AsyncStorage,
      // so no need to call setSavedSessions or setItem here directly.

      return allSavesSucceeded; // Indicate if all individual saves were successful
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
      const currentSessions = await readStoredSessions();
      const nextSessions = [...currentSessions];

      const existingSessionIndex = nextSessions.findIndex(s => s.id === session.id);
      let updatedSession: SavedSession;
      if (existingSessionIndex >= 0) {
        const existingSession = nextSessions[existingSessionIndex];
        updatedSession = { ...existingSession, ...session }; // Merge new data over existing
        nextSessions[existingSessionIndex] = updatedSession;
      } else {
        updatedSession = session;
        nextSessions.push(updatedSession);
      }

      await commitSessions(nextSessions);

      // 2. Upsert to Convex
      try {
        await convex.mutation(api.savedSessions.upsert, {
          sessionId: updatedSession.id,
          userId: user.id,
          meet: updatedSession.meet,
          sessionNumber: updatedSession.sessionNumber,
          platform: updatedSession.platform,
          weightClass: updatedSession.weightClass,
          startTime: updatedSession.startTime,
          date: updatedSession.date,
          notes: updatedSession.notes,
          athleteNames: updatedSession.athleteNames,
        });
      } catch (convexError) {
        console.error('Error saving session to Convex:', convexError);
        // Local save already succeeded, so user has their data
        return false;
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
            
            // Get meet config for timezone information
            const meetConfig = await getMeetConfig(meetName);
            
            // Convert times to UTC using the meet's time zone (same as calendar events)
            const sessionDate = convertToUTC(startTime, sessionDayDate, meetName);
            
            // Format times for clearer logging
            const sessionDateEastern = sessionDate.toLocaleString('en-US', {
              timeZone: 'America/New_York',
              dateStyle: 'short',
              timeStyle: 'short'
            });
            
            const sessionDateMeetLocal = sessionDate.toLocaleString('en-US', {
              timeZone: meetConfig.time.timeZoneIdentifier,
              dateStyle: 'short',
              timeStyle: 'short'
            });

            const triggerDate = new Date(sessionDate.getTime() - 60 * 60 * 1000);
            const now = new Date();
            
            const triggerDateEastern = triggerDate.toLocaleString('en-US', {
              timeZone: 'America/New_York',
              dateStyle: 'short',
              timeStyle: 'short'
            });
            
            const triggerDateMeetLocal = triggerDate.toLocaleString('en-US', {
              timeZone: meetConfig.time.timeZoneIdentifier,
              dateStyle: 'short',
              timeStyle: 'short'
            });
            
            const nowEastern = now.toLocaleString('en-US', {
              timeZone: 'America/New_York',
              dateStyle: 'short',
              timeStyle: 'short'
            });
            
            const nowMeetLocal = now.toLocaleString('en-US', {
              timeZone: meetConfig.time.timeZoneIdentifier,
              dateStyle: 'short',
              timeStyle: 'short'
            });

            console.log(`Notification Scheduling - Session Date (UTC): ${sessionDate.toISOString()}`);
            console.log(`Notification Scheduling - Session Date (Eastern): ${sessionDateEastern}`);
            console.log(`Notification Scheduling - Session Date (${meetConfig.time.abbreviation}): ${sessionDateMeetLocal}`);
            console.log(`Notification Scheduling - Trigger Date (UTC): ${triggerDate.toISOString()}`);
            console.log(`Notification Scheduling - Trigger Date (Eastern): ${triggerDateEastern}`);
            console.log(`Notification Scheduling - Trigger Date (${meetConfig.time.abbreviation}): ${triggerDateMeetLocal}`);
            console.log(`Notification Scheduling - triggerDate > now: ${triggerDate > now}`);

            if (triggerDate > now) {
              console.log('Notification Scheduling - Condition met, attempting to schedule...');
              const notificationId = await scheduleNotification(
                `Session Reminder`,
                `Session ${updatedSession.sessionNumber} ${updatedSession.platform} starts in 1 hour.`,
                triggerDate,
                updatedSession.id
              );
              if (notificationId) {
                console.log('Notification Scheduling - scheduleNotification called successfully.', notificationId);
              }
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
      // *** Find the session before filtering ***
      const sessionToRemove = savedSessions.find(session => session.id === sessionId);

      // 1. Update local state and AsyncStorage
      const currentSessions = await readStoredSessions();
      const updatedSessions = currentSessions.filter(session => session.id !== sessionId);
      await commitSessions(updatedSessions);

      // 2. Delete from Convex
      try {
        await convex.mutation(api.savedSessions.remove, { sessionId, userId: user.id });
      } catch (convexError) {
        console.error('Error removing session from Convex:', convexError);
        return false;
      }

      // *** Cancel notification ***
      if (sessionToRemove) {
        // Only attempt to cancel if the session was actually found
        try {
          const notificationsEnabled = await AsyncStorage.getItem(NOTIFICATION_ENABLED_KEY);
          if (notificationsEnabled === 'true') {
             // Only cancel if notifications were potentially scheduled
            await cancelNotification(sessionToRemove.id);
          } else {
            console.log(`removeSession: Notifications disabled, skipping cancellation for ${sessionToRemove.id}`);
          }
        } catch (cancelError) {
          console.error(`removeSession: Failed to cancel notification for ${sessionToRemove.id}:`, cancelError);
          // Continue with removal even if cancellation fails
        }
      } else {
          console.warn(`removeSession: Could not find session ${sessionId} in state before removal to cancel notification.`);
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
        const currentSessions = await readStoredSessions();
        const filteredSessions = currentSessions.filter(s => s.meet !== meet);
        await commitSessions(filteredSessions);
        // Delete only sessions for this meet from Convex
        try {
          await convex.mutation(api.savedSessions.removeAllForUser, { userId: user.id, meet });
        } catch (e) {
          console.error('Error deleting sessions for meet from Convex:', e);
        }
      } else {
        // 1. Clear all local storage and state
        await commitSessions([]);
        // 2. Delete all sessions for this user from Convex
        try {
          await convex.mutation(api.savedSessions.removeAllForUser, { userId: user.id });
        } catch (e) {
          console.error('Error deleting sessions from Convex:', e);
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
