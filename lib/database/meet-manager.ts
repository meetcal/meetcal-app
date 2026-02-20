import AsyncStorage from '@react-native-async-storage/async-storage';
import { MeetName, Meet, timezoneOffsets, USTimeZoneIdentifier } from '@/data/types/meet';
import {
  clearImplicitMeetData,
  clearMeetData,
  getMeetData,
  saveMeetAthletes,
  saveMeetLiftingResults,
  saveMeetSchedule,
} from './offline-store';
import { supabase } from '@/lib/supabase';
import { isNetworkAvailable } from '@/lib/networkUtils';
import { fetchAthletesWithSession, fetchLiftingResultsForMeet, fetchSchedule } from './queries';

const CACHE_SIZE_LIMIT = 50 * 1024 * 1024; // 50MB
const MAX_CACHED_MEETS = 3;
const MEET_CACHE_KEY = '@meet_cache_info';
const MEETS_LIST_CACHE_KEY = '@meets_list_cache_v1';
const INITIAL_LOAD_TIMEOUT_MS = 10000;
const TIMEOUT_LOG_THROTTLE_MS = 30000;

let inFlightFetchMeets: Promise<Meet[]> | null = null;
let lastFetchMeetsTimeoutLogAt = 0;

interface MeetInfo {
  lastAccessed: number;
  size: number;
}

interface CacheInfo {
  totalSize: number;
  meets: { [key: string]: MeetInfo };
}

export function validatePrefetchedLiftingResults(
  meet: MeetName,
  athleteNames: string[],
  liftingResults: { name?: string | null }[],
): void {
  const normalizeName = (value: string | null | undefined) =>
    (value || '').trim().toLowerCase().replace(/\s+/g, ' ');

  if (athleteNames.length > 0 && liftingResults.length === 0) {
    throw new Error(`No lifting results fetched for meet: ${meet}`);
  }

  if (athleteNames.length > 0 && liftingResults.length > 0) {
    const athleteSet = new Set(athleteNames.map(normalizeName));
    const matchedCount = liftingResults.reduce((count, result) => {
      return athleteSet.has(normalizeName(result.name)) ? count + 1 : count;
    }, 0);

    if (matchedCount === 0) {
      throw new Error(`No matched lifting results fetched for meet athletes: ${meet}`);
    }
  }
}

async function getCachedMeets(): Promise<Meet[]> {
  try {
    const cached = await AsyncStorage.getItem(MEETS_LIST_CACHE_KEY);
    if (!cached) return [];
    const parsed = JSON.parse(cached);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Error reading cached meets list:', error);
    return [];
  }
}

async function setCachedMeets(meets: Meet[]): Promise<void> {
  try {
    await AsyncStorage.setItem(MEETS_LIST_CACHE_KEY, JSON.stringify(meets));
  } catch (error) {
    console.error('Error saving cached meets list:', error);
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
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
  if (inFlightFetchMeets) {
    return inFlightFetchMeets;
  }

  inFlightFetchMeets = (async () => {
    try {
      const hasNetwork = await isNetworkAvailable();
      if (!hasNetwork) {
        return await getCachedMeets();
      }

      const { data: meetsData, error } = await withTimeout(
        supabase
          .from('meets')
          .select('*')
          .neq('status', 'completed')
          .order('start_date', { ascending: true }),
        INITIAL_LOAD_TIMEOUT_MS,
        'fetchMeets'
      );

      if (error) {
        console.error('Error fetching meets:', error);
        return await getCachedMeets();
      }

      const mapped = meetsData.map(meet => {
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
      await setCachedMeets(mapped);
      return mapped;
    } catch (error) {
      const err = error as Error;
      const isTimeout = err.message.includes('fetchMeets timed out');
      const now = Date.now();
      if (!isTimeout || now - lastFetchMeetsTimeoutLogAt >= TIMEOUT_LOG_THROTTLE_MS) {
        if (isTimeout) {
          lastFetchMeetsTimeoutLogAt = now;
          console.warn('fetchMeets timed out; using cached meets list');
        } else {
          console.error('Error in fetchMeets:', error);
        }
      }
      return await getCachedMeets();
    } finally {
      inFlightFetchMeets = null;
    }
  })();

  return inFlightFetchMeets;
}

// Fetch a single meet by name
export async function fetchMeetByName(name: string): Promise<Meet | null> {
  try {
    const hasNetwork = await isNetworkAvailable();
    if (!hasNetwork) {
      const cached = await getCachedMeets();
      return cached.find(meet => meet.name === name) ?? null;
    }

    const { data: meet, error, status } = await withTimeout(
      supabase
        .from('meets')
        .select('*')
        .eq('name', name)
        .single(),
      INITIAL_LOAD_TIMEOUT_MS,
      'fetchMeetByName'
    );


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
    const cached = await getCachedMeets();
    return cached.find(meet => meet.name === name) ?? null;
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
  const errors: string[] = [];
  let athleteNames: string[] = [];

  try {
    const schedule = await fetchSchedule(meet);
    if (schedule.length > 0) {
      await saveMeetSchedule(meet, schedule);
    }
  } catch (error) {
    console.error('Prefetch schedule failed:', { meet, error });
    errors.push('schedule');
  }

  try {
    const athletes = await fetchAthletesWithSession(meet);
    await saveMeetAthletes(meet, athletes);
    athleteNames = Array.from(
      new Set(athletes.map((athlete) => athlete.name).filter(Boolean)),
    );
  } catch (error) {
    console.error('Prefetch athletes failed:', { meet, error });
    errors.push('athletes');
  }

  if (athleteNames.length > 0) {
    try {
      const liftingResults = await fetchLiftingResultsForMeet(meet, athleteNames);
      validatePrefetchedLiftingResults(meet, athleteNames, liftingResults);
      await saveMeetLiftingResults(meet, liftingResults);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('SQLITE_FULL')) {
        try {
          await clearImplicitMeetData(meet);
          const liftingResults = await fetchLiftingResultsForMeet(meet, athleteNames);
          validatePrefetchedLiftingResults(meet, athleteNames, liftingResults);
          await saveMeetLiftingResults(meet, liftingResults);
        } catch (retryError) {
          console.error('Prefetch lifting results failed after cleanup retry:', { meet, error: retryError });
          errors.push('lifting_results');
        }
      } else {
        console.error('Prefetch lifting results failed:', { meet, error });
        errors.push('lifting_results');
      }
    }
  }

  await updateMeetAccess(meet);

  if (errors.length > 0) {
    throw new Error(`Offline prefetch incomplete (${meet}): ${errors.join(', ')}`);
  }
} 
