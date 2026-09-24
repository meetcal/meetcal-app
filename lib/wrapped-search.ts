import type { SupabaseLiftResult } from '@/data/types/athletes';
import { normalizeAthleteName } from '@/lib/athletes';

/** Upper bound on the rows one Wrapped run scores; a full year is far fewer. */
export const MAX_WRAPPED_RESULTS = 600;

/** "Did you mean…" renders in the search dropdown, so the list is capped. */
export const MAX_WRAPPED_NAME_CHOICES = 8;

/** The fields of a `/search` answer (`searchApi`) this policy reads. */
export type WrappedSearchResponse = {
  matchedName: string | null;
  results: readonly SupabaseLiftResult[];
};

export type WrappedSelection =
  /** One athlete: score these rows (date order, capped) under `name`. */
  | { kind: 'athlete'; name: string; rows: SupabaseLiftResult[] }
  /** Several athletes matched; the user has to pick one. */
  | { kind: 'ambiguous'; names: string[] }
  | { kind: 'none' };

function inDateOrder(rows: readonly SupabaseLiftResult[]): SupabaseLiftResult[] {
  return [...rows]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, MAX_WRAPPED_RESULTS);
}

/**
 * Which rows one Wrapped is built from.
 *
 * With an exact name match the API sets `matchedName` and every row is that
 * athlete. Without one it falls back to a name-contains search, which returns
 * the rows of every athlete whose name contains the query ("Smith"). Those
 * rows are only one person's year when they carry exactly one distinct name;
 * otherwise scoring them together would merge several athletes into one
 * Wrapped, so the caller gets the names to choose from instead.
 */
export function selectWrappedRows(response: WrappedSearchResponse): WrappedSelection {
  const rows = response.results;
  if (rows.length === 0) return { kind: 'none' };

  if (response.matchedName !== null) {
    const ordered = inDateOrder(rows);
    return { kind: 'athlete', name: ordered[0].name || response.matchedName, rows: ordered };
  }

  // Distinct athletes among the fallback rows, keeping the first spelling seen.
  const byNormalized = new Map<string, string>();
  for (const row of rows) {
    const normalized = normalizeAthleteName(row.name);
    if (normalized && !byNormalized.has(normalized)) byNormalized.set(normalized, row.name);
  }

  if (byNormalized.size === 1) {
    const [[only, name]] = [...byNormalized];
    const ordered = inDateOrder(rows.filter((row) => normalizeAthleteName(row.name) === only));
    return { kind: 'athlete', name, rows: ordered };
  }
  if (byNormalized.size === 0) return { kind: 'none' };

  // Offer the athletes that actually lifted in the range (each pick then has
  // a Wrapped). The API's own `suggestions` span every year, so a pick from
  // them could come back empty.
  const names = [...byNormalized.values()]
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_WRAPPED_NAME_CHOICES);
  return { kind: 'ambiguous', names };
}
