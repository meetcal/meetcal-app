import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MeetName } from '@/data/types/meet';

type SelectedMeetContextType = {
  selectedMeet: MeetName;
  setSelectedMeet: (meet: MeetName) => Promise<void>;
  isLoading: boolean;
};

const SelectedMeetContext = createContext<SelectedMeetContextType | undefined>(undefined);

export function SelectedMeetProvider({ children }: { children: React.ReactNode }) {
  const [selectedMeet, setSelectedMeetState] = useState<MeetName>('USAW Master\'s Nationals');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Load selected meet from storage on mount
    const loadSelectedMeet = async () => {
      try {
        const stored = await AsyncStorage.getItem('@selected_meet');
        if (stored && (stored === 'USAW Master\'s Nationals' || stored === 'USAMW Master\'s Nationals')) {
          setSelectedMeetState(stored as MeetName);
        }
      } catch (error) {
        console.error('Error loading selected meet:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadSelectedMeet();
  }, []);

  const setSelectedMeet = async (meet: MeetName) => {
    try {
      await AsyncStorage.setItem('@selected_meet', meet);
      setSelectedMeetState(meet);
    } catch (error) {
      console.error('Error saving selected meet:', error);
      throw error;
    }
  };

  return (
    <SelectedMeetContext.Provider 
      value={{ 
        selectedMeet, 
        setSelectedMeet,
        isLoading
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