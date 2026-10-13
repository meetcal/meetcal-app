import type { Infer } from 'convex/values';
import type { QueryCtx } from '../_generated/server';
import type { recordHolder } from '../schema';
import { normalizeName } from './names';
import { normalizeGender } from './normalize';
import { isPlausibleResult } from './plausible';
import { compareBytes, compareCollated, sortByWeightClass } from './sort';
import { apiError } from './validation';

// Reference answers, each the JSON of the Rust route named on it. Queries
// serve them from a view when one is fresh and compute them here otherwise;
// view builders compute them here too, so both paths give the same answer.

/** Who set a record lift, when and where; `null` for what the source leaves out. */
export type ApiRecordHolder = { name: string; date: string | null; location: string | null };

function apiHolder(holder: Infer<typeof recordHolder> | undefined): ApiRecordHolder | null {
  if (!holder) return null;
  return { name: holder.name, date: holder.date ?? null, location: holder.location ?? null };
}

/** Each lift's holder, as `snatch_by`, `cj_by` and `total_by`. */
function apiHolders(row: { snatchBy?: Infer<typeof recordHolder>; cjBy?: Infer<typeof recordHolder>; totalBy?: Infer<typeof recordHolder> }) {
  return { snatch_by: apiHolder(row.snatchBy), cj_by: apiHolder(row.cjBy), total_by: apiHolder(row.totalBy) };
}

/** `GET /data/records`: rows with all three records, by weight class, with their holders. */
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
    gender: normalizeGender(r.gender),
    record_type: r.recordType,
    ...apiHolders(r),
  }));
}

/** `GET /data/standards` */
export async function computeStandards(ctx: QueryCtx) {
  const rows = await ctx.db.query('standards').collect();
  return sortByWeightClass(rows, (r) => r.weightClass).map((r) => ({
    age_category: r.ageCategory,
    gender: normalizeGender(r.gender),
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
    gender: normalizeGender(r.gender),
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
      gender: normalizeGender(r.gender),
      age_category: r.ageCategory,
    });
  }
  return complete.sort((a, b) => b.ranking - a.ranking);
}

export type RankedTotal = { name: string; total: number };

/** Source rows per transaction for large historical ranking classes. */
const NATIONAL_RANKING_PAGE_SIZE = 1000;

export async function nationalRankingPage(ctx: QueryCtx, federation: string, ageCategory: string, cursor: string | null) {
  const page = await ctx.db.query('lifting_results')
    .withIndex('by_federation_and_age', (q) => q.eq('federation', federation).eq('age', ageCategory))
    .paginate({ cursor, numItems: NATIONAL_RANKING_PAGE_SIZE });
  const rows = page.page.flatMap((row) => (rankable(row) ? [{ name: row.name, total: row.total }] : []));
  return { rows: bestTotalPerAthlete(rows), cursor: page.continueCursor, isDone: page.isDone };
}

/**
 * Whether a result is ranked: it has a total, and its numbers can be real
 * (`isPlausibleResult`), so a typo such as a `633` snatch is not ranked
 * first, nor hides the athlete's real best.
 */
function rankable<T extends Parameters<typeof isPlausibleResult>[0]>(row: T): row is T & { total: number } {
  return typeof row.total === 'number' && row.total > 0 && isPlausibleResult(row);
}

/**
 * One row per athlete (folded name, `normalizeName`, as their history is),
 * their heaviest total under the spelling it was lifted under; heaviest
 * first, equal totals in name order (`best_total_per_athlete`).
 */
export function bestTotalPerAthlete<T extends RankedTotal>(rows: Iterable<T>): T[] {
  const best = new Map<string, T>();
  for (const row of rows) {
    const key = normalizeName(row.name);
    const existing = best.get(key);
    if (existing && existing.total >= row.total) continue;
    best.set(key, row);
  }
  return Array.from(best.values()).sort((a, b) => b.total - a.total || compareBytes(a.name, b.name));
}

export type DatedTotal = RankedTotal & { date: string };

/**
 * `GET /data/nat-rankings-year`: `/data/nat-rankings` within one calendar
 * year, each best with the date it was lifted.
 */
