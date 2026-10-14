import type { ApiLiftingResult } from './results';
import { normalizeName } from './names';

/**
 * Weightlifting Wrapped: one athlete's calendar year, summed up. The app, the
 * website and the CLI all show this answer (`results:wrapped`) rather than
 * scoring raw results themselves, so Wrapped is free without handing out the
 * rows behind it. The rules are the app's (they were `src/lib/wrapped-stats.ts`
 * and `src/lib/wrapped-search.ts`).
 */

export type WrappedStats = {
  totalWeightLifted: number;
  totalMeets: number;
  /** Made attempts over taken attempts, 0–100. */
  makePercentage: number;
  bestSnatch: number;
  bestCleanJerk: number;
  bestTotal: number;
  averageTotal: number;
  /** The meet with the year's best total; null without one. */
  topMeet: string | null;
  /** Last minus first meet's best total, among meets with a total; null with fewer than two. */
  improvementFromFirst: number | null;
  /** The longest run of made attempts, in competition order. */
  longestMakeStreak: number;
  /** The attempt (1, 2 or 3) made most often, ties to the earlier; null when none was made. */
  favoriteAttempt: 1 | 2 | 3 | null;
  yearRank: 'Consistency King' | 'Heavy Hitter' | 'Meet Regular' | 'Rising Star';
};

export type WrappedAnswer =
  /** One athlete's year, under the athlete's own spelling. */
  | { kind: 'athlete'; name: string; stats: WrappedStats }
  /** Several athletes matched (or may have: `truncated`); the user picks one, then asks with `picked`. */
  | { kind: 'ambiguous'; names: string[]; truncated: boolean }
  /** The name-contains scan stopped before any athlete with a result: type more of the name. */
  | { kind: 'narrow' }
  /** One athlete's year has more results than one answer holds, so a Wrapped would miss some. */
  | { kind: 'tooManyResults'; name: string }
  /** No results in the year; `suggestions` are names like the query (any year). */
  | { kind: 'none'; suggestions: string[] };

/** "Did you mean…" is a short list. */
export const MAX_WRAPPED_NAME_CHOICES = 8;

/**
 * The most days apart one meet's rows can be filed: a national championship
 * runs about ten days. Further apart, a meet with the same name is another
 * edition (a monthly local open), and its rows are separate lifts.
 */
export const MEET_EDITION_SPAN_DAYS = 10;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** An attempt was taken: a recorded, non-zero number (a miss is negative). */
const wasTaken = (attempt: number | null | undefined): attempt is number => typeof attempt === 'number' && attempt !== 0;
/** A taken attempt that was made. */
const wasMade = (attempt: number | null | undefined): attempt is number => typeof attempt === 'number' && attempt > 0;

const attemptsOf = (row: ApiLiftingResult) => [row.snatch1, row.snatch2, row.snatch3, row.cj1, row.cj2, row.cj3];
const meetKey = (meet: string) => meet.trim().toLowerCase();

function calendarDay(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / MS_PER_DAY;
}

function withinOneEdition(a: string, b: string): boolean {
  const dayA = calendarDay(a);
  const dayB = calendarDay(b);
  return dayA !== null && dayB !== null && Math.abs(dayA - dayB) <= MEET_EDITION_SPAN_DAYS;
}

/**
 * The rows that are distinct lifts, in their order. One lift can come back as
 * several rows (two age divisions, two dates, two meet names on one date):
 * two rows are one lift when all six attempts and the total are equal and
 * they share the date, or share the meet name within `MEET_EDITION_SPAN_DAYS`.
 */
export function distinctLifts(rows: readonly ApiLiftingResult[]): ApiLiftingResult[] {
  const keptBySignature = new Map<string, ApiLiftingResult[]>();
  const kept: ApiLiftingResult[] = [];
  for (const row of rows) {
    const signature = JSON.stringify([...attemptsOf(row), row.total]);
    const sameNumbers = keptBySignature.get(signature) ?? [];
    const duplicate = sameNumbers.some(
      (other) => other.date === row.date || (meetKey(other.meet) === meetKey(row.meet) && withinOneEdition(other.date, row.date)),
    );
    if (duplicate) continue;
    sameNumbers.push(row);
    keptBySignature.set(signature, sameNumbers);
    kept.push(row);
  }
  return kept;
}

