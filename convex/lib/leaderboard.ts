import { normalizeName } from './names';
import type { ApiLiftingResult } from './results';
import { compareBytes } from './sort';
import { apiError, isValidIsoDate } from './validation';

/**
 * The leaderboard `results:leaderboard` answers: each athlete once, by their
 * best result for a metric over a date range, best first. A port of the CLI's
 * leaderboard (`cli/src/commands/leaderboard.rs`: `Metric::value`,
 * `Filters::keeps`, `rank`) and the guards and scores it ranks with
 * (`cli/src/utils/stats.rs`: `plausible`, `row_sinclair`, `row_qpoints`,
 * `Division::parse`, `fold`), so the CLI's answers did not change when the
 * ranking moved to the server.
 *
 * Its source-error guard is the CLI's, not `lib/plausible.ts`'s, which
 * differs: lower ceilings (best snatch 230, best clean & jerk 275, total 500
 * kg, against 240 / 290 / 520), a typo'd attempt is any made attempt over 1.5
 * times the heaviest other one (`lib/plausible.ts` also needs it 20 kg
 * heavier, and checks every attempt against the ceiling, not just the best),
 * and a total that is one lift alone (snatch 0, clean & jerk 90, total 90)
 * passes, as it adds up.
 */

export type LeaderboardMetric = 'total' | 'snatch' | 'cj' | 'sinclair' | 'qpoints';
export type Gender = 'Men' | 'Women';

/** The rows a leaderboard shows when the caller does not say. */
export const DEFAULT_LEADERBOARD_LIMIT = 50;
/** The most rows a leaderboard answers. */
export const MAX_LEADERBOARD_LIMIT = 500;
/** The widest range a leaderboard ranks: `to` is before `from` plus this many years. */
export const MAX_LEADERBOARD_YEARS = 5;

/** The federation left out unless asked for: British Weightlifting (`EXCLUDED_FEDERATION`). */
export const EXCLUDED_FEDERATION = 'BWL';

// ---------------------------------------------------------------------------
// Scores (`stats.rs`)
// ---------------------------------------------------------------------------

/** IWF Sinclair coefficients, 2021–2024 cycle, as `[A, b]` (`SINCLAIR_MEN` / `SINCLAIR_WOMEN`). */
export const SINCLAIR_MEN = [0.722762521, 193.609] as const;
export const SINCLAIR_WOMEN = [0.787004341, 153.757] as const;

/** Q-points `[Tmax, β0, β1, β2]` (https://osf.io/8x3nb/; `QPOINTS_MEN` / `QPOINTS_WOMEN`). */
export const QPOINTS_MEN = [463.26, 416.7, -47.87, 18.93] as const;
export const QPOINTS_WOMEN = [306.54, 266.5, -19.44, 18.61] as const;
/** Lighter lifters are scored at these bodyweights. */
export const QPOINTS_MIN_BODY_WEIGHT_MEN = 50;
export const QPOINTS_MIN_BODY_WEIGHT_WOMEN = 41;

/** Bodyweights outside this range (kg) are source errors: no score is computed for them. */
export const PLAUSIBLE_BODY_WEIGHT = { min: 15, max: 250 } as const;

const plausibleBodyWeight = (bw: number) => bw >= PLAUSIBLE_BODY_WEIGHT.min && bw <= PLAUSIBLE_BODY_WEIGHT.max;

/** A total's Sinclair score at `bodyWeight`, or null without a total or a plausible bodyweight. */
export function sinclair(total: number, bodyWeight: number, gender: Gender): number | null {
  if (total <= 0 || !Number.isFinite(total) || !plausibleBodyWeight(bodyWeight)) return null;
  const [a, b] = gender === 'Men' ? SINCLAIR_MEN : SINCLAIR_WOMEN;
  if (bodyWeight >= b) return total;
  const log = Math.log10(bodyWeight / b);
  return total * Math.pow(10, a * log * log);
}

