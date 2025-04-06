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

  // Load available meets
  useEffect(() => {
    const loadMeets = async () => {
      try {
        console.log('Fetching available meets...');
        const meets = await fetchMeets();
        console.log('Available meets:', meets);
        setAvailableMeets(meets);

        // If no meet is selected yet, try to load from storage
        if (!selectedMeet) {
          const stored = await AsyncStorage.getItem('@selected_meet');
          console.log('Stored meet from AsyncStorage:', stored);

          if (stored) {
            // Only use stored meet if it still exists in available meets
            const meetData = meets.find(m => m.name === stored);
            if (meetData) {
              console.log('Setting initial meet to stored meet:', stored);
              setSelectedMeetState(stored);
              setMeetDetails(meetData);
            } else {
              // Clear stored meet if it no longer exists
              await AsyncStorage.removeItem('@selected_meet');
              console.log('Stored meet no longer exists, cleared from storage');
            }
          }
        }
      } catch (error) {
        console.error('Error loading available meets:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadMeets();
  }, []);

  // Initialize SyncManager when meet changes
  useEffect(() => {
    if (selectedMeet) {
      setSyncManager(new SyncManager(selectedMeet));
    } else {
      setSyncManager(null);
    }
  }, [selectedMeet]);

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