import type { LiftResult } from "@/data/types/athletes";
import type {
  SessionAthleteSortDirection,
  SessionAthleteSortKey,
} from "@/lib/session-athlete-sort";
import type { SessionAthlete } from "@/types/schedule-details";

export type SessionSortOption = {
  label: string;
  key: SessionAthleteSortKey;
  direction: SessionAthleteSortDirection;
};

export const SESSION_SORT_OPTIONS: SessionSortOption[] = [
  { label: "Entry Total (High to Low)", key: "entryTotal", direction: "desc" },
  { label: "Entry Total (Low to High)", key: "entryTotal", direction: "asc" },
  { label: "Best Snatch (High to Low)", key: "snatch", direction: "desc" },
  { label: "Best Snatch (Low to High)", key: "snatch", direction: "asc" },
  { label: "Best CJ (High to Low)", key: "cj", direction: "desc" },
  { label: "Best CJ (Low to High)", key: "cj", direction: "asc" },
  { label: "Best Total (High to Low)", key: "total", direction: "desc" },
  { label: "Best Total (Low to High)", key: "total", direction: "asc" },
];

export function sessionSortLabel(key: SessionAthleteSortKey): string {
  if (key === "entryTotal") return "Entry Total";
  if (key === "snatch") return "Best Snatch";
  if (key === "cj") return "Best CJ";
  return "Best Total";
}

export function toSessionAthletesByPlatform(
  platform: string,
  athletes: LiftResult[],
): Record<string, SessionAthlete[]> {
  const sortedAthletes = [...athletes].sort(
    (a, b) => (b.entryTotal || 0) - (a.entryTotal || 0),
  );

  return {
    [platform]: sortedAthletes.map((athlete) => ({
      name: athlete.name,
      age: athlete.age,
      club: athlete.club,
      entryTotal: athlete.entryTotal,
      weightClass: athlete.weightClass,
    })),
  };
}