export async function computeNationalRankingsForYear(
  ctx: QueryCtx,
  federation: string,
  ageCategory: string,
  year: string,
): Promise<DatedTotal[]> {
  // One year's rows only: a class's whole history is too many reads for one query.
  const rows = await ctx.db
    .query('lifting_results')
    .withIndex('by_federation_age_and_date', (q) =>
      q.eq('federation', federation).eq('age', ageCategory).gte('date', `${year}-01-01`).lte('date', `${year}-12-31`),
    )
    .collect();
  const ranked: DatedTotal[] = [];
  for (const row of rows) {
    if (rankable(row)) ranked.push({ name: row.name, total: row.total, date: row.date });
  }
  return bestTotalPerAthlete(ranked);
}

type RankingGender = 'Men' | 'Women';

/** Senior, junior and masters weight classes (`getWeightClasses` in the app, `division_options` on the website). */
const SENIOR_WEIGHTS: Record<RankingGender, readonly string[]> = {
  Men: ['60', '65', '71', '79', '88', '94', '110', '110+'],
  Women: ['48', '53', '58', '63', '69', '77', '86', '86+'],
};
const UNDER_13_WEIGHTS: Record<RankingGender, readonly string[]> = {
  Men: ['40', '44', '48', '52', '56', '60', '65', '65+'],
  Women: ['36', '40', '44', '48', '53', '58', '63', '63+'],
};
const YOUTH_WEIGHTS: Record<string, Record<RankingGender, readonly string[]>> = {
  '11 Under Age Group': UNDER_13_WEIGHTS,
  '13 Under Age Group': UNDER_13_WEIGHTS,
  '14-15 Age Group': {
    Men: ['48', '52', '56', '60', '65', '71', '79', '79+'],
    Women: ['40', '44', '48', '53', '58', '63', '69', '69+'],
  },
  '16-17 Age Group': {
    Men: ['56', '60', '65', '71', '79', '88', '94', '94+'],
    Women: ['44', '48', '53', '58', '63', '69', '77', '77+'],
  },
};
const MASTERS_BANDS = ['35-39', '40-44', '45-49', '50-54', '55-59', '60-64', '65-69', '70-74', '75-79', '80-84', '85-89', '90+'];

/**
 * Every current ranking division, spelled as the app and the website send it
 * (`Open Men's 60kg`, `Women's 14-15 Age Group 48kg`, `Men's Masters (35-39)
 * 79kg`). Such a class is real even before anyone has a result in it.
 */
export const RANKING_DIVISIONS: ReadonlySet<string> = (() => {
  const divisions = new Set<string>();
  for (const gender of ['Men', 'Women'] as const) {
    for (const weight of SENIOR_WEIGHTS[gender]) {
      divisions.add(`Open ${gender}'s ${weight}kg`);
      divisions.add(`Junior ${gender}'s ${weight}kg`);
      for (const band of MASTERS_BANDS) divisions.add(`${gender}'s Masters (${band}) ${weight}kg`);
    }
    for (const [group, weights] of Object.entries(YOUTH_WEIGHTS)) {
      for (const weight of weights[gender]) divisions.add(`${gender}'s ${group} ${weight}kg`);
    }
  }
  return divisions;
})();

/**
 * Every weight class of the current divisions (senior, junior, masters and
 * youth) of one gender, as bare classes (`86+`).
 */
export function currentWeightClasses(gender: RankingGender): ReadonlySet<string> {
  return new Set([...SENIOR_WEIGHTS[gender], ...Object.values(YOUTH_WEIGHTS).flatMap((weights) => weights[gender])]);
}

export function isRankingDivision(ageCategory: string): boolean {
  return RANKING_DIVISIONS.has(ageCategory);
}

/** Federations the app, the website and the CLI rank; known whatever the data holds. */
const RANKING_FEDERATIONS: ReadonlySet<string> = new Set(['USAW', 'USAMW']);

/**
 * Rejects a ranking class nobody could mean, so a typo or the wrong case
 * answers 404 instead of an empty ranking that looks like "nobody lifted".
 * The federation must be one the clients rank or have results; the age
 * category must be a current division (`isRankingDivision`) or have results
 * under that federation (a retired class such as `Open Men's 85 kg`). A
 * current division of USAW or USAMW costs no read; anything else one or two.
 */
