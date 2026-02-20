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