/** A total's Q-points at `bodyWeight`, or null without a total or a plausible bodyweight. */
export function qpoints(total: number, bodyWeight: number, gender: Gender): number | null {
  if (total <= 0 || !Number.isFinite(total) || !plausibleBodyWeight(bodyWeight)) return null;
  const [tMax, b0, b1, b2] = gender === 'Men' ? QPOINTS_MEN : QPOINTS_WOMEN;
  const floor = gender === 'Men' ? QPOINTS_MIN_BODY_WEIGHT_MEN : QPOINTS_MIN_BODY_WEIGHT_WOMEN;
  const scaled = Math.max(bodyWeight, floor) / 100;
  const squared = scaled * scaled;
  return (total * tMax) / (b0 + b1 / squared + b2 * squared);
}

// ---------------------------------------------------------------------------
// Divisions (`Division::parse`)
// ---------------------------------------------------------------------------

/** ASCII-only lowercase, as Rust's `to_ascii_lowercase`. */
const asciiLower = (value: string) => value.replace(/[A-Z]/g, (c) => c.toLowerCase());

const WOMEN_WORDS = ['women', 'woman', 'womens', 'female', 'females', 'girl', 'girls'];
const MEN_WORDS = ['men', 'man', 'mens', 'male', 'males', 'boy', 'boys'];

/** The gender a division names by its words, or null when it names neither or both. */
function divisionGender(lower: string): Gender | null {
  const words = lower.split(/[^A-Za-z]+/).filter((word) => word.length > 0);
  const women = words.some((word) => WOMEN_WORDS.includes(word));
  const men = words.some((word) => MEN_WORDS.includes(word));
  if (men && !women) return 'Men';
  if (women && !men) return 'Women';
  return null;
}

const YOUTH_MARKERS: readonly (readonly [string, string])[] = [
  ['under 17', 'U17'],
  ['under 15', 'U15'],
  ['under 13', 'U13'],
  ['under 12', 'U13'],
  ['under 11', 'U11'],
  ['under 10', 'U11'],
  ['16-17', 'U17'],
  ['14-15', 'U15'],
  ['13 under', 'U13'],
  ['11 under', 'U11'],
  ['youth', 'U17'],
];

/** The age category a division names: `Senior`, `Junior`, `U23`, `U17` … `U11`, `Masters 40`; null otherwise. */
function divisionCategory(lower: string): string | null {
  const masters = lower.split('masters (');
  if (masters.length > 1) {
    const start = /^\d*/.exec(masters[1])![0];
    return start === '' ? null : `Masters ${start}`;
  }
  if (lower.startsWith('open') || lower.includes(' open ') || lower.includes('senior')) return 'Senior';
  if (lower.includes('junior')) return 'Junior';
  if (lower.includes('under 23')) return 'U23';
  for (const [marker, label] of YOUTH_MARKERS) if (lower.includes(marker)) return label;
  return null;
}

export type Division = { gender: Gender | null; category: string | null };

/** A result's division (`Open Men's 89kg`, `Women's Masters (40-44) 69kg`), parsed. */
export function parseDivision(division: string): Division {
  const lower = asciiLower(division);
  return { gender: divisionGender(lower), category: divisionCategory(lower) };
}

/**
 * An age category as division labels name it (the CLI's `filters::category`):
 * `Senior` (or `Open`), `Junior`, `U17` (or `Youth`, `16-17`), `U15` (or
 * `14-15`), `U13`, `U11`, or `Masters 30` … `Masters 95`; case and spacing
 * ignored. Null for anything else.
 */
