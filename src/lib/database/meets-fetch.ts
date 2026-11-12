import { Meet } from '@/data/types/meet';
import { isNetworkAvailable } from '@/lib/networkUtils';
import { fetchApiMeetByName, fetchApiMeets } from '@/lib/api/meets-api';
import { MeetCalApiTimeoutError } from '@/lib/api/meetcal-api';
import { getCachedMeetByName, getCachedMeets, setCachedMeets } from './meets-list-cache';
import { devLog } from '@/lib/logger';

const TIMEOUT_LOG_THROTTLE_MS = 30000;

let inFlightFetchMeets: Promise<Meet[]> | null = null;

let warnedEmptyMeetsList = false;

let lastFetchMeetsTimeoutLogAt = 0;

export async function fetchMeetsFresh(): Promise<Meet[]> {
  if (inFlightFetchMeets) {
    return inFlightFetchMeets;
  }

  inFlightFetchMeets = (async () => {
    try {
      const hasNetwork = await isNetworkAvailable();
      if (!hasNetwork) throw new Error('Offline');

      const meets = await fetchApiMeets();
      if (meets.length === 0 && (await getCachedMeets()).length > 0) {
        if (!warnedEmptyMeetsList) {
          warnedEmptyMeetsList = true;
          devLog('/meets answered with no meets; keeping the cached list');
        }
        return meets;
      }
      await setCachedMeets(meets);
      return meets;
    } catch (error) {
      const isTimeout = error instanceof MeetCalApiTimeoutError;
      const now = Date.now();
      if (!isTimeout || now - lastFetchMeetsTimeoutLogAt >= TIMEOUT_LOG_THROTTLE_MS) {
        if (isTimeout) {
          lastFetchMeetsTimeoutLogAt = now;
          console.warn('fetchMeets timed out; using cached meets list');
        } else {
          console.error('Error in fetchMeets:', error);
        }
      }
      throw error;
    } finally {
      inFlightFetchMeets = null;
    }
  })();

  return inFlightFetchMeets;
}

export async function fetchMeetByName(name: string): Promise<Meet | null> {
  try {
    const cachedMeet = await getCachedMeetByName(name);
    if (cachedMeet) return cachedMeet;

    const hasNetwork = await isNetworkAvailable();
    if (!hasNetwork) return null;

    const actualMeet = await fetchApiMeetByName(name);

    if (!actualMeet) {
      devLog('No meet found with name:', name);
      return null;
    }

    return actualMeet;
  } catch (error) {
    console.error('Error in fetchMeetByName:', error);
    const cached = await getCachedMeets();
    return cached.find(meet => meet.name === name) ?? null;
  }
}
