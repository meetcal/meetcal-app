import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MeetName, Meet } from '@/data/types/meet';
import { SyncManager } from '@/lib/database/sync-manager';
import { clearExpiredDownloadedMeets } from '@/lib/database/offline-store';
import { prefetchMeetData, fetchMeetsFresh, getCachedMeets, warmMeetData } from '@/lib/database/meet-manager';
import { fetchApiMeetByName } from '@/lib/api/meetcal-api';
import { subscribeToNetworkChanges } from '@/lib/networkUtils';
import { reindexAppEntities } from '@/utils/appIntents';

type SelectedMeetContextType = {
  selectedMeet: MeetName | null;
  meetDetails: Meet | null;
  availableMeets: Meet[];
  setSelectedMeet: (meet: MeetName) => Promise<void>;
  isLoading: boolean;
  isSyncing: boolean;
  lastSynced: number | null;
  syncStatus: 'idle' | 'syncing' | 'error';
  forceSync: () => Promise<void>;
  refreshAvailableMeets: () => Promise<void>;
};

const SELECTED_MEET_KEY = '@selected_meet';
const SELECTED_MEET_DETAILS_KEY = '@selected_meet_details';

// Parse a persisted out-of-window Meet, ignoring stale JSON that belongs to a
// different meet than the one we're resolving.
function parseStoredMeetDetails(raw: string | null, expectedName: string): Meet | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const meet = parsed as Meet;
    return typeof meet.name === 'string' && meet.name === expectedName ? meet : null;
  } catch {
    return null;
  }
}

const SelectedMeetContext = createContext<SelectedMeetContextType | undefined>(undefined);

