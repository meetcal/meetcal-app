import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Schedule } from '@/types/schedule';
import type { LiftResult, Platform } from '@/data/types/athletes';
import type { Session, PlatformSession } from '@/data/types/schedule';
import { MeetName } from '@/data/types/meet';

const STORE_KEY = 'meetcal_offline_store';
const SCHEDULE_KEY_PREFIX = 'meetcal_schedule_';

export interface MeetData {
  schedule: Schedule | null;
  scheduleKey: string;
  athletes: LiftResult[];
  lastSyncTime: number;
}

interface OfflineStore {
  meets: {
    [meetId: string]: MeetData;
  };
}

interface DbSession {
  id: number;
  session_id: number;
  platform: string;
  weight_class: string;
  start_time: string;
  weigh_in_time: string;
  meet: string;
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
      const scheduleKey = `${SCHEDULE_KEY_PREFIX}${meetId}`;
      store.meets[meetId] = {
        schedule: null,
        scheduleKey,
        athletes: [],
        lastSyncTime: 0
      };
      await AsyncStorage.setItem(STORE_KEY, JSON.stringify(store));
    }
    
    // Get the schedule if it exists
    const scheduleKey = store.meets[meetId].scheduleKey;
    let schedule: Schedule | null = null;
    
    if (scheduleKey) {
      const scheduleString = await AsyncStorage.getItem(scheduleKey);
      if (scheduleString) {
        schedule = JSON.parse(scheduleString);
      }
    }
    
    return {
      schedule,
      scheduleKey: store.meets[meetId].scheduleKey,
      athletes: store.meets[meetId].athletes,
      lastSyncTime: store.meets[meetId].lastSyncTime
    };
  } catch (error) {
    console.error('Error getting meet data:', error);
    throw error;
  }
}

// Validate and convert platform string to Platform type
function validatePlatform(platform: string): Platform {
  const validPlatforms: Platform[] = ['Red', 'White', 'Blue', 'Stars', 'Stripes', 'Rogue'];
  const normalizedPlatform = platform.charAt(0).toUpperCase() + platform.slice(1).toLowerCase();
  
  if (validPlatforms.includes(normalizedPlatform as Platform)) {
    return normalizedPlatform as Platform;
  }
  console.warn(`Invalid platform "${platform}", defaulting to "Blue"`);
  return 'Blue';
}

// Save meet schedule to store
export async function saveMeetSchedule(meetId: string, schedule: Schedule): Promise<void> {
  try {
    
    // Validate schedule structure
    if (!Array.isArray(schedule)) {
      console.error('Invalid schedule format: not an array');
      throw new Error('Invalid schedule format');
    }

    if (schedule.length === 0) {
      console.error('Invalid schedule: empty array');
      throw new Error('Empty schedule');
    }

    // Validate each day's structure
    schedule.forEach((day, index) => {
      if (!day.date || !day.fullDate || !Array.isArray(day.sessions)) {
        console.error(`Invalid day structure at index ${index}:`, day);
        throw new Error(`Invalid day structure at index ${index}`);
      }

      day.sessions.forEach((session, sessionIndex) => {
        if (!session.id || !session.number || !session.startTime || !session.weighInTime || !Array.isArray(session.platforms)) {
          console.error(`Invalid session structure at day ${index}, session ${sessionIndex}:`, session);
          throw new Error(`Invalid session structure at day ${index}, session ${sessionIndex}`);
        }
      });
    });

    // Save schedule separately
    const scheduleKey = `${SCHEDULE_KEY_PREFIX}${meetId}`;
    const scheduleString = JSON.stringify(schedule);
    await AsyncStorage.setItem(scheduleKey, scheduleString);

    // Get current store state
    const store = await getStore();
    
    // Update meet metadata: ONLY store the key and sync time, NOT the full schedule object
    const currentAthletes = store.meets[meetId]?.athletes || [];
    store.meets[meetId] = {
      schedule: null,
      scheduleKey: scheduleKey,
      athletes: currentAthletes,
      lastSyncTime: Date.now()
    };
    
    // Save the updated store metadata (now much smaller)
    const storeString = JSON.stringify(store);
    await AsyncStorage.setItem(STORE_KEY, storeString);


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
      const scheduleKey = `${SCHEDULE_KEY_PREFIX}${meetId}`;
      store.meets[meetId] = {
        schedule: null,
        scheduleKey,
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
      const scheduleKey = data.meets[meet]?.scheduleKey;
      if (scheduleKey) {
        await AsyncStorage.removeItem(scheduleKey);
      }
      const emptyMeetData: MeetData = {
        schedule: null,
        scheduleKey: `${SCHEDULE_KEY_PREFIX}${meet}`,
        athletes: [],
        lastSyncTime: 0
      };
      data.meets[meet] = emptyMeetData;
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