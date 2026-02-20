import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Schedule } from '@/types/schedule';
import type { LiftResult, Platform, SupabaseLiftResult } from '@/data/types/athletes';
import type { Session, PlatformSession } from '@/data/types/schedule';
import { MeetName } from '@/data/types/meet';
import { Buffer } from 'buffer';
import pako from 'pako';


const STORE_KEY = 'meetcal_offline_store';
const SCHEDULE_KEY_PREFIX = 'meetcal_schedule_';
const ATHLETES_KEY_PREFIX = 'meetcal_athletes_';
const LIFTING_RESULTS_KEY_PREFIX = 'meetcal_lifting_results_';
const EXPLICIT_MEET_DOWNLOADS_KEY = 'meetcal_explicit_meet_downloads';
const LIFTING_RESULTS_CHUNK_SIZE = 180_000;
const LIFTING_RESULTS_FORMAT = 'deflate-base64-chunks-v1';

export interface MeetData {
  schedule: Schedule | null;
  scheduleKey: string;
  athletesKey: string;
  athletes: LiftResult[];
  liftingResultsKey: string;
  lastSyncTime: number;
}

type ExplicitMeetDownloadEntry = {
  markedAt: number;
  endDate?: string;
};

type ExplicitMeetDownloads = Record<string, ExplicitMeetDownloadEntry>;

async function getExplicitMeetDownloads(): Promise<ExplicitMeetDownloads> {
  try {
    const raw = await AsyncStorage.getItem(EXPLICIT_MEET_DOWNLOADS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);

    // Backward compatibility with older shape: string[]
    if (Array.isArray(parsed)) {
      return parsed.reduce<ExplicitMeetDownloads>((acc, value) => {
        if (typeof value !== 'string') return acc;
        acc[value] = { markedAt: 0 };
        return acc;
      }, {});
    }

    if (parsed && typeof parsed === 'object') {
      const entries = Object.entries(parsed as Record<string, unknown>);
      return entries.reduce<ExplicitMeetDownloads>((acc, [meetId, value]) => {
        if (!value || typeof value !== 'object') return acc;
        const entry = value as { markedAt?: unknown; endDate?: unknown };
        acc[meetId] = {
          markedAt:
            typeof entry.markedAt === 'number' ? entry.markedAt : Date.now(),
          ...(typeof entry.endDate === 'string' ? { endDate: entry.endDate } : {}),
        };
        return acc;
      }, {});
    }

    return {};
  } catch (error) {
    console.error('Error reading explicit meet downloads:', error);
    return {};
  }
}

async function saveExplicitMeetDownloads(downloads: ExplicitMeetDownloads): Promise<void> {
  try {
    await AsyncStorage.setItem(
      EXPLICIT_MEET_DOWNLOADS_KEY,
      JSON.stringify(downloads),
    );
  } catch (error) {
    console.error('Error saving explicit meet downloads:', error);
  }
}

export async function markMeetExplicitlyDownloaded(
  meetId: MeetName,
  downloaded: boolean,
  options?: { endDate?: string }
): Promise<void> {
  const downloads = await getExplicitMeetDownloads();
  if (downloaded) {
    downloads[meetId] = {
      markedAt: Date.now(),
      ...(options?.endDate ? { endDate: options.endDate } : {}),
    };
  } else {
    delete downloads[meetId];
  }
  await saveExplicitMeetDownloads(downloads);
}

export async function isMeetExplicitlyDownloaded(meetId: MeetName): Promise<boolean> {
  const downloads = await getExplicitMeetDownloads();
  return Boolean(downloads[meetId]);
}

function hasMeetEnded(endDate: string): boolean {
  const parsed = new Date(`${endDate}T23:59:59`);
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() < Date.now();
}

export async function clearExpiredDownloadedMeets(): Promise<void> {
  try {
    const downloads = await getExplicitMeetDownloads();
    const downloadedMeetIds = Object.keys(downloads);

    for (const meetId of downloadedMeetIds) {
      const entry = downloads[meetId];
      if (!entry?.endDate) continue;
      if (!hasMeetEnded(entry.endDate)) continue;
      await clearMeetData(meetId as MeetName);
    }
  } catch (error) {
    console.error('Error clearing expired downloaded meets:', error);
  }
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

interface LiftingResultsManifest {
  format: typeof LIFTING_RESULTS_FORMAT;
  chunks: number;
}

function getLiftingResultsChunkKey(baseKey: string, index: number): string {
  return `${baseKey}__chunk_${index}`;
}

function isLiftingResultsManifest(value: unknown): value is LiftingResultsManifest {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { format?: string }).format === LIFTING_RESULTS_FORMAT &&
    typeof (value as { chunks?: unknown }).chunks === 'number'
  );
}

function splitIntoChunks(value: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += chunkSize) {
    chunks.push(value.slice(i, i + chunkSize));
  }
  return chunks;
}

function encodeLiftingResults(results: SupabaseLiftResult[]): string {
  const json = JSON.stringify(results);
  const compressed = pako.deflate(json);
  return Buffer.from(compressed).toString('base64');
}