export function normalizeCategory(value: string): string | null {
  const compact = asciiLower(value.replace(/\s+/g, ''));
  switch (compact) {
    case 'senior':
    case 'open':
      return 'Senior';
    case 'junior':
      return 'Junior';
    case 'u17':
    case 'youth':
    case '16-17':
      return 'U17';
    case 'u15':
    case '14-15':
      return 'U15';
    case 'u13':
      return 'U13';
    case 'u11':
      return 'U11';
  }
  const age = /^masters(\d+)$/.exec(compact);
  if (!age) return null;
  const years = Number(age[1]);
  return years >= 30 && years <= 95 && years % 5 === 0 ? `Masters ${years}` : null;
}

export const CATEGORIES = 'Senior, Junior, U17 (or Youth), U15, U13, U11, or Masters 30 … Masters 95';

// ---------------------------------------------------------------------------
// Source errors (`plausible`)
// ---------------------------------------------------------------------------

/** The heaviest best snatch, best clean & jerk and total a result can hold (`MAX_SNATCH` …). */
export const MAX_SNATCH = 230;
export const MAX_CJ = 275;
export const MAX_TOTAL = 500;
/** A made attempt more than this many times the heaviest other one in its lift is a typo. */
export const MAX_ATTEMPT_JUMP = 1.5;

/** The numbers of a row the guards and scores read. */
export type RankedFields = Pick<
  ApiLiftingResult,
  | 'federation'
  | 'meet'
  | 'date'
  | 'name'
  | 'age'
  | 'body_weight'
  | 'snatch1'
  | 'snatch2'
  | 'snatch3'
  | 'snatch_best'
  | 'cj1'
  | 'cj2'
  | 'cj3'
  | 'cj_best'
  | 'total'
  | 'adaptive'
>;

/** Whether the total is the snatch plus the clean & jerk, or there is none (`consistent_total`). */
export function consistentTotal(row: RankedFields): boolean {
  return row.total <= 0 || Math.abs(row.total - (row.snatch_best + row.cj_best)) <= 0.5;
}

function plausibleLift(best: number, attempts: readonly number[], ceiling: number): boolean {
  if (best > ceiling) return false;
  const weights = attempts.map(Math.abs);
  return attempts.every((attempt, index) => {
    const heaviestOther = weights.reduce((max, weight, other) => (other !== index && weight > 0 ? Math.max(max, weight) : max), 0);
    return attempt <= 0 || heaviestOther === 0 || attempt <= heaviestOther * MAX_ATTEMPT_JUMP;
  });
}

/** Whether a row can be trusted for a ranking or a score (`plausible`). */
export function plausible(row: RankedFields): boolean {
  return (
    consistentTotal(row) &&
    row.total <= MAX_TOTAL &&
    plausibleLift(row.snatch_best, [row.snatch1, row.snatch2, row.snatch3], MAX_SNATCH) &&
    plausibleLift(row.cj_best, [row.cj1, row.cj2, row.cj3], MAX_CJ)
  );
}

/** A row's Sinclair score; null for a division with no gender, or a source error (`row_sinclair`). */
export function rowSinclair(row: RankedFields): number | null {
  if (!plausible(row)) return null;
  const gender = parseDivision(row.age).gender;
  return gender === null ? null : sinclair(row.total, row.body_weight, gender);
}

/** Whether Q-points apply to a division: juniors, seniors and Masters, not youth (`qpoints_apply`). */
export function qpointsApply(division: Division): boolean {
  return !['U17', 'U15', 'U13', 'U11'].includes(division.category ?? '');
}

/** A row's Q-points; null for youth divisions and source errors (`row_qpoints`). */
export function rowQpoints(row: RankedFields): number | null {
  const division = parseDivision(row.age);
  if (!plausible(row) || !qpointsApply(division) || division.gender === null) return null;
  return qpoints(row.total, row.body_weight, division.gender);
}

/** What a row scores by `metric`, or null when it has none or is a source error (`Metric::value`). */
export function metricValue(metric: LeaderboardMetric, row: RankedFields): number | null {
  if (!plausible(row)) return null;
  let value: number | null;
  switch (metric) {
    case 'total':
      value = row.total;
      break;
    case 'snatch':
      value = row.snatch_best;
      break;
    case 'cj':
      value = row.cj_best;
      break;
    case 'sinclair':
      value = rowSinclair(row);
      break;
    case 'qpoints':
      value = rowQpoints(row);
      break;
  }
  return value !== null && value > 0 ? value : null;
}

