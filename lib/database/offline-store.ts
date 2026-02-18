import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Schedule } from '@/types/schedule';
import type { LiftResult, Platform, SupabaseLiftResult } from '@/data/types/athletes';
import type { Session, PlatformSession } from '@/data/types/schedule';
import { MeetName } from '@/data/types/meet';

const STORE_KEY = 'meetcal_offline_store';
const SCHEDULE_KEY_PREFIX = 'meetcal_schedule_';
const LIFTING_RESULTS_KEY_PREFIX = 'meetcal_lifting_results_';
const EXPLICIT_MEET_DOWNLOADS_KEY = 'meetcal_explicit_meet_downloads';

export interface MeetData {
  schedule: Schedule | null;
  scheduleKey: string;
  athletes: LiftResult[];
  liftingResultsKey: string;
  lastSyncTime: number;
}

async function getExplicitMeetDownloads(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(EXPLICIT_MEET_DOWNLOADS_KEY);
    if (!raw) return new Set<string>();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set<string>(parsed.filter((value) => typeof value === 'string'));
  } catch (error) {
    console.error('Error reading explicit meet downloads:', error);
    return new Set<string>();
  }
}

async function saveExplicitMeetDownloads(downloads: Set<string>): Promise<void> {
  try {
    await AsyncStorage.setItem(
      EXPLICIT_MEET_DOWNLOADS_KEY,
      JSON.stringify(Array.from(downloads)),
    );
  } catch (error) {
    console.error('Error saving explicit meet downloads:', error);
  }
}

export async function markMeetExplicitlyDownloaded(
  meetId: MeetName,
  downloaded: boolean
): Promise<void> {
  const downloads = await getExplicitMeetDownloads();
  if (downloaded) {
    downloads.add(meetId);
  } else {
    downloads.delete(meetId);
  }
  await saveExplicitMeetDownloads(downloads);
}

export async function isMeetExplicitlyDownloaded(meetId: MeetName): Promise<boolean> {
  const downloads = await getExplicitMeetDownloads();
  return downloads.has(meetId);
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
      const liftingResultsKey = `${LIFTING_RESULTS_KEY_PREFIX}${meetId}`;
      store.meets[meetId] = {
        schedule: null,
        scheduleKey,
        athletes: [],
        liftingResultsKey,
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
      liftingResultsKey: store.meets[meetId].liftingResultsKey,
      lastSyncTime: store.meets[meetId].lastSyncTime
    };
  } catch (error) {
    console.error('Error getting meet data:', error);
    throw error;
  }
}

// Get lifting results for an athlete from the cached meet data
export async function getAthleteLiftingResults(meetId: MeetName, athleteName: string): Promise<SupabaseLiftResult[]> {
  try {
    const meetData = await getMeetData(meetId);
    const liftingResultsKey = meetData.liftingResultsKey;
    
    if (!liftingResultsKey) {
      return [];
    }
    
    const liftingResultsString = await AsyncStorage.getItem(liftingResultsKey);
    if (!liftingResultsString) {
      return [];
    }
    
    const allResults: SupabaseLiftResult[] = JSON.parse(liftingResultsString);
    return allResults.filter(result => result.name === athleteName);
  } catch (error) {
    console.error('Error getting athlete lifting results:', error);
    return [];
  }
}

// Get all cached lifting results for a meet
export async function getMeetLiftingResults(meetId: MeetName): Promise<SupabaseLiftResult[]> {
  try {
    const meetData = await getMeetData(meetId);
    const liftingResultsKey = meetData.liftingResultsKey;

    if (!liftingResultsKey) {
      return [];
    }

    const liftingResultsString = await AsyncStorage.getItem(liftingResultsKey);
    if (!liftingResultsString) {
      return [];
    }

    return JSON.parse(liftingResultsString) as SupabaseLiftResult[];
  } catch (error) {
    console.error('Error getting meet lifting results:', error);
    return [];
  }
}

function normalizePlatformValue(platform: string | undefined): string {
  return (platform || '').trim().toLowerCase();
}

// Get athletes for a specific session/platform from cached meet data
export async function getSessionAthletesFromMeetCache(
  meetId: MeetName,
  sessionNumber: number,
  platform: string
): Promise<LiftResult[]> {
  try {
    const meetData = await getMeetData(meetId);
    const normalizedPlatform = normalizePlatformValue(platform);

    return meetData.athletes.filter((athlete) => {
      const athleteSession = athlete.session;
      if (!athleteSession) return false;
      if (athleteSession.number !== sessionNumber) return false;
      return normalizePlatformValue(athleteSession.platform) === normalizedPlatform;
    });
  } catch (error) {
    console.error('Error getting session athletes from cache:', error);
    return [];
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
    const currentLiftingResultsKey = store.meets[meetId]?.liftingResultsKey || `${LIFTING_RESULTS_KEY_PREFIX}${meetId}`;
    store.meets[meetId] = {
      schedule: null,
      scheduleKey: scheduleKey,
      athletes: currentAthletes,
      liftingResultsKey: currentLiftingResultsKey,
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
      const liftingResultsKey = `${LIFTING_RESULTS_KEY_PREFIX}${meetId}`;
      store.meets[meetId] = {
        schedule: null,
        scheduleKey,
        athletes: [],
        liftingResultsKey,
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

// Save lifting results for all athletes in a meet
export async function saveMeetLiftingResults(meetId: string, liftingResults: SupabaseLiftResult[]): Promise<void> {
  try {
    const liftingResultsKey = `${LIFTING_RESULTS_KEY_PREFIX}${meetId}`;
    const liftingResultsString = JSON.stringify(liftingResults);
    await AsyncStorage.setItem(liftingResultsKey, liftingResultsString);
    
    // Update store metadata
    const store = await getStore();
    if (!store.meets[meetId]) {
      const scheduleKey = `${SCHEDULE_KEY_PREFIX}${meetId}`;
      store.meets[meetId] = {
        schedule: null,
        scheduleKey,
        athletes: [],
        liftingResultsKey,
        lastSyncTime: Date.now()
      };
    } else {
      store.meets[meetId].liftingResultsKey = liftingResultsKey;
      store.meets[meetId].lastSyncTime = Date.now();
    }
    await AsyncStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch (error) {
    console.error('Error saving meet lifting results:', error);
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
      const liftingResultsKey = data.meets[meet]?.liftingResultsKey;
      if (scheduleKey) {
        await AsyncStorage.removeItem(scheduleKey);
      }
      if (liftingResultsKey) {
        await AsyncStorage.removeItem(liftingResultsKey);
      }
      const emptyMeetData: MeetData = {
        schedule: null,
        scheduleKey: `${SCHEDULE_KEY_PREFIX}${meet}`,
        athletes: [],
        liftingResultsKey: `${LIFTING_RESULTS_KEY_PREFIX}${meet}`,
        lastSyncTime: 0
      };
      data.meets[meet] = emptyMeetData;
      await AsyncStorage.setItem(STORE_KEY, JSON.stringify(data));
    }
    await markMeetExplicitlyDownloaded(meet, false);
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
