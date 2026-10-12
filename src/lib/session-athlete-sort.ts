import type { SupabaseBests } from "@/data/types/athletes";

export type SessionAthleteSortKey = "entryTotal" | "snatch" | "cj" | "total";
export type SessionAthleteSortDirection = "asc" | "desc";

/**
 * The value an athlete sorts by, or `null` when they have no best for a
 * best-lift sort. A best of 0 (no made lift) counts as no best.
 */
function sortValue(
  athlete: { name: string; entryTotal: number },
  bests: SupabaseBests | undefined,
  key: SessionAthleteSortKey,
): number | null {
  if (key === "entryTotal") return athlete.entryTotal || 0;
  const value =
    key === "snatch" ? bests?.snatch_best : key === "cj" ? bests?.cj_best : bests?.total;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Session details' athlete order.
 *
 * The best-lift sorts used to fall back to the athlete's *entry total* when
 * they had no best, so a lifter with no history and a 200 kg entry sorted as
 * if their best snatch were 200, ahead of a real 120 kg best. Athletes with
 * no best now sort after everyone who has one, in either direction, so the
 * known numbers stay together at the top. Ties (and the no-best group) keep
 * the incoming order, which is entry total, high to low.
 */
export function sortSessionAthletes<T extends { name: string; entryTotal: number }>(
  athletes: readonly T[],
  bestsByName: Readonly<Record<string, SupabaseBests | undefined>>,
  key: SessionAthleteSortKey,
  direction: SessionAthleteSortDirection,
): T[] {
  const keyed = athletes.map((athlete) => ({
    athlete,
    value: sortValue(athlete, bestsByName[athlete.name], key),
  }));
  keyed.sort((a, b) => {
    if (a.value === b.value) return 0;
    if (a.value === null) return 1;
    if (b.value === null) return -1;
    return direction === "desc" ? b.value - a.value : a.value - b.value;
  });
  return keyed.map(({ athlete }) => athlete);
}
