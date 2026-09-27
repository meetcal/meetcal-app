import type { QueryCtx } from '../_generated/server';
import { compareBytes, compareCollated, sortByWeightClass } from './sort';

// Reference answers, each the JSON of the Rust route named on it. Queries
// serve them from a view when one is fresh and compute them here otherwise;
// view builders compute them here too, so both paths give the same answer.

/** `GET /data/records`: rows with all three records, by weight class. */
export async function computeRecords(ctx: QueryCtx) {
  const rows = (await ctx.db.query('records').collect()).filter(
    (r) => r.snatchRecord !== undefined && r.cjRecord !== undefined && r.totalRecord !== undefined,
  );
  return sortByWeightClass(rows, (r) => r.weightClass).map((r) => ({
    age_category: r.ageCategory,
    cj_record: r.cjRecord!,
    snatch_record: r.snatchRecord!,
    total_record: r.totalRecord!,
    weight_class: r.weightClass,
    gender: r.gender,
    record_type: r.recordType,
  }));
}

/** `GET /data/standards` */
export async function computeStandards(ctx: QueryCtx) {
  const rows = await ctx.db.query('standards').collect();
  return sortByWeightClass(rows, (r) => r.weightClass).map((r) => ({
    age_category: r.ageCategory,
    gender: r.gender,
    standard_a: r.standardA,
    standard_b: r.standardB,
    weight_class: r.weightClass,
  }));
}

/** `GET /data/qualifying-totals` */
export async function computeQualifyingTotals(ctx: QueryCtx) {
  const rows = await ctx.db.query('qualifying_totals').collect();
  return sortByWeightClass(rows, (r) => r.weightClass).map((r) => ({
    event_name: r.eventName,
    gender: r.gender,
    age_category: r.ageCategory,
    weight_class: r.weightClass,
    qualifying_total: r.qualifyingTotal,
  }));
}

/** `GET /data/intl-rankings`: complete rows, highest `ranking` first. */
export async function computeIntlRankings(ctx: QueryCtx) {
  const complete = [];
  for (const r of await ctx.db.query('intl_rankings').collect()) {
    if (
      r.meet === undefined ||
      r.ranking === undefined ||
      r.name === undefined ||
      r.weightClass === undefined ||
      r.total === undefined ||
      r.percentA === undefined ||
      r.gender === undefined ||
      r.ageCategory === undefined
    ) {
      continue;
    }
    complete.push({
      meet: r.meet,
      ranking: r.ranking,
      name: r.name,
      weight_class: r.weightClass,
      total: r.total,
      percent_a: r.percentA,
      gender: r.gender,
      age_category: r.ageCategory,
    });
  }
  return complete.sort((a, b) => b.ranking - a.ranking);
}

export type RankedTotal = { name: string; total: number };

/**
 * One row per athlete, their heaviest total; heaviest first, equal totals in
 * name order (`best_total_per_athlete`).
 */
export function bestTotalPerAthlete(rows: Iterable<RankedTotal>): RankedTotal[] {
  const best = new Map<string, RankedTotal>();
  for (const row of rows) {
    const existing = best.get(row.name);
    if (existing && existing.total >= row.total) continue;
    best.set(row.name, row);
  }
  return Array.from(best.values()).sort((a, b) => b.total - a.total || compareBytes(a.name, b.name));
}

/** `GET /data/nat-rankings` */
export async function computeNationalRankings(
  ctx: QueryCtx,
  federation: string,
  ageCategory: string,
): Promise<RankedTotal[]> {
  const rows = await ctx.db
    .query('lifting_results')
    .withIndex('by_federation_and_age', (q) => q.eq('federation', federation).eq('age', ageCategory))
    .collect();
  const ranked: RankedTotal[] = [];
  for (const row of rows) {
    if (row.total === undefined || row.total === 0) continue;
    ranked.push({ name: row.name, total: row.total });
  }
  return bestTotalPerAthlete(ranked);
}

/** Distinct values in the database's text order (`SELECT DISTINCT … ORDER BY`). */
export function distinctCollated(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort(compareCollated);
}

/**
 * `GET /clubs`: distinct non-empty club names. Skips along the club index one
 * read per club rather than reading every roster row: rosters are never
 * deleted, so the table only grows, while the set of clubs barely does.
 */
export async function computeClubs(ctx: QueryCtx): Promise<string[]> {
  const clubs: string[] = [];
  let last: string | null = null;
  for (;;) {
    const after: string | null = last;
    const row = await ctx.db
      .query('athletes')
      .withIndex('by_club', (q) => (after === null ? q : q.gt('club', after)))
      .first();
    if (!row) break;
    if (row.club !== '') clubs.push(row.club);
    last = row.club;
  }
  return distinctCollated(clubs);
}

