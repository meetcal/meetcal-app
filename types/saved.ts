import { MeetName } from "@/data/types/meet";
import { SavedSession } from "@/hooks/useSavedSessions";

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
  onPress: () => void;
  sessionLookupByMeet: Map<MeetName, Map<string, SessionScheduleLookup>>;
  allowedMeetNames: ReadonlySet<string>;
  timeZoneIdentifier?: string;
  timeZoneAbbr: string;
}