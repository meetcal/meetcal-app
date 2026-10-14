import * as SecureStore from 'expo-secure-store';

import { issueSiriToken, revokeApiToken, type IssuedApiToken } from '@/lib/api/meetcal-api';

/**
 * Siri's sign-in token. The App Intents (`plugins/ios-app-intents/`) cannot
 * hold a Clerk session, so the app gets them a MeetCal-issued token
 * (`apiTokens:issue` with `{ client: "siri" }`, 90 days) while a subscriber is
 * signed in, and stores it in the keychain, where `SiriToken` in
 * `MeetCalAPI.swift` reads it to fetch the shared access pass. The intents
 * are compiled into the app target, so they share its keychain access group.
 *
 * expo-secure-store saves an item without biometric protection under the
 * service `<keychainService>:no-auth`, with the key as its account, as UTF-8
 * JSON here. `MeetCalAPI.swift` reads exactly that; a test keeps the names
 * equal. `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`: Siri answers while the phone
 * is locked, once it has been unlocked since it started; and the token stays
 * on this device, so a backup restored to another phone does not carry a
 * token this one would end when it renews (that phone issues its own).
 *
 * The server can stop accepting a stored token before it expires (revoked, a
 * replaced signing key, evicted by `MAX_API_TOKENS_PER_USER`): Siri then
 * deletes it (`SiriToken.discard`), and the next check here issues a new one.
 */
export const SIRI_TOKEN_KEY = 'siri_api_token';
export const SIRI_TOKEN_KEYCHAIN_SERVICE = 'meetcal.siri';
/** A token this close to expiring is replaced: Siri never holds one that runs out. */
export const SIRI_TOKEN_RENEW_BEFORE_MS = 14 * 24 * 60 * 60 * 1000;
/** After issuing failed (offline, server not configured), how long before trying again. */
export const SIRI_TOKEN_RETRY_AFTER_MS = 60 * 60 * 1000;

const STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: SIRI_TOKEN_KEYCHAIN_SERVICE,
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/** The stored token, and whose it is, so a change of user ends it. */
export type StoredSiriToken = IssuedApiToken & { userId: string };

export type SiriTokenState = {
  /** Clerk has loaded: until then nothing is issued or ended. */
  isLoaded: boolean;
  /** The signed-in Clerk user, null signed out. */
  userId: string | null;
  /** The app believes the user subscribes (`isSubscribed === true`). */
  subscribed: boolean;
  /** The user's Clerk session token, to issue with. */
  getClerkToken: () => Promise<string | null>;
};

let chain: Promise<void> = Promise.resolve();
/** After a failed issue, when to try again, for the user it failed for: another user does not wait. */
let retryAfter: { userId: string; at: number } | null = null;

function isStoredSiriToken(value: unknown): value is StoredSiriToken {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.token === 'string' &&
    row.token.length > 0 &&
    typeof row.tokenId === 'string' &&
    row.tokenId.length > 0 &&
    typeof row.userId === 'string' &&
    row.userId.length > 0 &&
    typeof row.expiresAt === 'number' &&
    Number.isFinite(row.expiresAt)
  );
}

/** The stored token; null when there is none. One that cannot be read is deleted. */
export async function readStoredSiriToken(): Promise<StoredSiriToken | null> {
  const raw = await SecureStore.getItemAsync(SIRI_TOKEN_KEY, STORE_OPTIONS);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (isStoredSiriToken(parsed)) return parsed;
  console.warn('[siri-token] stored token is unreadable; deleting it');
  await SecureStore.deleteItemAsync(SIRI_TOKEN_KEY, STORE_OPTIONS);
  return null;
}

/**
 * Ends a token on the server, with the token itself (`apiTokens:revoke`
 * ends the token it is called with), so it works after the Clerk session is
 * gone and for a previous user. Best effort: a token that cannot be ended
 * (offline) is no longer held by anyone and runs out on its own.
 */
async function revokeQuietly(stored: IssuedApiToken, now: number): Promise<void> {
  // An expired token cannot sign the call, and can no longer be used anyway.
  if (stored.expiresAt <= now) return;
  try {
    await revokeApiToken(stored.token);
  } catch (error) {
    console.warn('[siri-token] could not revoke the previous Siri token', error);
  }
}

/** Ends the stored token and deletes it, so Siri goes without a pass. */
async function endStoredToken(stored: StoredSiriToken, now: number): Promise<void> {
  await revokeQuietly(stored, now);
  await SecureStore.deleteItemAsync(SIRI_TOKEN_KEY, STORE_OPTIONS);
}

async function sync(state: SiriTokenState, now: number): Promise<void> {
  if (!state.isLoaded) return;
  let stored = await readStoredSiriToken();
  // Signed out, or someone else signed in: the token was the previous user's.
  if (stored && stored.userId !== state.userId) {
    await endStoredToken(stored, now);
    stored = null;
  }
  // A signed-in user who does not subscribe keeps a token they hold: it gets
  // a pass only while the server sees an active subscription, and a
  // subscription that flickers off (offline, a late RevenueCat answer) does
  // not churn tokens.
  if (state.userId === null || !state.subscribed) return;
  if (stored && stored.expiresAt - now > SIRI_TOKEN_RENEW_BEFORE_MS) return;
  if (retryAfter && retryAfter.userId === state.userId && now < retryAfter.at) return;
  const clerkToken = await state.getClerkToken();
  if (!clerkToken) return;
  let issued: IssuedApiToken;
  try {
    issued = await issueSiriToken(clerkToken);
  } catch (error) {
    retryAfter = { userId: state.userId, at: now + SIRI_TOKEN_RETRY_AFTER_MS };
    throw error;
  }
  const next: StoredSiriToken = { ...issued, userId: state.userId };
  try {
    await SecureStore.setItemAsync(SIRI_TOKEN_KEY, JSON.stringify(next), STORE_OPTIONS);
  } catch (error) {
    // Not stored: nobody would hold it.
    retryAfter = { userId: state.userId, at: now + SIRI_TOKEN_RETRY_AFTER_MS };
    await revokeQuietly(issued, now);
    throw error;
  }
  retryAfter = null;
  if (stored) await revokeQuietly(stored, now);
}

/**
 * Brings Siri's token in line with who is signed in: issues one for a
 * signed-in subscriber who holds none (or one expiring within
 * `SIRI_TOKEN_RENEW_BEFORE_MS`), ends and deletes one whose user signed out
 * or changed, and otherwise leaves it. Runs one at a time, and never throws:
 * a failure is logged and tried again later.
 */
export function syncSiriToken(state: SiriTokenState, now: () => number = Date.now): Promise<void> {
  const run = chain.then(() => sync(state, now())).catch((error: unknown) => {
    console.warn('[siri-token] could not update the Siri token', error);
  });
  chain = run;
  return run;
}

/** Forgets the retry wait and the queue. Tests only. */
export function resetSiriTokenForTests(): void {
  chain = Promise.resolve();
  retryAfter = null;
}
