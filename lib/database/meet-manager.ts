import AsyncStorage from '@react-native-async-storage/async-storage';
import { MeetName } from '@/data/types/meet';
import { SyncManager } from './sync-manager';
import { clearMeetData, getMeetData } from './offline-store';

const CACHE_SIZE_LIMIT = 50 * 1024 * 1024; // 50MB
const MAX_CACHED_MEETS = 3;
const MEET_CACHE_KEY = '@meet_cache_info';

interface MeetInfo {
  lastAccessed: number;
  size: number;
}

interface MeetCacheInfo {
  meets: Record<MeetName, MeetInfo | undefined>;
  totalSize: number;
}

const EMPTY_CACHE: MeetCacheInfo = {
  meets: {
    'USAW Master\'s Nationals': undefined,
    'Florida WSO Champs': undefined
  },
  totalSize: 0
};

// Initialize or get cache info
async function getCacheInfo(): Promise<MeetCacheInfo> {
  try {
    const info = await AsyncStorage.getItem(MEET_CACHE_KEY);
    if (info) {
      return JSON.parse(info);
    }
    return EMPTY_CACHE;
  } catch (error) {
    console.error('Error getting cache info:', error);
    return EMPTY_CACHE;
  }
}

// Save cache info
async function saveCacheInfo(info: MeetCacheInfo) {
  try {
    await AsyncStorage.setItem(MEET_CACHE_KEY, JSON.stringify(info));
  } catch (error) {
    console.error('Error saving cache info:', error);
  }
}

// Calculate size of meet data
async function calculateMeetSize(meet: MeetName): Promise<number> {
  try {
    const data = await getMeetData(meet);
    const size = new TextEncoder().encode(JSON.stringify(data)).length;
    return size;
  } catch (error) {
    console.error('Error calculating meet size:', error);
    return 0;
  }
}

// Update meet access time and size
async function updateMeetAccess(meet: MeetName) {
  const info = await getCacheInfo();
  const size = await calculateMeetSize(meet);
  
  // Update total size
  const currentMeetInfo = info.meets[meet];
  if (currentMeetInfo) {
    info.totalSize -= currentMeetInfo.size;
  }
  info.totalSize += size;
  
  // Update meet info
  info.meets[meet] = {
    lastAccessed: Date.now(),
    size
  };
  
  await saveCacheInfo(info);
}

// Clean up old meet data
async function cleanupOldMeetData() {
  const info = await getCacheInfo();
  const meets = Object.entries(info.meets) as [MeetName, MeetInfo][];
  
  // Sort by last accessed time
  meets.sort(([, a], [, b]) => b.lastAccessed - a.lastAccessed);
  
  // Keep only recent meets
  const meetsToRemove = meets.slice(MAX_CACHED_MEETS);
  
  for (const [meet, meetInfo] of meetsToRemove) {
    await clearMeetData(meet);
    delete info.meets[meet];
    info.totalSize -= meetInfo.size;
  }
  
  await saveCacheInfo(info);
}

// Manage cache size
async function manageCacheSize() {
  const info = await getCacheInfo();
  
  if (info.totalSize <= CACHE_SIZE_LIMIT) {
    return;
  }
  
  const meets = Object.entries(info.meets) as [MeetName, MeetInfo][];
  meets.sort(([, a], [, b]) => b.lastAccessed - a.lastAccessed);
  
  // Remove oldest meets until under size limit
  for (const [meet, meetInfo] of meets.slice(MAX_CACHED_MEETS)) {
    if (info.totalSize <= CACHE_SIZE_LIMIT) break;
    
    await clearMeetData(meet);
    info.totalSize -= meetInfo.size;
    delete info.meets[meet];
  }
  
  await saveCacheInfo(info);
}

// Prefetch meet data
export async function prefetchMeetData(meet: MeetName): Promise<void> {
  const syncManager = new SyncManager(meet);
  
  try {
    // Sync data
    await syncManager.syncIfNeeded();
    
    // Update cache info
    await updateMeetAccess(meet);
    
    // Clean up if needed
    await cleanupOldMeetData();
    await manageCacheSize();
  } catch (error) {
    console.error('Error prefetching meet data:', error);
    throw error;
  }
}

// Export other functions that might be needed
export {
  cleanupOldMeetData,
  manageCacheSize,
  updateMeetAccess
}; 