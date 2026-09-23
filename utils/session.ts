import { MeetName } from "@/data/types/meet";

/**
 * Get user-specific storage key for saved sessions
 */
export function getSavedSessionsKey(userId: string): string {
  return `@saved_sessions_${userId}`;
}

/**
 * Generate unique session ID from meet, session number, and platform
 */
export function generateSessionId(
  meet: MeetName,
  sessionNumber: number | string,
  platform: string,
): string {
  return `${meet}-${sessionNumber}-${platform}`.replace(/\s+/g, "-");
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
 * Create lookup key for session-platform combinations
 */
export function makeLookupKey(
  sessionNumber: number | string,
  platform: string,
): string {
  const normalizedSession = String(sessionNumber).replace(/\s+/g, "-");
  const normalizedPlatform = String(platform).replace(/\s+/g, "-");
  return `${normalizedSession}-${normalizedPlatform}`;
}