export async function requireKnownRankingClass(ctx: QueryCtx, federation: string, ageCategory: string): Promise<void> {
  if (!RANKING_FEDERATIONS.has(federation)) {
    const anyInFederation = await ctx.db
      .query('lifting_results')
      .withIndex('by_federation_and_age', (q) => q.eq('federation', federation))
      .first();
    if (anyInFederation === null) throw apiError(404, `unknown federation '${federation}'`);
  }
  if (isRankingDivision(ageCategory)) return;
  const anyInClass = await ctx.db
    .query('lifting_results')
    .withIndex('by_federation_and_age', (q) => q.eq('federation', federation).eq('age', ageCategory))
    .first();
  if (anyInClass === null) throw apiError(404, `unknown age category '${ageCategory}' for ${federation}`);
}

/** Distinct values in the database's text order (`SELECT DISTINCT … ORDER BY`). */
export function distinctCollated(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort(compareCollated);
}

/** Index seeks per transaction when rebuilding the club view. */
const CLUBS_PER_PAGE = 100;

/**
 * `GET /clubs` (distinct non-empty club names) a page at a time: the next
 * clubs after `after` (the empty club sorts first and is never listed), one
 * index seek per club, so duplicate roster entries are skipped without being
 * read. Rosters are never deleted, so the table only grows while the set of
 * clubs barely does.
 */
export async function clubNamesPage(ctx: QueryCtx, after: string | null): Promise<{ clubs: string[]; after: string | null }> {
  const clubs: string[] = [];
  let last = after ?? '';
  for (let i = 0; i < CLUBS_PER_PAGE; i += 1) {
    const lower = last;
    const row = await ctx.db.query('athletes').withIndex('by_club', (q) => q.gt('club', lower)).first();
    if (!row) return { clubs, after: null };
    clubs.push(row.club);
    last = row.club;
  }
  return { clubs, after: last };
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
  snatch_by: ApiRecordHolder | null;
  cj_by: ApiRecordHolder | null;
  total_by: ApiRecordHolder | null;
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
      compareCollated(normalizeGender(a.gender), normalizeGender(b.gender)) ||
      compareCollated(a.ageCategory, b.ageCategory) ||
      compareCollated(a.weightClass, b.weightClass) ||
      a._creationTime - b._creationTime,
  );
  return sortByWeightClass(rows, (r) => r.weightClass).map((r) => ({
    age_category: r.ageCategory,
    cj_record: r.cjRecord ?? null,
    gender: normalizeGender(r.gender),
    snatch_record: r.snatchRecord ?? null,
    total_record: r.totalRecord ?? null,
    weight_class: r.weightClass,
    wso: r.wso,
    ...apiHolders(r),
  }));
}

export function filterWsoRows(rows: WsoRecordRow[], ageCategory?: string, gender?: string): WsoRecordRow[] {
  // Rows answer `normalizeGender`'s spelling; so is the filter read.
  const wanted = gender === undefined ? undefined : normalizeGender(gender);
  return rows.filter(
    (r) => (ageCategory === undefined || r.age_category === ageCategory) && (wanted === undefined || r.gender === wanted),
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
const WEIGHT_CLASS = /\b(\d+\+?)kg/gi;

export type AdaptiveGender = 'men' | 'women';

/** `men` or `women`, any case; anything else is a 400 (it used to read as women). */
export function requireAdaptiveGender(gender: string): AdaptiveGender {
  const folded = gender.toLowerCase();
  if (folded === 'men' || folded === 'women') return folded;
  throw apiError(400, "gender must be 'men' or 'women'");
}

function matchesGender(age: string, gender: AdaptiveGender): boolean {
  if (gender === 'men') return MEN.test(age) && !WOMEN.test(age);
  return WOMEN.test(age);
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
  gender: AdaptiveGender,
  excludeFederation: string,
  season: string,
): Promise<AdaptiveRecord[]> {
  // The season's results only: every adaptive result ever grows each year.
  const rows = await ctx.db
    .query('lifting_results')
    .withIndex('by_adaptive_and_date', (q) => q.eq('adaptive', true).gte('date', `${season}-01-01`))
    .collect();

  const byClass = new Map<string, AdaptiveRecord>();
  for (const row of rows) {
    if (row.federation !== undefined && row.federation === excludeFederation) continue;
    const age = row.age ?? '';
    if (!matchesGender(age, gender)) continue;
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
