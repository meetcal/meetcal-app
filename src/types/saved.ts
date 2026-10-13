import { MeetName } from "@/data/types/meet";
import { SavedSession } from "@/hooks/useSavedSessions";
import type { MeetZone } from "@/utils/timezone";

// Add a type that extends SavedSession to include the legacy athleteName property
export interface LegacySavedSession extends SavedSession {
    athleteName?: string;
  }
  
export type SessionScheduleLookup = {
    displayDate: string;
    fullDate: string;
    startTime: string;
    weighInTime: string;
    weightClass: string;
};

export interface SessionCardProps {
  item: LegacySavedSession;
  selectedMeet: MeetName | null;
  /**
   * Receives the row it was pressed on. `SessionCard` is `React.memo`, so the
   * caller must be able to hand it one stable callback for the whole list
   * rather than a per-row closure — a closure built inside `renderItem`
   * changes identity on every parent render and defeats the memo for every
   * visible card.
   */
  onPress: (session: LegacySavedSession) => void;
  sessionLookupByMeet: Map<MeetName, Map<string, SessionScheduleLookup>>;
  allowedMeetNames: ReadonlySet<string>;
  /** The selected meet's zone (`meetDetails.time`); labels are read per session date. */
  meetZone: MeetZone | null;
}