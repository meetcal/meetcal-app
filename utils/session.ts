import { MeetName } from "@/data/types/meet";
import { canonicalizePlatform } from "@/lib/athletes";

/**
 * Get user-specific storage key for saved sessions
 */
export function getSavedSessionsKey(userId: string): string {
  return `@saved_sessions_${userId}`;
}

/**
 * Generate unique session ID from meet, session number, and platform.
 *
 * The platform goes in canonicalized (`"RED "` → `"Red"`) so one platform has
 * one id however a caller spelled it. Ids persisted before this were built
 * from already-canonical names, so they are unchanged.
 */
export function generateSessionId(
  meet: MeetName,
  sessionNumber: number | string,
  platform: string,
): string {
  return `${meet}-${sessionNumber}-${canonicalizePlatform(platform)}`.replace(/\s+/g, "-");
}

/**
 * Every AsyncStorage key a user's saved sessions have lived under, current key
 * first. Reset and migration have to sweep the legacy keys too, so the list is
 * kept here rather than inlined at each call site.
 */
export function getAllSavedSessionsKeys(userId: string): string[] {
  return [
    getSavedSessionsKey(userId),
    `savedSessions_${userId}`,
    `@savedSessions_${userId}`,
    `sessions_${userId}`,
  ];
}

/**
 * In-memory lookup key for session-platform combinations. The platform part
 * is canonicalized, so a saved session stored as `"RED "` still finds the
 * schedule row keyed `"Red"`.
 */
export function makeLookupKey(
  sessionNumber: number | string,
  platform: string,
): string {
  const normalizedSession = String(sessionNumber).replace(/\s+/g, "-");
  const normalizedPlatform = canonicalizePlatform(platform).replace(/\s+/g, "-");
  return `${normalizedSession}-${normalizedPlatform}`;
}
