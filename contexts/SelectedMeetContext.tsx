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
    try {
      // Find meet details from available meets; fall back to fetching by
      // name so programmatic selection (deep links, dev tools) works for
      // meets outside the upcoming-meets window.
      let meetData = availableMeets.find(m => m.name === meet);
      if (!meetData) {
        meetData = (await fetchApiMeetByName(meet)) ?? undefined;
      }
      if (!meetData) {
        throw new Error('Selected meet not found in available meets');
      }

      activateMeet(meet, meetData);

      // Save to storage
      await AsyncStorage.setItem('@selected_meet', meet);

      beginMeetWarmup(meet, 'preloading meet data');

    } catch (error) {
      console.error('Error saving selected meet:', error);
      setSyncStatus('error');
      // Revert on error
      setSelectedMeetState(null);
      setMeetDetails(null);
      setSyncManager(null);
      await AsyncStorage.removeItem('@selected_meet');
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

        const [cachedMeets, stored] = await Promise.all([
          getCachedMeets(),
          AsyncStorage.getItem('@selected_meet'),
        ]);

        let activeMeet = selectedMeet;
        let initializedFromCache = false;
        let outOfWindowResolved = false;

        // A stored meet missing from the upcoming window may still be valid
        // (selected via dev tools or a deep link). Resolve it by name before
        // chooseMeet can fall back to the first available meet.
        if (!activeMeet && stored && !cachedMeets.find(m => m.name === stored)) {
          try {
            const storedMeet = await fetchApiMeetByName(stored);
            if (storedMeet) {
              await initializeMeetData(storedMeet.name, storedMeet);
              activeMeet = storedMeet.name;
              outOfWindowResolved = true;
            }
          } catch {
            // Offline or lookup failure: fall through to the normal flow.
          }
        }

        if (cachedMeets.length > 0) {
          setAvailableMeets(cachedMeets);
          if (!outOfWindowResolved) {
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
            return;
          }
          console.log('Selected meet no longer available, switching to first available meet');
          await AsyncStorage.removeItem('@selected_meet');
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
