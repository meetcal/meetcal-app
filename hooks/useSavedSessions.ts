import { useState, useEffect, useRef, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LiftResult } from '@/data/types/athletes';
import { MeetName } from '@/data/types/meet';
import { calculateWeighInTime, hasSessionPassedAutoUnsaveWindow } from '@/utils/time';
import { useAuth, useUser } from '@clerk/expo';
import {
  cancelNotification,
  NOTIFICATION_ENABLED_KEY,
  scheduleNotification,
} from '@/utils/notifications';
import { getPlatformStartTime } from '@/data/types/schedule';
import { fetchSchedule } from '@/lib/database/queries'; // Import fetchSchedule
import { convertToUTC, getMeetConfig } from '@/data/meets/config'; // Import convertToUTC and getMeetConfig for proper timezone handling
import { useSelectedMeet } from '@/contexts/SelectedMeetContext';
import { syncSavedWidget, clearSavedWidget } from '@/utils/savedWidget';
import { reindexAppEntities } from '@/utils/appIntents';
import type { Schedule as ScheduleType } from '@/types/schedule';
import { getMeetData } from '@/lib/database/offline-store';
import { getCachedAuthState } from '@/lib/authCache';
import { posthog } from '@/lib/posthog';
import { generateSessionId, getSavedSessionsKey } from '@/utils/session';
import {
  deleteSavedSession as deleteSavedSessionFromApi,
  deleteSavedSessions as deleteSavedSessionsFromApi,
  fetchSavedSessions,
  fetchUserPreferences,
  putSavedSession,
  MeetCalApiError,
  MeetCalApiTimeoutError,
} from '@/lib/api/meetcal-api';

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

/** A session reminder fires this long before the session's start time. */
const NOTIFICATION_LEAD_MS = 60 * 60 * 1000;

/**
 * Saving a session used to emit ~15 `console.log` lines — including the same
 * instant formatted in three timezones — on every save, in production. Keep
 * the trace, keep it out of release builds.
 */