// ---------------------------------------------------------------------------
// Filters and ranking (`Filters::keeps`, `rank`)
// ---------------------------------------------------------------------------

export type LeaderboardFilters = {
  gender?: Gender;
  /** A normalized category (`normalizeCategory`). */
  category?: string;
  /** Text the division must contain, any case. */
  division?: string;
  /** Only this federation (any ASCII case); without it, every federation but BWL. */
  federation?: string;
  /** Keep adaptive results. */
  adaptive?: boolean;
};

/** Whether a row passes `filters` (`Filters::keeps`). */
export function keeps(filters: LeaderboardFilters, row: RankedFields): boolean {
  const division = parseDivision(row.age);
  if (!filters.adaptive && row.adaptive) return false;
  if (filters.gender !== undefined && division.gender !== filters.gender) return false;
  if (filters.category !== undefined) {
    const wanted = asciiLower(filters.category.trim());
    if (division.category === null || asciiLower(division.category) !== wanted) return false;
  }
  if (filters.division !== undefined && !row.age.toLowerCase().includes(filters.division.trim().toLowerCase())) return false;
  if (filters.federation !== undefined) return asciiLower(row.federation) === asciiLower(filters.federation.trim());
  return asciiLower(row.federation) !== asciiLower(EXCLUDED_FEDERATION);
}

/** One athlete's best row so far and what it scores. */
export type Candidate = { row: RankedFields; value: number };

/** Whether `next` replaces `current` as an athlete's best: higher, or as high and earlier. */
const beats = (next: Candidate, current: Candidate) => next.value > current.value || (next.value === current.value && next.row.date < current.row.date);

/**
 * Folds `rows` (in date order) into `best`, each athlete's (folded name's)
 * best row by `metric` among those passing `filters`. On a full tie the row
 * seen first stays, so folding pages in date order, or folding each page's
 * own bests in that order (`mergeBests`), picks the same rows.
 */
export function addBests(best: Map<string, Candidate>, rows: Iterable<RankedFields>, metric: LeaderboardMetric, filters: LeaderboardFilters): void {
  for (const row of rows) {
    if (!keeps(filters, row)) continue;
    const value = metricValue(metric, row);
    if (value === null) continue;
    mergeCandidate(best, normalizeName(row.name), { row, value });
  }
}

function mergeCandidate(best: Map<string, Candidate>, key: string, next: Candidate): void {
  const current = best.get(key);
  if (current === undefined || beats(next, current)) best.set(key, next);
}

/** Folds bests found later in date order (`addBests` over a later page) into `best`. */
export function mergeBests(best: Map<string, Candidate>, later: Iterable<Candidate>): void {
  for (const candidate of later) mergeCandidate(best, normalizeName(candidate.row.name), candidate);
}

/** The athletes' bests, best first (ties: the earlier result, then the name), at most `limit`. */
export function rankBests(bests: Iterable<Candidate>, limit: number): Candidate[] {
  return [...bests]
    .sort((a, b) => b.value - a.value || compareBytes(a.row.date, b.row.date) || compareBytes(a.row.name, b.row.name))
    .slice(0, limit);
}

/** Each athlete once by their best `metric` among `rows` (in date order) passing `filters`: the CLI's `rank`. */
export function rank(rows: Iterable<RankedFields>, metric: LeaderboardMetric, filters: LeaderboardFilters, limit: number): Candidate[] {
  const best = new Map<string, Candidate>();
  addBests(best, rows, metric, filters);
  return rankBests(best.values(), limit);
}