function decodeLiftingResults(encoded: string): SupabaseLiftResult[] {
  const bytes = Buffer.from(encoded, 'base64');
  const inflated = pako.inflate(bytes);
  const json = Buffer.from(inflated).toString();
  return JSON.parse(json) as SupabaseLiftResult[];
}

async function clearStoredLiftingResultsValue(liftingResultsKey: string): Promise<void> {
  const current = await AsyncStorage.getItem(liftingResultsKey);
  if (!current) {
    return;
  }

  try {
    const parsed = JSON.parse(current) as unknown;
    if (isLiftingResultsManifest(parsed)) {
      const keys = [liftingResultsKey];
      for (let i = 0; i < parsed.chunks; i += 1) {
        keys.push(getLiftingResultsChunkKey(liftingResultsKey, i));
      }
      await AsyncStorage.multiRemove(keys);
      return;
    }
  } catch {
    // Legacy raw payload - fall through to single-key remove.
  }

  await AsyncStorage.removeItem(liftingResultsKey);
}

async function readStoredLiftingResults(
  liftingResultsKey: string,
): Promise<SupabaseLiftResult[]> {
  const payload = await AsyncStorage.getItem(liftingResultsKey);
  if (!payload) {
    return [];
  }

  try {
    const parsed = JSON.parse(payload) as unknown;

    if (Array.isArray(parsed)) {
      return parsed as SupabaseLiftResult[];
    }

    if (!isLiftingResultsManifest(parsed) || parsed.chunks <= 0) {
      return [];
    }

    const chunkKeys = Array.from({ length: parsed.chunks }, (_, index) =>
      getLiftingResultsChunkKey(liftingResultsKey, index),
    );
    const chunkEntries = await AsyncStorage.multiGet(chunkKeys);
    const chunkValues = chunkEntries.map(([, value]) => value ?? '');

    const emptyChunks = chunkValues.filter((v) => v.length === 0).length;
    if (emptyChunks > 0) {
      return [];
    }

    return decodeLiftingResults(chunkValues.join(''));
  } catch (error) {
    console.error('Error reading stored lifting results:', error);
    return [];
  }
}

async function writeStoredLiftingResults(
  liftingResultsKey: string,
  liftingResults: SupabaseLiftResult[],
): Promise<void> {
  await clearStoredLiftingResultsValue(liftingResultsKey);

  const encoded = encodeLiftingResults(liftingResults);
  const chunks = splitIntoChunks(encoded, LIFTING_RESULTS_CHUNK_SIZE);
  const manifest: LiftingResultsManifest = {
    format: LIFTING_RESULTS_FORMAT,
    chunks: chunks.length,
  };

  const chunkSizes: number[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunkKey = getLiftingResultsChunkKey(liftingResultsKey, i);
    await AsyncStorage.setItem(chunkKey, chunks[i]);
    chunkSizes.push(chunks[i].length);
    const verify = await AsyncStorage.getItem(chunkKey);
    if (!verify || verify.length === 0) {
      throw new Error(`Chunk ${i} failed to persist for ${liftingResultsKey}`);
    }
  }

  await AsyncStorage.setItem(liftingResultsKey, JSON.stringify(manifest));
}

async function readStoredAthletes(athletesKey: string, fallback: LiftResult[]): Promise<LiftResult[]> {
  try {
    const athletesString = await AsyncStorage.getItem(athletesKey);
    if (!athletesString) {
      return fallback;
    }
    const parsed = JSON.parse(athletesString);
    return Array.isArray(parsed) ? (parsed as LiftResult[]) : fallback;
  } catch (error) {
    console.error('Error reading stored athletes:', error);
    return fallback;
  }
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
      const athletesKey = `${ATHLETES_KEY_PREFIX}${meetId}`;
      const liftingResultsKey = `${LIFTING_RESULTS_KEY_PREFIX}${meetId}`;
      store.meets[meetId] = {
        schedule: null,
        scheduleKey,
        athletesKey,
        athletes: [],
        liftingResultsKey,
        lastSyncTime: 0
      };
      try {
        await AsyncStorage.setItem(STORE_KEY, JSON.stringify(store));
      } catch (metadataError) {
        console.warn('Initialized meet metadata in memory but failed to persist store:', metadataError);
      }
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
    
    const athletesKey = store.meets[meetId].athletesKey || `${ATHLETES_KEY_PREFIX}${meetId}`;
    const athletes = await readStoredAthletes(
      athletesKey,
      Array.isArray(store.meets[meetId].athletes) ? store.meets[meetId].athletes : [],
    );

    return {
      schedule,
      scheduleKey: store.meets[meetId].scheduleKey,
      athletesKey,
      athletes,
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
    
    const allResults = await readStoredLiftingResults(liftingResultsKey);
    const normalizedTargetName = normalizeAthleteName(athleteName);
    const filteredResults = allResults.filter(
      result => normalizeAthleteName(result.name) === normalizedTargetName
    );

    return filteredResults;
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

    return await readStoredLiftingResults(liftingResultsKey);
  } catch (error) {
    console.error('Error getting meet lifting results:', error);
    return [];
  }
}

