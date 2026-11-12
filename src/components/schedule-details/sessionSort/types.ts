import type {
  SessionAthleteSortDirection,
  SessionAthleteSortKey,
} from "@/lib/session-athlete-sort";

export interface SortOption {
  label: string;
  key: SessionAthleteSortKey;
  direction: SessionAthleteSortDirection;
}

export interface SessionSortControlProps {
  isSubscribed: boolean;
  sortLabel: string;
  sortKey: SessionAthleteSortKey;
  sortDirection: SessionAthleteSortDirection;
  sortOptions: SortOption[];
  onSelect: (key: SessionAthleteSortKey, direction: SessionAthleteSortDirection) => void;
  onLockedPress: () => void;
}
