import { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

type SavedSession = {
  id: string;
  sessionNumber: string;
  platform: string;
  weightClass: string;
  startTime: string;
  weighInTime: string;
  notificationId?: string;
};

type SavedSessionsContextType = {
  savedSessions: SavedSession[];
  saveSession: (session: SavedSession) => Promise<void>;
  removeSession: (id: string) => Promise<void>;
  isSessionSaved: (id: string) => boolean;
  exportSessions: () => Promise<void>;
  importSessions: () => Promise<void>;
  isSyncing: boolean;
  saveNotificationId: (sessionId: string, notificationId: string) => Promise<void>;
  getNotificationId: (sessionId: string) => string | undefined;
  removeNotificationId: (sessionId: string) => Promise<void>;
};

const SavedSessionsContext = createContext<SavedSessionsContextType | undefined>(undefined);

const STORAGE_KEY = 'savedSessions';
const BACKUP_FILENAME = 'sessions_backup.json';

export function SavedSessionsProvider({ children }: { children: React.ReactNode }) {
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    loadSavedSessions();
  }, []);

  const loadSavedSessions = async () => {
    try {
      setIsSyncing(true);
      const savedData = await AsyncStorage.getItem(STORAGE_KEY);
      if (savedData) {
        setSavedSessions(JSON.parse(savedData));
      }
    } catch (error) {
      console.error('Error loading saved sessions:', error);
    } finally {
      setIsSyncing(false);
    }
  };

  const saveSession = async (session: SavedSession) => {
    try {
      setIsSyncing(true);
      const updatedSessions = [...savedSessions, session];
      setSavedSessions(updatedSessions);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedSessions));
      
      // Schedule notification when session is saved
      await scheduleWeighInNotification(session);
    } catch (error) {
      console.error('Error saving session:', error);
      throw error;
    } finally {
      setIsSyncing(false);
    }
  };

  const removeSession = async (sessionId: string) => {
    try {
      // Cancel notification before removing session
      await cancelWeighInNotification(sessionId);
      
      const updatedSessions = savedSessions.filter(s => s.id !== sessionId);
      setSavedSessions(updatedSessions);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedSessions));
    } catch (error) {
      console.error('Error removing session:', error);
      throw error;
    } finally {
      setIsSyncing(false);
    }
  };

  const exportSessions = async () => {
    try {
      setIsSyncing(true);
      const fileUri = `${FileSystem.documentDirectory}${BACKUP_FILENAME}`;
      await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(savedSessions));
      
      if (Platform.OS === 'ios') {
        await Sharing.shareAsync(fileUri);
      }
    } catch (error) {
      console.error('Error exporting sessions:', error);
      throw error;
    } finally {
      setIsSyncing(false);
    }
  };

  const importSessions = async () => {
    try {
      setIsSyncing(true);
      await loadSavedSessions();
    } catch (error) {
      console.error('Error importing sessions:', error);
      throw error;
    } finally {
      setIsSyncing(false);
    }
  };

  const isSessionSaved = (id: string) => {
    return savedSessions.some(session => session.id === id);
  };

  const saveNotificationId = async (sessionId: string, notificationId: string) => {
    try {
      const updatedSessions = savedSessions.map(session => 
        session.id === sessionId 
          ? { ...session, notificationId } 
          : session
      );
      setSavedSessions(updatedSessions);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedSessions));
    } catch (error) {
      console.error('Error saving notification ID:', error);
    }
  };

  const getNotificationId = (sessionId: string) => {
    const session = savedSessions.find(s => s.id === sessionId);
    return session?.notificationId;
  };

  const removeNotificationId = async (sessionId: string) => {
    try {
      const updatedSessions = savedSessions.map(session => 
        session.id === sessionId 
          ? { ...session, notificationId: undefined } 
          : session
      );
      setSavedSessions(updatedSessions);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedSessions));
    } catch (error) {
      console.error('Error removing notification ID:', error);
    }
  };

  return (
    <SavedSessionsContext.Provider 
      value={{ 
        savedSessions, 
        saveSession, 
        removeSession, 
        isSessionSaved,
        exportSessions,
        importSessions,
        isSyncing,
        saveNotificationId,
        getNotificationId,
        removeNotificationId
      }}
    >
      {children}
    </SavedSessionsContext.Provider>
  );
}

export function useSavedSessions() {
  const context = useContext(SavedSessionsContext);
  if (context === undefined) {
    throw new Error('useSavedSessions must be used within a SavedSessionsProvider');
  }
  return context;
} 