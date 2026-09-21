import { MeetName } from "@/data/types/meet";
import type { SavedSession } from "@/hooks/useSavedSessions";
import { generateSessionId } from "./session";

/**
 * A saved session as it was stored before sessions were namespaced by meet:
 * same shape, except `meet` (and therefore the derived `id`) may be missing.
 */
export type PreMeetSavedSession = Omit<SavedSession, "meet"> & {
  meet?: MeetName;
};

/**
 * Migrate legacy sessions to meet-specific format with proper IDs
 */
export function migrateSessionsToMeetSpecific(
  sessions: PreMeetSavedSession[],
  currentMeet: MeetName,
): SavedSession[] {
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
