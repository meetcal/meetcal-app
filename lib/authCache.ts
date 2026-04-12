import React from 'react';
import * as SecureStore from 'expo-secure-store';
import { useAuth } from '@clerk/expo';
import { isNetworkAvailable } from './networkUtils';

const AUTH_CACHE_KEY = 'auth_state_cache';
const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
let inFlightRead: Promise<AuthCacheData | null> | null = null;
let lastPersistedSignature: string | null = null;
let inFlightWrite: Promise<void> | null = null;
let inFlightWriteSignature: string | null = null;

interface AuthCacheData {
  isSignedIn: boolean;
  timestamp: number;
  userId?: string;
}

// Runtime validator for cached auth data
function isAuthCacheData(obj: any): obj is AuthCacheData {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    typeof obj.isSignedIn === 'boolean' &&
    typeof obj.timestamp === 'number' &&
    (obj.userId === undefined || typeof obj.userId === 'string')
  );
}

function getAuthSignature(
  isSignedIn: boolean,
  userId?: string
): string {
  return JSON.stringify({
    isSignedIn,
    userId: userId ?? null,
  });
}

export async function cacheAuthState(
  isSignedIn: boolean,
  userId?: string
) {
  const signature = getAuthSignature(isSignedIn, userId);
  if (signature === lastPersistedSignature) {
    return;
  }

  if (inFlightWrite && signature === inFlightWriteSignature) {
    await inFlightWrite;
    return;
  }

  try {
    const cacheData: AuthCacheData = {
      isSignedIn,
      timestamp: Date.now(),
      userId,
    };
    inFlightWriteSignature = signature;
    inFlightWrite = SecureStore.setItemAsync(AUTH_CACHE_KEY, JSON.stringify(cacheData))
      .then(() => {
        lastPersistedSignature = signature;
        console.log('Auth state cached successfully');
      })
      .finally(() => {
        inFlightWrite = null;
        inFlightWriteSignature = null;
      });

    await inFlightWrite;
  } catch (error) {
    console.error('Error caching auth state:', error);
  }
}

export async function getCachedAuthState(): Promise<AuthCacheData | null> {
  if (inFlightRead) {
    return inFlightRead;
  }

  inFlightRead = (async () => {
  try {
    const cachedData = await SecureStore.getItemAsync(AUTH_CACHE_KEY);
    if (!cachedData) return null;

    const parsed = JSON.parse(cachedData);

    // Validate the parsed data structure
    if (!isAuthCacheData(parsed)) {
      console.warn('Invalid auth cache data structure, clearing cache');
      await clearAuthCache();
      return null;
    }

    const now = Date.now();

    // Check if cache is expired
    const isExpired = now - parsed.timestamp > CACHE_EXPIRY_MS;

    if (isExpired) {
      console.log('Auth cache expired (older than 7 days)');
      // Check if network is available
      const hasNetwork = await isNetworkAvailable();

      if (hasNetwork) {
        // Network available, clear expired cache
        await clearAuthCache();
        return null;
      } else {
        // Network unavailable, use stale cache with warning
        console.warn('Using stale auth cache due to network unavailability');
        lastPersistedSignature = getAuthSignature(
          parsed.isSignedIn,
          parsed.userId
        );
        return parsed;
      }
    }

    lastPersistedSignature = getAuthSignature(
      parsed.isSignedIn,
      parsed.userId
    );
    return parsed;
  } catch (error) {
    console.error('Error getting cached auth state:', error);
    return null;
  } finally {
    inFlightRead = null;
  }
  })();

  return inFlightRead;
}

export async function clearAuthCache() {
  try {
    if (inFlightWrite) {
      await inFlightWrite;
    }
    await SecureStore.deleteItemAsync(AUTH_CACHE_KEY);
    lastPersistedSignature = null;
    console.log('Auth cache cleared');
  } catch (error) {
    console.error('Error clearing auth cache:', error);
  }
}

export function useCachedAuth() {
  const { isSignedIn, userId } = useAuth();
  const [cachedAuthData, setCachedAuthData] = React.useState<AuthCacheData | null>(null);

  // Load cached auth state on mount
  React.useEffect(() => {
    let cancelled = false;

    async function loadCache() {
      const cached = await getCachedAuthState();
      if (cached && !cancelled) {
        setCachedAuthData(cached);
      }
    }
    loadCache();

    return () => {
      cancelled = true;
    };
  }, []);

  // Cache the auth state whenever it changes (only when online)
  React.useEffect(() => {
    async function updateCache() {
      if (isSignedIn !== undefined) {
        const hasNetwork = await isNetworkAvailable();
        if (hasNetwork) {
          // Only update cache when we have network connectivity
          // This ensures we're caching verified online auth state
          await cacheAuthState(isSignedIn, userId ?? undefined);

          // Update local state
          const updated = await getCachedAuthState();
          setCachedAuthData(updated);
        }
      }
    }
    updateCache();
  }, [isSignedIn, userId]);

  return {
    isSignedIn,
    cachedAuthData,
    isCacheStale: cachedAuthData ? Date.now() - cachedAuthData.timestamp > CACHE_EXPIRY_MS : false
  };
} 
