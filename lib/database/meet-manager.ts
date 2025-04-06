import AsyncStorage from '@react-native-async-storage/async-storage';
import { MeetName, Meet } from '@/data/types/meet';
import { SyncManager } from './sync-manager';
import { clearMeetData, getMeetData } from './offline-store';
import { supabase } from '@/lib/supabase';

const CACHE_SIZE_LIMIT = 50 * 1024 * 1024; // 50MB
const MAX_CACHED_MEETS = 3;
const MEET_CACHE_KEY = '@meet_cache_info';

interface MeetInfo {
  lastAccessed: number;
  size: number;
}

interface MeetCacheInfo {
  meets: Record<string, MeetInfo | undefined>;
  totalSize: number;
}

const EMPTY_CACHE: MeetCacheInfo = {
  meets: {},
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

// Fetch all meets from Supabase
export async function fetchMeets(): Promise<Meet[]> {
  try {
    console.log('Fetching all meets from Supabase...');
    
    // First check what tables we have access to
    const { data: tables } = await supabase
      .from('pg_catalog.pg_tables')
      .select('tablename')
      .eq('schemaname', 'public');
    console.log('Available tables:', tables);

    const { data: meetsData, error } = await supabase
      .from('meets')
      .select('*')
      .neq('status', 'completed')
      .order('start_date', { ascending: true });

    if (error) {
      console.error('Error fetching meets:', error);
      console.error('Error details:', error.message);
      console.error('Error code:', error.code);
      throw error;
    }

    console.log('Successfully fetched meets:', meetsData);
    
    return meetsData.map(meet => ({
      id: meet.id,
      name: meet.name,
      venue: {
        name: meet.venue_name,
        address: {
          street: meet.venue_street,
          city: meet.venue_city,
          state: meet.venue_state,
          zip: meet.venue_zip
        }
      },
      time: {
        timeZone: meet.time_zone,
        timeZoneIdentifier: meet.time_zone
      },
      dates: {
        start: meet.start_date,
        end: meet.end_date
      },
      status: meet.status
    }));
  } catch (error) {
    console.error('Error in fetchMeets:', error);
    throw error;
  }
}

// Fetch a single meet by name
export async function fetchMeetByName(name: string): Promise<Meet | null> {
  try {
    console.log('Fetching meet by name:', name);
    
    const { data: meet, error } = await supabase
      .from('meets')
      .select('*')
      .eq('name', name)
      .single();

    if (error) {
      console.error('Error fetching meet by name:', error);
      console.error('Error details:', error.message);
      console.error('Error code:', error.code);
      throw error;
    }

    if (!meet) {
      console.log('No meet found with name:', name);
      return null;
    }

    console.log('Successfully fetched meet:', meet);

    return {
      id: meet.id,
      name: meet.name,
      venue: {
        name: meet.venue_name,
        address: {
          street: meet.venue_street,
          city: meet.venue_city,
          state: meet.venue_state,
          zip: meet.venue_zip
        }
      },
      time: {
        timeZone: meet.time_zone,
        timeZoneIdentifier: meet.time_zone
      },
      dates: {
        start: meet.start_date,
        end: meet.end_date
      },
      status: meet.status
    };
  } catch (error) {
    console.error('Error in fetchMeetByName:', error);
    throw error;
  }
}

// Calculate meet size
async function calculateMeetSize(meet: MeetName): Promise<number> {
  try {
    const data = await getMeetData(meet);
    return new Blob([JSON.stringify(data)]).size;
  } catch (error) {
    console.error('Error calculating meet size:', error);
    return 0;
  }
}

// Update meet access time and size
export async function updateMeetAccess(meet: MeetName) {
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
  
  for (const [meet] of meetsToRemove) {
    await clearMeetData(meet);
    delete info.meets[meet];
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
  
  for (const [meet] of meets.slice(1)) {
    await clearMeetData(meet);
    const meetInfo = info.meets[meet];
    if (meetInfo) {
      info.totalSize -= meetInfo.size;
    }
    delete info.meets[meet];
    
    if (info.totalSize <= CACHE_SIZE_LIMIT) {
      break;
    }
  }
  
  await saveCacheInfo(info);
}

// Prefetch meet data
export async function prefetchMeetData(meet: MeetName) {
  const syncManager = new SyncManager(meet);
  await syncManager.syncIfNeeded();
  await updateMeetAccess(meet);
} 