/** A leaderboard row as `results:leaderboard` answers it: what the CLI's table prints. */
export type LeaderboardRow = {
  name: string;
  date: string;
  meet: string;
  /** The division. */
  age: string;
  federation: string;
  body_weight: number;
  snatch_best: number;
  cj_best: number;
  total: number;
  sinclair: number | null;
  qpoints: number | null;
  /** What it was ranked by. */
  value: number;
};

export function leaderboardRow({ row, value }: Candidate): LeaderboardRow {
  return {
    name: row.name,
    date: row.date,
    meet: row.meet,
    age: row.age,
    federation: row.federation,
    body_weight: row.body_weight,
    snatch_best: row.snatch_best,
    cj_best: row.cj_best,
    total: row.total,
    sinclair: rowSinclair(row),
    qpoints: rowQpoints(row),
    value,
  };
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

export type LeaderboardArgs = {
  from: string;
  to: string;
  by: LeaderboardMetric;
  gender?: Gender;
  category?: string;
  division?: string;
  federation?: string;
  adaptive?: boolean;
  limit?: number;
};

export type CheckedLeaderboardArgs = { from: string; to: string; by: LeaderboardMetric; limit: number; filters: LeaderboardFilters };

/** `from` plus `years`, as a `YYYY-MM-DD` string to compare against (Feb 29 compares as itself). */
const plusYears = (date: string, years: number) => `${String(Number(date.slice(0, 4)) + years).padStart(4, '0')}${date.slice(4)}`;

/** The arguments checked, with their defaults: 400 for a bad date, range, limit, category or a score without a gender. */
export function checkLeaderboardArgs(args: LeaderboardArgs): CheckedLeaderboardArgs {
  if (!isValidIsoDate(args.from)) throw apiError(400, 'from must be a valid YYYY-MM-DD date');
  if (!isValidIsoDate(args.to)) throw apiError(400, 'to must be a valid YYYY-MM-DD date');
  if (args.to < args.from) throw apiError(400, 'to must not be before from');
  if (args.to >= plusYears(args.from, MAX_LEADERBOARD_YEARS)) {
    throw apiError(400, `a leaderboard covers at most ${MAX_LEADERBOARD_YEARS} years: narrow the range`);
  }
  const limit = args.limit ?? DEFAULT_LEADERBOARD_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LEADERBOARD_LIMIT) {
    throw apiError(400, `limit must be a whole number from 1 to ${MAX_LEADERBOARD_LIMIT}`, { max: MAX_LEADERBOARD_LIMIT });
  }
  if ((args.by === 'sinclair' || args.by === 'qpoints') && args.gender === undefined) {
    throw apiError(400, 'Sinclair and Q-points score men and women on separate scales: add a gender');
  }
  let category: string | undefined;
  if (args.category !== undefined) {
    category = normalizeCategory(args.category) ?? undefined;
    if (category === undefined) throw apiError(400, `Unknown age category "${args.category.trim()}"; use ${CATEGORIES}`);
  }
  if (args.federation !== undefined && args.federation.trim() === '') throw apiError(400, 'federation must not be blank');
  return {
    from: args.from,
    to: args.to,
    by: args.by,
    limit,
    filters: {
      gender: args.gender,
      category,
      division: args.division,
      federation: args.federation?.trim(),
      adaptive: args.adaptive ?? false,
    },
  };
}

/**
 * `from` to `to` (inclusive) cut at month ends: each slice is read as its
 * own cursor chain, several side by side. Every day is in one slice, in
 * order.
 */
export function monthSlices(from: string, to: string): [string, string][] {
  const slices: [string, string][] = [];
  let start = from;
  while (start <= to) {
    const year = Number(start.slice(0, 4));
    const month = Number(start.slice(5, 7));
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const monthEnd = `${start.slice(0, 8)}${String(lastDay).padStart(2, '0')}`;
    const end = monthEnd < to ? monthEnd : to;
    slices.push([start, end]);
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    start = `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01`;
  }
  return slices;
}
