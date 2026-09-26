import type { Doc } from '../_generated/dataModel';

/**
 * One `lifting_results` row as the Rust API serializes it
 * (`lifting_result_columns!`): nullable numbers and text read as `0` / `''`.
 */
export type ApiLiftingResult = {
  id: number;
  event_id: string;
  federation: string;
  meet: string;
  date: string;
  name: string;
  age: string;
  body_weight: number;
  snatch1: number;
  snatch2: number;
  snatch3: number;
  snatch_best: number;
  cj1: number;
  cj2: number;
  cj3: number;
  cj_best: number;
  total: number;
  adaptive: boolean;
};

/**
 * `id` is the row's pre-Convex serial (`legacyId`) where it has one. The app
 * only falls back to it as a display key; rows are de-duplicated by
 * `event_id`.
 */
export function toApiLiftingResult(row: Doc<'lifting_results'>): ApiLiftingResult {
  return {
    id: row.legacyId ?? 0,
    event_id: row.eventId,
    federation: row.federation ?? '',
    meet: row.meet,
    date: row.date,
    name: row.name,
    age: row.age ?? '',
    body_weight: row.bodyWeight ?? 0,
    snatch1: row.snatch1 ?? 0,
    snatch2: row.snatch2 ?? 0,
    snatch3: row.snatch3 ?? 0,
    snatch_best: row.snatchBest ?? 0,
    cj1: row.cj1 ?? 0,
    cj2: row.cj2 ?? 0,
    cj3: row.cj3 ?? 0,
    cj_best: row.cjBest ?? 0,
    total: row.total ?? 0,
    adaptive: row.adaptive,
  };
}

export type YearBests = { best_snatch: number; best_cj: number; best_total: number };

export const ZERO_BESTS: YearBests = { best_snatch: 0, best_cj: 0, best_total: 0 };

/**
 * Bests for one requested name. Name-keyed maps travel as lists of these:
 * Convex field names must be ASCII, and athlete names are not
 * ("Andrés Álvarez"). The app client turns the list back into the map the
 * Rust API sent.
 */
export type NamedBests = YearBests & { name: string };

/**
 * `best_lifts_columns!`: the heaviest of the recorded best and every attempt
 * (a missed attempt is negative, so it never wins), and the heaviest total.
 */
export function accumulateBests(bests: YearBests, row: Doc<'lifting_results'>): YearBests {
  return {
    best_snatch: Math.max(
      bests.best_snatch,
      row.snatchBest ?? 0,
      row.snatch1 ?? 0,
      row.snatch2 ?? 0,
      row.snatch3 ?? 0,
    ),
    best_cj: Math.max(bests.best_cj, row.cjBest ?? 0, row.cj1 ?? 0, row.cj2 ?? 0, row.cj3 ?? 0),
    best_total: Math.max(bests.best_total, row.total ?? 0),
  };
}

/** Newest first, then the newest row first: the order every name query uses. */
export function compareNewestFirst(a: Doc<'lifting_results'>, b: Doc<'lifting_results'>): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return b._creationTime - a._creationTime;
}