export function SelectedMeetProvider({ children }: { children: React.ReactNode }) {
  const [selectedMeet, setSelectedMeetState] = useState<MeetName | null>(null);
  const [meetDetails, setMeetDetails] = useState<Meet | null>(null);
  const [availableMeets, setAvailableMeets] = useState<Meet[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'error'>('idle');
  const [syncManager, setSyncManager] = useState<SyncManager | null>(null);
  const lastNetworkStateRef = useRef<boolean | null>(null);
  // Mirror of meetDetails so loadMeets can read the latest value without
  // taking it as a dependency (which would reset the 5-minute interval).
  const meetDetailsRef = useRef<Meet | null>(null);
  useEffect(() => {
    meetDetailsRef.current = meetDetails;
  }, [meetDetails]);

  const beginMeetWarmup = useCallback((meet: MeetName, label: string) => {
    setIsSyncing(true);
    setSyncStatus('syncing');

    warmMeetData(meet)
      .then(() => {
        setLastSynced(Date.now());
        setSyncStatus('idle');
      })
      .catch((error) => {
        console.error(`Error ${label}:`, error);
        setSyncStatus('error');
      })
      .finally(() => {
        setIsSyncing(false);
      });
  }, []);

  const activateMeet = useCallback((meet: MeetName, meetData: Meet) => {
    setSelectedMeetState(meet);
    setMeetDetails(meetData);

    setSyncManager((current) => {
      current?.stopSync();
      return new SyncManager(meet);
    });

    void reindexAppEntities();
  }, []);

  // Enhanced setSelectedMeet function with optimistic updates
  const setSelectedMeet = async (meet: MeetName) => {
    // Capture the current selection so a transient lookup failure can restore
    // it instead of discarding a previously valid meet.
    const previousMeet = selectedMeet;
    const previousMeetDetails = meetDetails;

    // Find meet details from available meets; fall back to fetching by name so
    // programmatic selection (deep links, dev tools) works for meets outside
    // the upcoming-meets window.
    let meetData = availableMeets.find(m => m.name === meet);
    let resolvedOutOfWindow = false;
    if (!meetData) {
      let fetched: Meet | null;
      try {
        fetched = await fetchApiMeetByName(meet);
      } catch (error) {
        // Lookup failed (network error, not a definitive "not found"). Keep
        // the previous valid selection and surface the error so the UI can
        // toast — do not clear storage or null the state.
        console.error('Error looking up selected meet:', error);
        setSyncStatus('error');
        throw error;
      }
      if (fetched) {
        meetData = fetched;
        resolvedOutOfWindow = true;
      }
    }

    if (!meetData) {
      // Definitively invalid: the lookup returned no meet. Clear selection.
      console.error('Selected meet not found in available meets');
      setSyncStatus('error');
      setSelectedMeetState(null);
      setMeetDetails(null);
      setSyncManager(null);
      await AsyncStorage.multiRemove([SELECTED_MEET_KEY, SELECTED_MEET_DETAILS_KEY]);
      throw new Error('Selected meet not found in available meets');
    }

    try {
      activateMeet(meet, meetData);

      // Save to storage. Persist the resolved Meet object for out-of-window
      // selections so an offline cold start can rehydrate it.
      await AsyncStorage.setItem(SELECTED_MEET_KEY, meet);
      if (resolvedOutOfWindow) {
        await AsyncStorage.setItem(SELECTED_MEET_DETAILS_KEY, JSON.stringify(meetData));
      } else {
        await AsyncStorage.removeItem(SELECTED_MEET_DETAILS_KEY);
      }

      beginMeetWarmup(meet, 'preloading meet data');
    } catch (error) {
      // Persisting failed after activation; restore the prior selection rather
      // than leaving inconsistent state.
      console.error('Error saving selected meet:', error);
      setSyncStatus('error');
      if (previousMeet && previousMeetDetails) {
        activateMeet(previousMeet, previousMeetDetails);
      } else {
        setSelectedMeetState(null);
        setMeetDetails(null);
        setSyncManager(null);
      }
      throw error;
    }
  };

  // Initialize meet data
  const initializeMeetData = useCallback(async (meet: MeetName, meetData: Meet) => {
    activateMeet(meet, meetData);
    beginMeetWarmup(meet, 'initializing meet data');
  }, [activateMeet, beginMeetWarmup]);

  const syncAvailableMeets = useCallback(async (options?: { forceFresh?: boolean }) => {
    await clearExpiredDownloadedMeets();

    const cached = options?.forceFresh ? [] : await getCachedMeets();
    if (cached.length > 0) {
      setAvailableMeets(cached);
    }

    try {
      const fresh = await fetchMeetsFresh();
      setAvailableMeets((current) => {
        const currentSerialized = JSON.stringify(current);
        const nextSerialized = JSON.stringify(fresh);
        return currentSerialized === nextSerialized ? current : fresh;
      });
      return fresh;
    } catch (error) {
      if (cached.length > 0) {
        return cached;
      }
      throw error;
    }
  }, []);

  // Load available meets
  const chooseMeet = useCallback(
    (meets: Meet[], stored: string | null) => {
      if (selectedMeet) {
        return meets.find((meet) => meet.name === selectedMeet) ?? null;
      }
      if (stored) {
        const storedMeet = meets.find((meet) => meet.name === stored);
        if (storedMeet) return storedMeet;
      }
      return meets[0] ?? null;
    },
    [selectedMeet],
  );

  const loadMeets = useCallback(async () => {
      try {
        void clearExpiredDownloadedMeets().catch((error) => {
          console.error('Error clearing expired downloaded meets:', error);
        });

        const [cachedMeets, stored, storedDetailsRaw] = await Promise.all([
          getCachedMeets(),
          AsyncStorage.getItem(SELECTED_MEET_KEY),
          AsyncStorage.getItem(SELECTED_MEET_DETAILS_KEY),
        ]);

        let activeMeet = selectedMeet;
        let initializedFromCache = false;
        let outOfWindowResolved = false;

        // A stored meet missing from the upcoming window may still be valid
        // (selected via dev tools or a deep link). It must be resolved by name
        // before chooseMeet can fall back to the first available meet.
        const pendingOutOfWindow =
          !activeMeet && !!stored && !cachedMeets.find(m => m.name === stored);

        // Paint the cached upcoming meets immediately for a fast first paint.
        // When an out-of-window meet is pending resolution, hold off on the
        // fallback choice so we don't stomp the user's stored selection —
        // resolution happens below and swaps the real meet in.
        if (cachedMeets.length > 0) {
          setAvailableMeets(cachedMeets);
          if (!pendingOutOfWindow) {
            const cachedChoice = chooseMeet(cachedMeets, stored);
            if (cachedChoice) {
              activeMeet = cachedChoice.name;
            }
            if (cachedChoice && !selectedMeet) {
              await initializeMeetData(cachedChoice.name, cachedChoice);
              initializedFromCache = true;
            }
          }
          setIsLoading(false);
        }

        // Resolve the stored out-of-window meet by name AFTER the cache paint,
        // so the by-name lookup's timeout never blocks first paint.
        if (pendingOutOfWindow && stored) {
          let resolved: Meet | null = null;
          let lookupFailed = false;
          try {
            resolved = await fetchApiMeetByName(stored);
          } catch {
            // Offline or lookup failure: rehydrate from the persisted details
            // so the user's out-of-window selection isn't silently dropped.
            lookupFailed = true;
            resolved = parseStoredMeetDetails(storedDetailsRaw, stored);
          }

          if (resolved) {
            await initializeMeetData(resolved.name, resolved);
            activeMeet = resolved.name;
            outOfWindowResolved = true;
            // Keep the persisted copy fresh for the next offline cold start.
            await AsyncStorage.setItem(
              SELECTED_MEET_DETAILS_KEY,
              JSON.stringify(resolved),
            );
          } else {
            // Neither the window cache nor persisted details have the meet.
            if (!lookupFailed) {
              // Online lookup confirmed the stored meet no longer exists —
              // clean up the stale keys before falling back.
              await AsyncStorage.multiRemove([
                SELECTED_MEET_KEY,
                SELECTED_MEET_DETAILS_KEY,
              ]);
            }
            const fallback = chooseMeet(cachedMeets, lookupFailed ? stored : null);
            if (fallback) {
              activeMeet = fallback.name;
              if (!selectedMeet) {
                await initializeMeetData(fallback.name, fallback);
                initializedFromCache = true;
              }
            }
          }
        }

        const freshMeets = await fetchMeetsFresh();
        setAvailableMeets((current) => {
          const currentSerialized = JSON.stringify(current);
          const nextSerialized = JSON.stringify(freshMeets);
          return currentSerialized === nextSerialized ? current : freshMeets;
        });

        if (freshMeets.length === 0) {
          console.log('No meets available');
          setIsLoading(false);
          return;
        }

        if (activeMeet && !freshMeets.find(m => m.name === activeMeet)) {
          if (outOfWindowResolved) {
            // Already validated by name above — keep it.
            return;
          }
          // When the out-of-window meet is already the active selection with
          // its details loaded, it was resolved on a prior run. Skip the
          // by-name refetch + re-initialization so we don't churn a new
          // SyncManager and re-warm every 5 minutes / on every reconnect.
          if (activeMeet === selectedMeet && meetDetailsRef.current?.name === activeMeet) {
            return;
          }
          // Not in the upcoming window, but it may still be a valid meet
          // (selected via dev tools or a deep link) — only revert when the
          // meet can't be resolved by name at all.
          let outOfWindowMeet: Meet | null = null;
          try {
            outOfWindowMeet = await fetchApiMeetByName(activeMeet);
          } catch {
            // Network hiccup: keep the current selection rather than
            // discarding the user's meet on a failed lookup.
            return;
          }
          if (outOfWindowMeet) {
            await initializeMeetData(outOfWindowMeet.name, outOfWindowMeet);
            // Persist so an offline cold start can rehydrate this selection.
            await AsyncStorage.setItem(
              SELECTED_MEET_DETAILS_KEY,
              JSON.stringify(outOfWindowMeet),
            );
            return;
          }
          console.log('Selected meet no longer available, switching to first available meet');
          await AsyncStorage.multiRemove([SELECTED_MEET_KEY, SELECTED_MEET_DETAILS_KEY]);
          await initializeMeetData(freshMeets[0].name, freshMeets[0]);
          return;
        }

        if (!initializedFromCache && !activeMeet) {
          const freshChoice = chooseMeet(freshMeets, stored);
          if (freshChoice) {
            await initializeMeetData(freshChoice.name, freshChoice);
          }
        }
      } catch (error) {
        console.error('Error loading available meets:', error);
      } finally {
        setIsLoading(false);
      }
  }, [chooseMeet, initializeMeetData, selectedMeet]);

    // Initial load
  useEffect(() => {
    loadMeets();

    // Set up periodic refresh every 5 minutes
    const refreshInterval = setInterval(loadMeets, 5 * 60 * 1000);

    // Cleanup interval on unmount
    return () => clearInterval(refreshInterval);
  }, [loadMeets]);

  useEffect(() => {
    const unsubscribe = subscribeToNetworkChanges((isConnected) => {
      const wasConnected = lastNetworkStateRef.current;
      lastNetworkStateRef.current = isConnected;
      if (isConnected && wasConnected === false) {
        loadMeets();
      }
    });
    return () => {
      unsubscribe();
    };
  }, [loadMeets]);

  // Force sync function
  const forceSync = async () => {
    if (!syncManager || !selectedMeet) return;
    
    try {
      setIsSyncing(true);
      setSyncStatus('syncing');
      await prefetchMeetData(selectedMeet);
      setLastSynced(Date.now());
      setSyncStatus('idle');
    } catch (error) {
      console.error('Error forcing sync:', error);
      setSyncStatus('error');
    } finally {
      setIsSyncing(false);
    }
  };

  // Refresh available meets function
  const refreshAvailableMeets = async () => {
    try {
      setIsSyncing(true);
      setSyncStatus('syncing');
      const meets = await syncAvailableMeets({ forceFresh: true });
      setAvailableMeets(meets);
      setSyncStatus('idle');
    } catch (error) {
      console.error('Error refreshing available meets:', error);
      setSyncStatus('error');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <SelectedMeetContext.Provider 
      value={{ 
        selectedMeet,
        meetDetails,
        availableMeets,
        setSelectedMeet,
        isLoading,
        isSyncing,
        lastSynced,
        syncStatus,
        forceSync,
        refreshAvailableMeets
      }}
    >
      {children}
    </SelectedMeetContext.Provider>
  );
}

export function useSelectedMeet() {
  const context = useContext(SelectedMeetContext);
  if (context === undefined) {
    throw new Error('useSelectedMeet must be used within a SelectedMeetProvider');
  }
  return context;
} 
