import type {
  SessionAthleteSortDirection,
  SessionAthleteSortKey,
} from "@/lib/session-athlete-sort";
import type { SessionSortOption } from "@/lib/session-athletes-view";

export interface SessionSortControlProps {
  isSubscribed: boolean;
  sortLabel: string;
  sortKey: SessionAthleteSortKey;
  sortDirection: SessionAthleteSortDirection;
  sortOptions: readonly SessionSortOption[];
  onSelect: (key: SessionAthleteSortKey, direction: SessionAthleteSortDirection) => void;
  onLockedPress: () => void;
}
