import AsyncStorage from '@react-native-async-storage/async-storage';
import { MeetName, Meet, timezoneOffsets, USTimeZoneIdentifier } from '@/data/types/meet';
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

interface CacheInfo {
  totalSize: number;
  meets: { [key: string]: MeetInfo };
}

// Helper function to determine if a date is in DST
function isDateInDST(date: Date, timeZoneIdentifier: USTimeZoneIdentifier): boolean {
  // Phoenix and Honolulu don't observe DST
  if (timeZoneIdentifier === 'America/Phoenix' || timeZoneIdentifier === 'Pacific/Honolulu') {
    return false;
  }

  const jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
  const dst = Math.max(jan, jul) !== date.getTimezoneOffset();
  return dst;
}

// Helper function to get UTC offset for a timezone at a specific date
function getUTCOffsetForDate(timeZoneIdentifier: USTimeZoneIdentifier, date: Date): number {
  const isDST = isDateInDST(date, timeZoneIdentifier);
  return timezoneOffsets[timeZoneIdentifier][isDST ? 'dst' : 'standard'];
}

// Initialize or get cache info
async function getCacheInfo(): Promise<CacheInfo> {
  try {
    const info = await AsyncStorage.getItem(MEET_CACHE_KEY);
    if (info) {
      return JSON.parse(info);
    }
    return {
      totalSize: 0,
      meets: {}
    };
  } catch (error) {
    console.error('Error getting cache info:', error);
    return {
      totalSize: 0,
      meets: {}
    };
  }
}

// Save cache info
async function saveCacheInfo(info: CacheInfo) {
  try {
    await AsyncStorage.setItem(MEET_CACHE_KEY, JSON.stringify(info));
  } catch (error) {
    console.error('Error saving cache info:', error);
  }
}

// Fetch all meets from Supabase
export async function fetchMeets(): Promise<Meet[]> {
  try {
    
    const { data: meetsData, error } = await supabase
      .from('meets')
      .select('*')
      .neq('status', 'completed')
      .order('start_date', { ascending: true });

    if (error) {
      console.error('Error fetching meets:', error);
      throw error;
    }

    return meetsData.map(meet => {
      const timeZoneIdentifier = meet.time_zone as USTimeZoneIdentifier;
      const startDate = new Date(meet.start_date);
      
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
          timeZoneIdentifier: timeZoneIdentifier,
          abbreviation: meet.time_zone_abbr || 'EST', // Fallback to EST if not provided
          utcOffset: getUTCOffsetForDate(timeZoneIdentifier, startDate)
        },
        dates: {
          start: meet.start_date,
          end: meet.end_date
        },
        status: meet.status
      };
    });
  } catch (error) {
    console.error('Error in fetchMeets:', error);
    throw error;
  }
}

// Fetch a single meet by name
export async function fetchMeetByName(name: string): Promise<Meet | null> {
  try {
    const { data: meet, error, status } = await supabase
      .from('meets')
      .select('*')
      .eq('name', name)
      .single();


    const actualMeet = Array.isArray(meet) ? meet[0] : meet;

    if (error) {
      console.error('Error fetching meet by name:', error);
      throw error;
    }

    if (!actualMeet) {
      console.log('No meet found with name:', name, 'Supabase returned:', meet);
      return null;
    }

    const timeZoneIdentifier = actualMeet.time_zone as USTimeZoneIdentifier;
    const startDate = new Date(actualMeet.start_date);

    return {
      id: actualMeet.id,
      name: actualMeet.name,
      venue: {
        name: actualMeet.venue_name,
        address: {
          street: actualMeet.venue_street,
          city: actualMeet.venue_city,
          state: actualMeet.venue_state,
          zip: actualMeet.venue_zip
        }
      },
      time: {
        timeZone: actualMeet.time_zone,
        timeZoneIdentifier: timeZoneIdentifier,
        abbreviation: actualMeet.time_zone_abbr || 'EST', // Fallback to EST if not provided
        utcOffset: getUTCOffsetForDate(timeZoneIdentifier, startDate)
      },
      dates: {
        start: actualMeet.start_date,
        end: actualMeet.end_date
      },
      status: actualMeet.status
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