function logNotificationScheduling(step: string, detail?: unknown): void {
  if (!__DEV__) return;
  console.log(`[notifications] ${step}`, detail);
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
  const { getToken } = useAuth();
  const { selectedMeet } = useSelectedMeet();
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [storageUserId, setStorageUserId] = useState<string | null>(null);
  const [hasResolvedUser, setHasResolvedUser] = useState(false);
  const sessionsRawRef = useRef<string | null>(null);
  const sessionsRef = useRef<SavedSession[]>([]);
  const activeUserId = user?.id ?? storageUserId;

  useEffect(() => {
    let cancelled = false;

    const resolveUser = async () => {
      if (user?.id) {
        if (!cancelled) {
          setStorageUserId(user.id);
          setHasResolvedUser(true);
        }
        return;
      }

      const cachedAuthState = await getCachedAuthState().catch(() => null);
      if (cancelled) return;

      if (cachedAuthState?.isSignedIn && cachedAuthState.userId) {
        setStorageUserId(cachedAuthState.userId);
      } else {
        setStorageUserId(null);
      }
      setHasResolvedUser(true);
    };

    resolveUser();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!hasResolvedUser || activeUserId) return;
    setSavedSessions([]);
    setIsLoading(false);
    clearSavedWidget();
    sessionsRawRef.current = null;
    sessionsRef.current = [];
  }, [hasResolvedUser, activeUserId]);

  useEffect(() => {
    if (!selectedMeet) {
      syncSavedWidget(null, savedSessions);
      void reindexAppEntities();
      return;
    }
    getMeetConfig(selectedMeet)
      .then(config =>
        syncSavedWidget(selectedMeet, savedSessions, config?.time?.timeZoneIdentifier ?? 'UTC')
      )
      .catch(() => syncSavedWidget(selectedMeet, savedSessions, 'UTC'))
      .finally(() => {
        void reindexAppEntities();
      });
  }, [selectedMeet, savedSessions]);

  useEffect(() => {
    if (activeUserId) {
      loadSavedSessions();
    } else if (hasResolvedUser) {
      setSavedSessions([]);
      setIsLoading(false);
    }
  }, [activeUserId, hasResolvedUser]);

  const commitSessions = useCallback(async (nextSessions: SavedSession[]) => {
    if (!activeUserId) return;
    const serialized = JSON.stringify(nextSessions);
    if (sessionsRawRef.current !== serialized) {
      await AsyncStorage.setItem(getSavedSessionsKey(activeUserId), serialized);
      sessionsRawRef.current = serialized;
    }
    sessionsRef.current = nextSessions;
    setSavedSessions(nextSessions);
  }, [activeUserId]);

  const readStoredSessions = useCallback(async (forceStorageRead = false): Promise<SavedSession[]> => {
    if (!activeUserId) return [];
    if (!forceStorageRead && sessionsRawRef.current !== null) {
      return sessionsRef.current;
    }
    const raw = await AsyncStorage.getItem(getSavedSessionsKey(activeUserId));
    if (raw && raw === sessionsRawRef.current) {
      return sessionsRef.current;
    }

    const parsedSessions = parseStoredSessions(raw).filter((session) => session.meet);
    sessionsRawRef.current = raw;
    sessionsRef.current = parsedSessions;
    return parsedSessions;
  }, [activeUserId]);

  const loadSavedSessions = async () => {
    if (!activeUserId) {
      setSavedSessions([]);
      setIsLoading(false);
      return;
    }
    
    setIsLoading(true); // Set loading true at the start
    try {
      // Hydrate from local storage first so navigation to Saved shows data immediately.
      const localRaw = await AsyncStorage.getItem(getSavedSessionsKey(activeUserId));
      const localSessions = parseStoredSessions(localRaw).filter((session) => session.meet);
      sessionsRawRef.current = localRaw;
      sessionsRef.current = localSessions;
      setSavedSessions(localSessions);

      // Fetch from the API when Clerk can provide a fresh token.
      if (user?.id) {
        const token = await getToken().catch(() => null);
        if (!token) {
          setSavedSessions(localSessions);
          return;
        }
        const apiSessions = await fetchSavedSessions(token);

        if (apiSessions && apiSessions.length > 0) {
          const formattedSessions = apiSessions.map(s => ({
            id: s.session_id,
            meet: s.meet as MeetName,
            sessionNumber: s.session_number,
            platform: s.platform,
            weightClass: s.weight_class ?? '',
            startTime: s.start_time ?? '',
            weighInTime: calculateWeighInTime(s.start_time ?? ''),
            date: s.date ?? '',
            notes: s.notes ?? undefined,
            athleteNames: s.athlete_names,
          }));
          await commitSessions(formattedSessions);
        } else {
          if (localSessions.length === 0) {
            await AsyncStorage.removeItem(getSavedSessionsKey(activeUserId));
            sessionsRawRef.current = null;
            sessionsRef.current = [];
            setSavedSessions([]);
          } else {
            setSavedSessions(localSessions);
          }
        }
      } else {
        setSavedSessions(localSessions);
      }

      // Enforce the "auto-remove saved sessions 2 hours after they start"
      // preference. The backend stores the flag; the client applies it on load.
      await pruneStartedSessions();
    } catch (error) {
      console.error('Error loading saved sessions:', error);
      
      // Keep the three failure modes distinct. Sniffing `error.message` for
      // "network"/"fetch" matched nothing the API client actually throws, so
      // every failure read as an unexplained one.
      if (error instanceof MeetCalApiTimeoutError) {
        console.error('Saved sessions request timed out, falling back to local storage');
      } else if (error instanceof MeetCalApiError) {
        console.error('Saved sessions request rejected, falling back to local storage', {
          status: error.status,
        });
      } else {
        console.error('Network or storage failure, falling back to local storage');
      }
      
      // Attempt to load from local storage as a final fallback
      try {
        const saved = await AsyncStorage.getItem(getSavedSessionsKey(activeUserId));
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

  const saveSessionsFromAthletes = async (
    athletes: LiftResult[],
    meet: MeetName,
    scheduleOverride?: ScheduleType,
  ) => {
    if (!activeUserId) return false;
    
    try {
      const sessionMap = new Map<string, { session: SavedSession, athletes: string[] }>();
      let schedule = scheduleOverride ?? [];

      if (schedule.length === 0) {
        try {
          schedule = await fetchSchedule(meet);
        } catch (fetchError) {
          console.warn('saveSessionsFromAthletes: fetchSchedule failed, falling back to cached schedule', fetchError);
          const meetData = await getMeetData(meet).catch(() => null);
          schedule = meetData?.schedule ?? [];
        }
      }
      
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
            } else {
              const fallbackStartTime = athlete.session?.startTime ?? '';
              sessionMap.set(sessionId, {
                session: {
                  id: sessionId,
                  meet,
                  sessionNumber: athlete.session!.number,
                  platform: athlete.session!.platform,
                  weightClass: athlete.weightClass ?? '',
                  startTime: fallbackStartTime,
                  weighInTime: calculateWeighInTime(fallbackStartTime),
                  date: athlete.session?.date ?? '',
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

        // Call saveSession for each session to handle upsert and local state.
        // `schedule` is the same meet's schedule for every iteration, so hand
        // it over rather than letting each save re-fetch it.
        const success = await saveSession(sessionWithMergedData, { schedule });
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

  /**
   * @param options.schedule The meet's schedule when the caller already has
   * it. Notification scheduling (step 3 below) needs the session's day, and
   * `fetchSchedule` only de-duplicates *concurrent* callers — so the
   * sequential save loop in `saveSessionsFromAthletes` used to issue one full
   * `GET /meets/schedule` per saved session for the same meet. Passing the
   * already-resolved schedule collapses those back to the one fetch the
   * caller made. Must be non-empty: an empty schedule is exactly the case
   * where the fetch below is still worth making.
   */
  const saveSession = async (
    session: SavedSession,
    options?: { schedule?: ScheduleType },
  ) => {
    if (!activeUserId) return false;

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

      posthog.capture('session_saved', {
        meet: updatedSession.meet,
        session_number: updatedSession.sessionNumber,
        platform: updatedSession.platform,
        weight_class: updatedSession.weightClass,
        is_update: existingSessionIndex >= 0,
        athlete_count: updatedSession.athleteNames?.length ?? 0,
      });

      // 2. Upsert to the API when online/authenticated. Local save remains source of truth offline.
      if (user?.id) {
        try {
          const token = await getToken();
          if (!token) throw new Error('Missing Clerk token');
          await putSavedSession(token, updatedSession.id, {
            meet: updatedSession.meet,
            session_number: updatedSession.sessionNumber,
            platform: updatedSession.platform,
            weight_class: updatedSession.weightClass,
            start_time: updatedSession.startTime,
            date: updatedSession.date,
            notes: updatedSession.notes,
            athlete_names: updatedSession.athleteNames,
          });
        } catch (apiError) {
          console.error('Error saving session to API:', apiError);
          // Local save already succeeded, so keep success semantics for device caching.
        }
      }

      // 3. Schedule local notification 1 hour before session start time if notifications are enabled
      try {
        const notificationsEnabled = await AsyncStorage.getItem(NOTIFICATION_ENABLED_KEY);
        logNotificationScheduling('enabled', notificationsEnabled);

        if (notificationsEnabled === 'true') {
          const meetName = updatedSession.meet;
          const sessionNumber = updatedSession.sessionNumber;
          const platform = updatedSession.platform;
          const providedSchedule =
            options?.schedule && options.schedule.length > 0
              ? options.schedule
              : null;
          logNotificationScheduling(
            providedSchedule ? 'reusing caller schedule' : 'fetching schedule',
            {
              meetName,
              sessionNumber,
              platform,
            },
          );
          const schedule = providedSchedule ?? (await fetchSchedule(meetName));
          logNotificationScheduling('schedule days', schedule?.length ?? 0);

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
          logNotificationScheduling(
            'session found',
            foundSession ? sessionDayDate : false,
          );

          if (foundSession && sessionDayDate) {
            const startTime = getPlatformStartTime(foundSession, platform);
            
            // Get meet config for timezone information
            const meetConfig = await getMeetConfig(meetName);
            
            // Convert times to UTC using the meet's time zone (same as calendar events)
            const sessionDate = convertToUTC(
              startTime,
              sessionDayDate,
              meetConfig.time.timeZoneIdentifier,
            );
            
            const triggerDate = new Date(
              sessionDate.getTime() - NOTIFICATION_LEAD_MS,
            );
            const now = new Date();

            logNotificationScheduling('trigger', {
              sessionUtc: sessionDate.toISOString(),
              triggerUtc: triggerDate.toISOString(),
              meetZone: meetConfig.time.timeZoneIdentifier,
              willSchedule: triggerDate > now,
            });

            if (triggerDate > now) {
              const notificationId = await scheduleNotification(
                `Session Reminder`,
                `Session ${updatedSession.sessionNumber} ${updatedSession.platform} starts in 1 hour.`,
                triggerDate,
                updatedSession.id,
                {
                  id: updatedSession.id,
                  meet: updatedSession.meet,
                  sessionNumber: updatedSession.sessionNumber,
                  platform: updatedSession.platform,
                  weightClass: updatedSession.weightClass,
                  startTime,
                  weighInTime: calculateWeighInTime(startTime),
                  date: sessionDayDate,
                },
              );
              logNotificationScheduling('scheduled', notificationId);
            }
          }
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
    if (!activeUserId) return false;
    return savedSessions.some(session => session.id === sessionId);
  };

  const removeSession = async (sessionId: string) => {
    if (!activeUserId) return false;
    
    try {
      // *** Find the session before filtering ***
      const sessionToRemove = savedSessions.find(session => session.id === sessionId);

      // 1. Update local state and AsyncStorage
      const currentSessions = await readStoredSessions();
      const updatedSessions = currentSessions.filter(session => session.id !== sessionId);
      await commitSessions(updatedSessions);

      // 2. Delete from the API when online/authenticated.
      if (user?.id) {
        try {
          const token = await getToken();
          if (!token) throw new Error('Missing Clerk token');
          await deleteSavedSessionFromApi(token, sessionId);
        } catch (apiError) {
          console.error('Error removing session from API:', apiError);
        }
      }

      // *** Cancel notification ***
      if (sessionToRemove) {
        // Only attempt to cancel if the session was actually found
        try {
          const notificationsEnabled = await AsyncStorage.getItem(NOTIFICATION_ENABLED_KEY);
          if (notificationsEnabled === 'true') {
             // Only cancel if notifications were potentially scheduled
            await cancelNotification(sessionToRemove.id);
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

  // Removes saved sessions that started more than 2 hours ago, but only when the
  // user has the "auto-remove started sessions" preference enabled. Runs on load.
  const pruneStartedSessions = async () => {
    if (!user?.id) return;

    let token: string | null = null;
    try {
      token = await getToken();
    } catch {
      return;
    }
    if (!token) return;

    let autoUnsaveEnabled = false;
    try {
      const prefs = await fetchUserPreferences(token);
      autoUnsaveEnabled = prefs.auto_unsave_started_sessions;
    } catch (error) {
      console.error('pruneStartedSessions: failed to fetch preferences', error);
      return;
    }
    if (!autoUnsaveEnabled) return;

    const sessions = await readStoredSessions();
    if (sessions.length === 0) return;

    const now = new Date();
    const timeZoneByMeet = new Map<MeetName, string>();
    const expiredIds: string[] = [];

    for (const session of sessions) {
      if (!session.startTime || !session.date) continue;

      let timeZone = timeZoneByMeet.get(session.meet);
      if (timeZone === undefined) {
        try {
          const config = await getMeetConfig(session.meet);
          timeZone = config?.time?.timeZoneIdentifier ?? 'UTC';
        } catch {
          timeZone = 'UTC';
        }
        timeZoneByMeet.set(session.meet, timeZone);
      }

      let sessionStart: Date;
      try {
        sessionStart = convertToUTC(session.startTime, session.date, timeZone);
      } catch {
        continue;
      }

      if (hasSessionPassedAutoUnsaveWindow(sessionStart, now)) {
        expiredIds.push(session.id);
      }
    }

    for (const id of expiredIds) {
      await removeSession(id);
    }
  };

  const resetAllSessions = async (meet?: MeetName) => {
    if (!activeUserId) return false;
    try {
      if (meet) {
        // Filter out sessions for the selected meet locally
        const currentSessions = await readStoredSessions();
        const filteredSessions = currentSessions.filter(s => s.meet !== meet);
        await commitSessions(filteredSessions);
        // Delete only sessions for this meet from the API
        if (user?.id) {
          try {
            const token = await getToken();
            if (!token) throw new Error('Missing Clerk token');
            await deleteSavedSessionsFromApi(token, meet);
          } catch (e) {
            console.error('Error deleting sessions for meet from API:', e);
          }
        }
      } else {
        // 1. Clear all local storage and state
        await commitSessions([]);
        // 2. Delete all sessions for this user from the API
        if (user?.id) {
          try {
            const token = await getToken();
            if (!token) throw new Error('Missing Clerk token');
            await deleteSavedSessionsFromApi(token);
          } catch (e) {
            console.error('Error deleting sessions from API:', e);
          }
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
