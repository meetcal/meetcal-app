import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MeetName } from '@/data/types/meet';
import { SyncManager } from '@/lib/database/sync-manager';
import { needsSync } from '@/lib/database/offline-store';
import { prefetchMeetData, updateMeetAccess } from '@/lib/database/meet-manager';

type SelectedMeetContextType = {
  selectedMeet: MeetName;
  setSelectedMeet: (meet: MeetName) => Promise<void>;
  isLoading: boolean;
  isSyncing: boolean;
  lastSynced: number | null;
  syncStatus: 'idle' | 'syncing' | 'error';
  forceSync: () => Promise<void>;
};

const SelectedMeetContext = createContext<SelectedMeetContextType | undefined>(undefined);

export function SelectedMeetProvider({ children }: { children: React.ReactNode }) {
  const [selectedMeet, setSelectedMeetState] = useState<MeetName>('USAW Master\'s Nationals');
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'error'>('idle');
  const [syncManager, setSyncManager] = useState<SyncManager | null>(null);

  // Initialize SyncManager when meet changes
  useEffect(() => {
    setSyncManager(new SyncManager(selectedMeet));
  }, [selectedMeet]);

  // Load initial meet data
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        setIsLoading(true);
        // Load selected meet from storage
        const stored = await AsyncStorage.getItem('@selected_meet');
        if (stored && (stored === 'USAW Master\'s Nationals' || stored === 'USAMW Master\'s Nationals')) {
          setSelectedMeetState(stored as MeetName);
        }

        // Initialize sync manager
        const manager = new SyncManager(selectedMeet);
        setSyncManager(manager);

        // Check if we need to sync
        const shouldSync = await needsSync(selectedMeet);
        if (shouldSync) {
          setIsSyncing(true);
          setSyncStatus('syncing');
          await prefetchMeetData(selectedMeet);
          setLastSynced(Date.now());
          setSyncStatus('idle');
        } else {
          // Update access time even if we don't sync
          await updateMeetAccess(selectedMeet);
        }
      } catch (error) {
        console.error('Error loading initial meet data:', error);
        setSyncStatus('error');
      } finally {
        setIsLoading(false);
        setIsSyncing(false);
      }
    };

    loadInitialData();
  }, []);

  // Enhanced setSelectedMeet function
  const setSelectedMeet = async (meet: MeetName) => {
    try {
      setIsSyncing(true);
      setSyncStatus('syncing');
      
      // Save to storage first
      await AsyncStorage.setItem('@selected_meet', meet);
      setSelectedMeetState(meet);
      
      // Create new sync manager for the meet
      const manager = new SyncManager(meet);
      setSyncManager(manager);
      
      // Prefetch data for the new meet (includes cache management)
      await prefetchMeetData(meet);
      setLastSynced(Date.now());
      setSyncStatus('idle');
    } catch (error) {
      console.error('Error saving selected meet:', error);
      setSyncStatus('error');
      throw error;
    } finally {
      setIsSyncing(false);
    }
  };

  // Force sync function
  const forceSync = async () => {
    if (!syncManager) return;
    
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