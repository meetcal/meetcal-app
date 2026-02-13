import { MeetName } from "@/data/types/meet";
import { generateSessionId } from "./session";

/**
 * Migrate legacy sessions to meet-specific format with proper IDs
 */
export function migrateSessionsToMeetSpecific(
  sessions: any[],
  currentMeet: MeetName,
) {
  return sessions.map((session) => ({
    ...session,
    // If the session has a meet, keep it, otherwise assign to current meet
    meet: session.meet || currentMeet,
    // Regenerate ID to ensure uniqueness
    id: generateSessionId(
      session.meet || currentMeet,
      session.sessionNumber,
      session.platform,
    ),
  }));
}