/** The year's stats from its rows, oldest first. */
export function wrappedStats(rows: readonly ApiLiftingResult[]): WrappedStats {
  const lifts = distinctLifts(rows);
  let totalWeight = 0;
  let taken = 0;
  let made = 0;
  let bestSnatch = 0;
  let bestCleanJerk = 0;
  let bestTotal = 0;
  let totalSum = 0;
  let totals = 0;
  let streak = 0;
  let longestStreak = 0;
  // Each meet's best total, by meet name, in the order meets first appear.
  const meetTotals = new Map<string, number>();
  const madeByAttempt = [0, 0, 0];

  for (const row of lifts) {
    attemptsOf(row).forEach((attempt, slot) => {
      // An untaken attempt is neither a make nor a miss.
      if (!wasTaken(attempt)) return;
      taken++;
      if (wasMade(attempt)) {
        totalWeight += attempt;
        made++;
        madeByAttempt[slot % 3]++;
        streak++;
        longestStreak = Math.max(longestStreak, streak);
      } else {
        streak = 0;
      }
    });
    if (row.snatch_best) bestSnatch = Math.max(bestSnatch, row.snatch_best);
    if (row.cj_best) bestCleanJerk = Math.max(bestCleanJerk, row.cj_best);
    if (row.total) {
      bestTotal = Math.max(bestTotal, row.total);
      totalSum += row.total;
      totals++;
      meetTotals.set(row.meet, Math.max(meetTotals.get(row.meet) ?? 0, row.total));
    }
  }

  const makePercentage = taken > 0 ? (made / taken) * 100 : 0;
  // A tie goes to the later meet, as the app always had it.
  let topMeet: string | null = null;
  for (const [meet, total] of meetTotals) if (topMeet === null || total >= (meetTotals.get(topMeet) ?? 0)) topMeet = meet;
  // A bomb-out is no data point, and one meet has nothing to compare.
  const meetBests = [...meetTotals.values()].filter((total) => total > 0);
  const improvementFromFirst = meetBests.length >= 2 ? meetBests[meetBests.length - 1] - meetBests[0] : null;

  let favoriteAttempt: WrappedStats['favoriteAttempt'] = null;
  let favoriteMakes = 0;
  madeByAttempt.forEach((count, index) => {
    if (count > favoriteMakes) {
      favoriteAttempt = (index + 1) as 1 | 2 | 3;
      favoriteMakes = count;
    }
  });

  let yearRank: WrappedStats['yearRank'] = 'Rising Star';
  if (makePercentage >= 90) yearRank = 'Consistency King';
  else if (bestTotal >= 300) yearRank = 'Heavy Hitter';
  else if (lifts.length >= 5) yearRank = 'Meet Regular';

  return {
    totalWeightLifted: totalWeight,
    totalMeets: new Set(lifts.map((row) => row.meet)).size,
    makePercentage,
    bestSnatch,
    bestCleanJerk,
    bestTotal,
    averageTotal: totals > 0 ? totalSum / totals : 0,
    topMeet,
    improvementFromFirst,
    longestMakeStreak: longestStreak,
    favoriteAttempt,
    yearRank,
  };
}

/** The fields of a dated search answer (`results:search`) a Wrapped reads. */
export type WrappedSearch = { matched_name: string | null; suggestions: string[]; results: ApiLiftingResult[]; truncated: boolean };

const inDateOrder = (rows: readonly ApiLiftingResult[]) => [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

/**
 * The Wrapped a dated search answer makes. An exact name match is one
 * athlete. Otherwise the name-contains fallback is one athlete's year only
 * when its rows carry exactly one distinct name; with more, scoring them
 * together would merge athletes, so the names are offered to pick from. A
 * truncated answer is never scored: its rows may miss part of the year.
 */
export function selectWrapped(search: WrappedSearch): WrappedAnswer {
  const rows = search.results;
  const none = (): WrappedAnswer => (search.truncated ? { kind: 'narrow' } : { kind: 'none', suggestions: search.suggestions });
  if (rows.length === 0) return none();

  if (search.matched_name !== null) {
    const name = rows[0].name || search.matched_name;
    if (search.truncated) return { kind: 'tooManyResults', name };
    const ordered = inDateOrder(rows);
    return { kind: 'athlete', name: ordered[0].name || search.matched_name, stats: wrappedStats(ordered) };
  }

  // Distinct athletes among the fallback rows, keeping the first spelling seen.
  const byKey = new Map<string, string>();
  for (const row of rows) {
    const key = normalizeName(row.name ?? '');
    if (key && !byKey.has(key)) byKey.set(key, row.name);
  }
  if (byKey.size === 0) return none();
  if (byKey.size === 1 && !search.truncated) {
    const [[key, name]] = [...byKey];
    return { kind: 'athlete', name, stats: wrappedStats(inDateOrder(rows.filter((row) => normalizeName(row.name ?? '') === key))) };
  }
  // The athletes who lifted in the year, so each pick has a Wrapped.
  const names = [...byKey.values()].sort((a, b) => a.localeCompare(b)).slice(0, MAX_WRAPPED_NAME_CHOICES);
  return { kind: 'ambiguous', names, truncated: search.truncated || byKey.size > MAX_WRAPPED_NAME_CHOICES };
}
