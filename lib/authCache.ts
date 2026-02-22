import React from 'react';
import * as SecureStore from 'expo-secure-store';
import { useAuth } from '@clerk/clerk-expo';
import { isNetworkAvailable } from './networkUtils';

const AUTH_CACHE_KEY = 'auth_state_cache';
const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

interface AuthCacheData {
  isSignedIn: boolean;
  timestamp: number;
  userId?: string;
  email?: string;
}

// Runtime validator for cached auth data
function isAuthCacheData(obj: any): obj is AuthCacheData {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    typeof obj.isSignedIn === 'boolean' &&
    typeof obj.timestamp === 'number' &&
    (obj.userId === undefined || typeof obj.userId === 'string') &&
    (obj.email === undefined || typeof obj.email === 'string')
  );
}

export async function cacheAuthState(
  isSignedIn: boolean,
  userId?: string,
  email?: string
) {
  try {
    const cacheData: AuthCacheData = {
      isSignedIn,
      timestamp: Date.now(),
      userId,
      email,
    };
    await SecureStore.setItemAsync(AUTH_CACHE_KEY, JSON.stringify(cacheData));
    console.log('Auth state cached successfully');
  } catch (error) {
    console.error('Error caching auth state:', error);
  }
}

export async function getCachedAuthState(): Promise<AuthCacheData | null> {
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
        return parsed;
      }
    }

    console.log('Using cached auth state');
    return parsed;
  } catch (error) {
    console.error('Error getting cached auth state:', error);
    return null;
  }
}

export async function clearAuthCache() {
  try {
    await SecureStore.deleteItemAsync(AUTH_CACHE_KEY);
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