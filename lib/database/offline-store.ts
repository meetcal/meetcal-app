import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Schedule } from '@/types/schedule';
import type { LiftResult } from '@/data/types/athletes';
import { MeetName } from '@/data/types/meet';

const STORE_KEY = 'meetcal_offline_store';

export interface MeetData {
  schedule: Schedule | null;
  athletes: LiftResult[];
  lastSyncTime: number;
}

interface OfflineStore {
  meets: {
    [meetId: string]: MeetData;
  };
}

// Initialize store if it doesn't exist
export async function initStore(): Promise<void> {
  try {
    const store = await AsyncStorage.getItem(STORE_KEY);
    if (!store) {
      const initialStore: OfflineStore = {
        meets: {}
      };
      await AsyncStorage.setItem(STORE_KEY, JSON.stringify(initialStore));
    }
  } catch (error) {
    console.error('Error initializing store:', error);
  }
}

// Get meet data from store
export async function getMeetData(meetId: MeetName): Promise<MeetData> {
  try {
    const store = await getStore();
    if (!store.meets[meetId]) {
      store.meets[meetId] = {
        schedule: null,
        athletes: [],
        lastSyncTime: 0
      };
      await AsyncStorage.setItem(STORE_KEY, JSON.stringify(store));
    }
    return store.meets[meetId];
  } catch (error) {
    console.error('Error getting meet data:', error);
    throw error;
  }
}

// Save meet schedule to store
export async function saveMeetSchedule(meetId: string, schedule: Schedule): Promise<void> {
  try {
    const store = await getStore();
    if (!store.meets[meetId]) {
      store.meets[meetId] = {
        schedule: null,
        athletes: [],
        lastSyncTime: Date.now()
      };
    }
    store.meets[meetId].schedule = schedule;
    store.meets[meetId].lastSyncTime = Date.now();
    await AsyncStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch (error) {
    console.error('Error saving meet schedule:', error);
    throw error;
  }
}

// Save meet athletes to store
export async function saveMeetAthletes(meetId: string, athletes: LiftResult[]): Promise<void> {
  try {
    const store = await getStore();
    if (!store.meets[meetId]) {
      store.meets[meetId] = {
        schedule: null,
        athletes: [],
        lastSyncTime: Date.now()
      };
    }
    store.meets[meetId].athletes = athletes;
    store.meets[meetId].lastSyncTime = Date.now();
    await AsyncStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch (error) {
    console.error('Error saving meet athletes:', error);
    throw error;
  }
}

// Clear meet data from store
export async function clearMeetData(meet: MeetName): Promise<void> {
  try {
    const store = await AsyncStorage.getItem(STORE_KEY);
    if (store) {
      const data: OfflineStore = JSON.parse(store);
      delete data.meets[meet];
      await AsyncStorage.setItem(STORE_KEY, JSON.stringify(data));
    }
  } catch (error) {
    console.error('Error clearing meet data:', error);
  }
}

// Get last sync time for meet
export async function getLastSyncTime(meet: MeetName): Promise<number | null> {
  try {
    const store = await AsyncStorage.getItem(STORE_KEY);
    if (store) {
      const data: OfflineStore = JSON.parse(store);
      return data.meets[meet]?.lastSyncTime || null;
    }
    return null;
  } catch (error) {
    console.error('Error getting last sync time:', error);
    return null;
  }
}

// Check if meet data needs sync (older than 1 hour)
export async function needsSync(meet: MeetName): Promise<boolean> {
  const lastSync = await getLastSyncTime(meet);
  if (!lastSync) return true;
  
  const oneHour = 60 * 60 * 1000; // 1 hour in milliseconds
  return Date.now() - lastSync > oneHour;
}

async function getStore(): Promise<OfflineStore> {
  const store = await AsyncStorage.getItem(STORE_KEY);
  if (store) {
    return JSON.parse(store);
  } else {
    throw new Error('Store not initialized');
  }
} 