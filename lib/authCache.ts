import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@clerk/clerk-expo';

const AUTH_CACHE_KEY = 'auth_state_cache';
const CACHE_EXPIRY_MS = 36 * 60 * 60 * 1000; // 36 hours in milliseconds

export async function cacheAuthState(isSignedIn: boolean) {
  try {
    const cacheData = {
      isSignedIn,
      timestamp: Date.now(),
    };
    await AsyncStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(cacheData));
  } catch (error) {
    console.error('Error caching auth state:', error);
  }
}

export async function getCachedAuthState(): Promise<boolean | null> {
  try {
    const cachedData = await AsyncStorage.getItem(AUTH_CACHE_KEY);
    if (!cachedData) return null;

    const { isSignedIn, timestamp } = JSON.parse(cachedData);
    const now = Date.now();
    
    // Check if cache is expired
    if (now - timestamp > CACHE_EXPIRY_MS) {
      await AsyncStorage.removeItem(AUTH_CACHE_KEY);
      return null;
    }

    return isSignedIn;
  } catch (error) {
    console.error('Error getting cached auth state:', error);
    return null;
  }
}

export function useCachedAuth() {
  const { isSignedIn } = useAuth();
  
  // Cache the auth state whenever it changes
  React.useEffect(() => {
    if (isSignedIn !== undefined) {
      cacheAuthState(isSignedIn);
    }
  }, [isSignedIn]);

  return { isSignedIn };
} 