import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MeetName, Meet } from '@/data/types/meet';
import { SyncManager } from '@/lib/database/sync-manager';
import { needsSync } from '@/lib/database/offline-store';
import { prefetchMeetData, updateMeetAccess, fetchMeets, fetchMeetByName } from '@/lib/database/meet-manager';

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

  // Enhanced setSelectedMeet function
  const setSelectedMeet = async (meet: MeetName) => {
    try {
      setIsSyncing(true);
      setSyncStatus('syncing');
      
      // Clear existing data first
      setSelectedMeetState(null);
      setMeetDetails(null);
      setSyncManager(null);
      
      // Find meet details from available meets
      const meetData = availableMeets.find(m => m.name === meet);
      if (!meetData) {
        throw new Error('Selected meet not found in available meets');
      }

      // Save to storage first
      await AsyncStorage.setItem('@selected_meet', meet);
      setSelectedMeetState(meet);
      setMeetDetails(meetData);
      
      // Create new sync manager for the meet
      const manager = new SyncManager(meet);
      setSyncManager(manager);
      
      // Prefetch data for the new meet
      if (manager) {
        await prefetchMeetData(meet);
        setLastSynced(Date.now());
      }
      setSyncStatus('idle');
    } catch (error) {
      console.error('Error saving selected meet:', error);
      setSyncStatus('error');
      // Clear everything on error
      setSelectedMeetState(null);
      setMeetDetails(null);
      setSyncManager(null);
      await AsyncStorage.removeItem('@selected_meet');
      throw error;
    } finally {
      setIsSyncing(false);
    }
  };

  // Initialize meet data
  const initializeMeetData = async (meet: MeetName, meetData: Meet) => {
    try {
      setIsSyncing(true);
      setSyncStatus('syncing');

      // Set meet state
      setSelectedMeetState(meet);
      setMeetDetails(meetData);

      // Create and set sync manager
      const manager = new SyncManager(meet);
      setSyncManager(manager);

      // Prefetch data
      await prefetchMeetData(meet);
      setLastSynced(Date.now());
      setSyncStatus('idle');
    } catch (error) {
      console.error('Error initializing meet data:', error);
      setSyncStatus('error');
      // Don't clear meet state on initial load error
    } finally {
      setIsSyncing(false);
    }
  };

  // Load available meets
  useEffect(() => {
    const loadMeets = async () => {
      try {
        const meets = await fetchMeets();
        setAvailableMeets(meets);

        if (meets.length === 0) {
          console.log('No meets available');
          setIsLoading(false);
          return;
        }

        // If we have a selected meet that's no longer in the available meets (e.g. became completed),
        // switch to the first available meet
        if (selectedMeet && !meets.find(m => m.name === selectedMeet)) {
          console.log('Selected meet no longer available, switching to first available meet');
          await AsyncStorage.removeItem('@selected_meet');
          await initializeMeetData(meets[0].name, meets[0]);
          return;
        }

        // Try to load stored meet if we don't have one selected
        if (!selectedMeet) {
          const stored = await AsyncStorage.getItem('@selected_meet');
          console.log('Stored meet from AsyncStorage:', stored);

          if (stored) {
            // Only use stored meet if it still exists in available meets
            const meetData = meets.find(m => m.name === stored);
            if (meetData) {
              await initializeMeetData(stored, meetData);
            } else {
              // Clear stored meet if it no longer exists
              await AsyncStorage.removeItem('@selected_meet');
              console.log('Stored meet no longer exists, using first available meet');
              await initializeMeetData(meets[0].name, meets[0]);
            }
          } else {
            // No stored meet, use first available
            console.log('No stored meet, using first available meet:', meets[0].name);
            await initializeMeetData(meets[0].name, meets[0]);
          }
        }
      } catch (error) {
        console.error('Error loading available meets:', error);
      } finally {
        setIsLoading(false);
      }
    };

    // Initial load
    loadMeets();

    // Set up periodic refresh every 5 minutes
    const refreshInterval = setInterval(loadMeets, 5 * 60 * 1000);

    // Cleanup interval on unmount
    return () => clearInterval(refreshInterval);
  }, [selectedMeet]); // Added selectedMeet as dependency since we use it in the effect

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
        forceSync
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