function normalizePlatformValue(platform: string | undefined): string {
  return (platform || '').trim().toLowerCase();
}

function normalizeAthleteName(name: string | null | undefined): string {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
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
    const currentAthletesKey = store.meets[meetId]?.athletesKey || `${ATHLETES_KEY_PREFIX}${meetId}`;
    const currentLiftingResultsKey = store.meets[meetId]?.liftingResultsKey || `${LIFTING_RESULTS_KEY_PREFIX}${meetId}`;
    store.meets[meetId] = {
      schedule: null,
      scheduleKey: scheduleKey,
      athletesKey: currentAthletesKey,
      athletes: [],
      liftingResultsKey: currentLiftingResultsKey,
      lastSyncTime: Date.now()
    };
    
    // Save the updated store metadata (now much smaller)
    const storeString = JSON.stringify(store);
    try {
      await AsyncStorage.setItem(STORE_KEY, storeString);
    } catch (metadataError) {
      console.warn('Saved schedule payload but failed to update store metadata:', metadataError);
    }


  } catch (error) {
    console.error('Error saving meet schedule:', error);
    throw error;
  }
}

// Save meet athletes to store
export async function saveMeetAthletes(meetId: string, athletes: LiftResult[]): Promise<void> {
  try {
    const athletesKey = `${ATHLETES_KEY_PREFIX}${meetId}`;
    await AsyncStorage.setItem(athletesKey, JSON.stringify(athletes));

    const store = await getStore();
    if (!store.meets[meetId]) {
      const scheduleKey = `${SCHEDULE_KEY_PREFIX}${meetId}`;
      const liftingResultsKey = `${LIFTING_RESULTS_KEY_PREFIX}${meetId}`;
      store.meets[meetId] = {
        schedule: null,
        scheduleKey,
        athletesKey,
        athletes: [],
        liftingResultsKey,
        lastSyncTime: Date.now()
      };
    }
    store.meets[meetId].athletesKey = athletesKey;
    store.meets[meetId].athletes = [];
    store.meets[meetId].lastSyncTime = Date.now();
    try {
      await AsyncStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (metadataError) {
      console.warn('Saved athletes payload but failed to update store metadata:', metadataError);
    }
  } catch (error) {
    console.error('Error saving meet athletes:', error);
    throw error;
  }
}

// Save lifting results for all athletes in a meet
export async function saveMeetLiftingResults(meetId: string, liftingResults: SupabaseLiftResult[]): Promise<void> {
  try {
    const liftingResultsKey = `${LIFTING_RESULTS_KEY_PREFIX}${meetId}`;

    if (liftingResults.length === 0) {
      const existing = await AsyncStorage.getItem(liftingResultsKey);
      if (existing) {
        return;
      }
    }

    await writeStoredLiftingResults(liftingResultsKey, liftingResults);
    
    // Update store metadata
    const store = await getStore();
    if (!store.meets[meetId]) {
      const scheduleKey = `${SCHEDULE_KEY_PREFIX}${meetId}`;
      const athletesKey = `${ATHLETES_KEY_PREFIX}${meetId}`;
      store.meets[meetId] = {
        schedule: null,
        scheduleKey,
        athletesKey,
        athletes: [],
        liftingResultsKey,
        lastSyncTime: Date.now()
      };
    } else {
      store.meets[meetId].liftingResultsKey = liftingResultsKey;
      store.meets[meetId].lastSyncTime = Date.now();
    }
    try {
      await AsyncStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch (metadataError) {
      console.warn('Saved lifting results payload but failed to update store metadata:', metadataError);
    }
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
      const athletesKey = data.meets[meet]?.athletesKey || `${ATHLETES_KEY_PREFIX}${meet}`;
      const liftingResultsKey = data.meets[meet]?.liftingResultsKey;
      if (scheduleKey) {
        await AsyncStorage.removeItem(scheduleKey);
      }
      await AsyncStorage.removeItem(athletesKey);
      if (liftingResultsKey) {
        await clearStoredLiftingResultsValue(liftingResultsKey);
      }
      const emptyMeetData: MeetData = {
        schedule: null,
        scheduleKey: `${SCHEDULE_KEY_PREFIX}${meet}`,
        athletesKey: `${ATHLETES_KEY_PREFIX}${meet}`,
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

export async function clearImplicitMeetData(exceptMeet?: MeetName): Promise<void> {
  try {
    const store = await AsyncStorage.getItem(STORE_KEY);
    if (!store) return;
    const data: OfflineStore = JSON.parse(store);
    const meetIds = Object.keys(data.meets);

    for (const meetId of meetIds) {
      const meetName = meetId as MeetName;
      if (exceptMeet && meetName === exceptMeet) continue;
      const explicitlyDownloaded = await isMeetExplicitlyDownloaded(meetName);
      if (explicitlyDownloaded) continue;
      await clearMeetData(meetName);
    }
  } catch (error) {
    console.error('Error clearing implicit meet data:', error);
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
