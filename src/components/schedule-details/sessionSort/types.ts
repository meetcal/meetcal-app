export type SortKey = "entryTotal" | "snatch" | "cj" | "total";
export type SortDirection = "asc" | "desc";

export interface SortOption {
  label: string;
  key: SortKey;
  direction: SortDirection;
}

export interface SessionSortControlProps {
  isSubscribed: boolean;
  sortLabel: string;
  sortKey: SortKey;
  sortDirection: SortDirection;
  sortOptions: SortOption[];
  onSelect: (key: SortKey, direction: SortDirection) => void;
  /** Invoked when a non-subscribed user taps the control (triggers paywall). */
  onLockedPress: () => void;
}