/** `GET /data/wso/` */
export async function computeWsoList(ctx: QueryCtx): Promise<string[]> {
  const rows = await ctx.db.query('wso_records').collect();
  return distinctCollated(rows.map((r) => r.wso));
}

export type WsoRecordRow = {
  age_category: string;
  cj_record: number | null;
  gender: string;
  snatch_record: number | null;
  total_record: number | null;
  weight_class: string;
  wso: string;
};

/**
 * `GET /data/wso/records` for a whole WSO, in the route's order (gender, age,
 * class, insertion; then weight class). Narrowing by age or gender filters
 * this list, which keeps its order.
 */
export async function computeWsoRows(ctx: QueryCtx, wso: string): Promise<WsoRecordRow[]> {
  const rows = (
    await ctx.db
      .query('wso_records')
      .withIndex('by_wso', (q) => q.eq('wso', wso))
      .collect()
  ).sort(
    (a, b) =>
      compareCollated(a.gender, b.gender) ||
      compareCollated(a.ageCategory, b.ageCategory) ||
      compareCollated(a.weightClass, b.weightClass) ||
      a._creationTime - b._creationTime,
  );
  return sortByWeightClass(rows, (r) => r.weightClass).map((r) => ({
    age_category: r.ageCategory,
    cj_record: r.cjRecord ?? null,
    gender: r.gender,
    snatch_record: r.snatchRecord ?? null,
    total_record: r.totalRecord ?? null,
    weight_class: r.weightClass,
    wso: r.wso,
  }));
}

export function filterWsoRows(rows: WsoRecordRow[], ageCategory?: string, gender?: string): WsoRecordRow[] {
  return rows.filter(
    (r) => (ageCategory === undefined || r.age_category === ageCategory) && (gender === undefined || r.gender === gender),
  );
}

export function wsoAgeGroups(rows: WsoRecordRow[]): string[] {
  return distinctCollated(rows.map((r) => r.age_category));
}

// ---------------------------------------------------------------------------
// `GET /data/adaptive`
// ---------------------------------------------------------------------------

export const ADAPTIVE_RECORDS_SEASON_START = '2026';

const MEN = /\bmen\b/i;
const WOMEN = /\bwomen\b/i;
const YEAR = /\b\d{4}\b/;
const WEIGHT_CLASS = /\b(\d+\+?)kg/gi;

function matchesGender(age: string, gender: string): boolean {
  if (gender.toLowerCase() === 'men') return MEN.test(age) && !WOMEN.test(age);
  return WOMEN.test(age);
}

function yearOf(date: string): number {
  const match = YEAR.exec(date);
  return match ? Number(match[0]) : 0;
}

function isInsideParens(text: string, index: number): boolean {
  const before = text.slice(0, index);
  const open = before.lastIndexOf('(');
  return open !== -1 && !before.slice(open).includes(')');
}

/** The first `NNkg` / `NN+kg` in an age label that is not inside parentheses. */
function classOf(age: string): string | null {
  for (const match of age.matchAll(WEIGHT_CLASS)) {
    const start = (match.index ?? 0) + match[0].indexOf(match[1]);
    if (!isInsideParens(age, start)) return match[1];
  }
  return null;
}

export type AdaptiveRecord = { weight_class: string; snatch: number; cj: number; total: number };

/** The season's best lifts per weight class. */
export async function computeAdaptiveRecords(
  ctx: QueryCtx,
  gender: string,
  excludeFederation: string,
  season: string,
): Promise<AdaptiveRecord[]> {
  const seasonStart = Number(season);
  const seasonStartDate = `${season}-01-01`;
  const rows = await ctx.db
    .query('lifting_results')
    .withIndex('by_adaptive', (q) => q.eq('adaptive', true))
    .collect();

  const byClass = new Map<string, AdaptiveRecord>();
  for (const row of rows) {
    if (row.date < seasonStartDate) continue;
    if (row.federation !== undefined && row.federation === excludeFederation) continue;
    const age = row.age ?? '';
    if (!matchesGender(age, gender)) continue;
    if (yearOf(row.date) < seasonStart) continue;
    const weightClass = classOf(age);
    if (weightClass === null) continue;
    const current = byClass.get(weightClass) ?? { weight_class: weightClass, snatch: 0, cj: 0, total: 0 };
    byClass.set(weightClass, {
      weight_class: weightClass,
      snatch: Math.max(current.snatch, row.snatchBest ?? 0),
      cj: Math.max(current.cj, row.cjBest ?? 0),
      total: Math.max(current.total, row.total ?? 0),
    });
  }
  const ordered = Array.from(byClass.values()).sort((a, b) => compareBytes(a.weight_class, b.weight_class));
  return sortByWeightClass(ordered, (r) => r.weight_class);
}
