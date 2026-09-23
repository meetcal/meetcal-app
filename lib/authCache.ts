import * as SecureStore from 'expo-secure-store';
import { devLog } from './logger';

const AUTH_CACHE_KEY = 'auth_state_cache';
const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

/**
 * How often a still-correct entry is rewritten purely to slide its expiry.
 *
 * The 7 days mean "auth was verified within the last week", not "first signed
 * in a week ago", so re-verification has to move the timestamp. Deduplicating
 * on the signature alone froze it: `getCachedAuthState` seeds
 * `lastPersistedSignature` from what it read, so every later
 * `cacheAuthState(true, sameUser)` early-returned and the entry aged out on
 * day 7 no matter how many times the user had been verified online since.
 * Rewriting on every call would mean a SecureStore write from every mounted
 * `useAuthGuard`, so refresh at most once a day.
 */
const CACHE_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

let inFlightRead: Promise<AuthCacheData | null> | null = null;
let lastPersistedSignature: string | null = null;
let lastPersistedAt = 0;
let mutationRevision = 0;
/**
 * Tail of the serialized write chain. Writes and the clear share it so they
 * can never interleave: two overlapping writes with *different* signatures
 * used to run concurrently and share one `.finally`, so whichever settled
 * first released the in-flight tracking for both. `clearAuthCache` then saw
 * "nothing in flight", deleted the key, and the loser's write landed after the
 * delete — leaving `isSignedIn: true` on disk after a sign-out.
 */
let writeChain: Promise<void> = Promise.resolve();

interface AuthCacheData {
  isSignedIn: boolean;
  timestamp: number;
  userId?: string;
}

// Runtime validator for cached auth data
function isAuthCacheData(obj: unknown): obj is AuthCacheData {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return false;
  }
  const record = obj as Record<string, unknown>;
  return (
    typeof record.isSignedIn === 'boolean' &&
    typeof record.timestamp === 'number' &&
    Number.isFinite(record.timestamp) &&
    record.timestamp >= 0 &&
    record.timestamp <= Date.now() &&
    (record.userId === undefined || typeof record.userId === 'string')
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
  const write = writeChain.then(async () => {
    // Compare after earlier writes/clears settle, otherwise a later sign-in
    // can be discarded because it matches the state before a queued sign-out.
    const age = Date.now() - lastPersistedAt;
    if (signature === lastPersistedSignature && age >= 0 && age < CACHE_REFRESH_INTERVAL_MS) {
      return;
    }
    mutationRevision += 1;
    try {
      const cacheData: AuthCacheData = {
        isSignedIn,
        timestamp: Date.now(),
        userId,
      };
      await SecureStore.setItemAsync(AUTH_CACHE_KEY, JSON.stringify(cacheData));
      lastPersistedSignature = signature;
      lastPersistedAt = cacheData.timestamp;
      devLog('Auth state cached successfully');
    } catch (error) {
      console.error('Error caching auth state:', error);
    }
  });

  writeChain = write;
  await write;
}

export async function getCachedAuthState(): Promise<AuthCacheData | null> {
  if (inFlightRead) {
    return inFlightRead;
  }

  inFlightRead = (async () => {
  try {
    await writeChain;
    const readRevision = mutationRevision;
    const cachedData = await SecureStore.getItemAsync(AUTH_CACHE_KEY);
    // A read started before sign-out must not restore its old signed-in hint.
    if (readRevision !== mutationRevision) return null;
    if (!cachedData) return null;

    const parsed: unknown = JSON.parse(cachedData);

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
      devLog('Auth cache expired (older than 7 days)');
      await clearAuthCache();
      return null;
    }

    lastPersistedSignature = getAuthSignature(
      parsed.isSignedIn,
      parsed.userId
    );
    lastPersistedAt = parsed.timestamp;
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
  const clear = writeChain.then(async () => {
    mutationRevision += 1;
    try {
      await SecureStore.deleteItemAsync(AUTH_CACHE_KEY);
      lastPersistedSignature = null;
      lastPersistedAt = 0;
      devLog('Auth cache cleared');
    } catch (error) {
      console.error('Error clearing auth cache:', error);
    }
  });

  writeChain = clear;
  await clear;
}

