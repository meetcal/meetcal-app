import { isRecord } from './json';
import { ADAPTIVE_SEASON_RESULTS_MAX, DIVISION_YEAR_RESULTS_MAX, INTL_RANKINGS_MAX, QUALIFYING_TOTALS_MAX, RECORDS_MAX, STANDARDS_MAX, WSO_RECORDS_MAX, readAll } from './boundedRead';
import type { Infer } from 'convex/values';
import type { QueryCtx } from '../_generated/server';
import type { recordHolder } from '../schema';
import { genderWordPattern } from './gender';
import { countedRowKey, NO_SOLE_LIFTERS, soleLiftersOf, type SoleLifters, unlinkedNameKeys } from './lifterKeys';
import { normalizeGender } from './normalize';
import { isPlausibleResult } from './plausible';
import { narrowedByAgeAndGender } from './referenceFilters';
import { compareBytes, compareCollated, sortByWeightClass } from './sort';
import { apiError } from './validation';
import { classNamedIn } from './weightClass';
import { isMaintainedWso } from './wsoSources';

// Reference answers, each the JSON of the Rust route named on it. Queries
// serve them from a view when one is fresh and compute them here otherwise;
// view builders compute them here too, so both paths give the same answer.

/** Who set a record lift, when and where; `null` for what the source leaves out. */
export type ApiRecordHolder = { name: string; date: string | null; location: string | null };

function apiHolder(holder: Infer<typeof recordHolder> | undefined): ApiRecordHolder | null {
  if (!holder) return null;
  return { name: holder.name, date: holder.date ?? null, location: holder.location ?? null };
}

/** A record lift with no record set, as the records table stores it. */
const UNSET_RECORD = 0;

/** Each lift's holder, as `snatch_by`, `cj_by` and `total_by`. */
function apiHolders(row: { snatchBy?: Infer<typeof recordHolder>; cjBy?: Infer<typeof recordHolder>; totalBy?: Infer<typeof recordHolder> }) {
  return { snatch_by: apiHolder(row.snatchBy), cj_by: apiHolder(row.cjBy), total_by: apiHolder(row.totalBy) };
}

/**
 * `GET /data/records`: every row, by weight class, with its holders. A lift
 * the source left unset answers `0`, the table's "no record set" (44 USAW
 * masters classes already answer it), which the app and website show as "—".
 * Requiring all three lifts dropped the whole class, its claimed lifts and
 * holders with it. Not `null`, as `/data/wso/records` answers: released CLIs
 * read these lifts as numbers and would fail the whole table on a `null`.
 */
export async function computeRecords(ctx: QueryCtx) {
  const rows = await readAll(ctx.db.query('records'), RECORDS_MAX, 'records');
  return sortByWeightClass(rows, (r) => r.weightClass).map((r) => ({
    age_category: r.ageCategory,
    cj_record: r.cjRecord ?? UNSET_RECORD,
    snatch_record: r.snatchRecord ?? UNSET_RECORD,
    total_record: r.totalRecord ?? UNSET_RECORD,
    weight_class: r.weightClass,
    gender: normalizeGender(r.gender),
    record_type: r.recordType,
    ...apiHolders(r),
  }));
}

/** `GET /data/standards` */
export async function computeStandards(ctx: QueryCtx) {
  const rows = await readAll(ctx.db.query('standards'), STANDARDS_MAX, 'standards');
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
  const rows = await readAll(ctx.db.query('qualifying_totals'), QUALIFYING_TOTALS_MAX, 'qualifying totals');
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
  for (const r of await readAll(ctx.db.query('intl_rankings'), INTL_RANKINGS_MAX, 'international rankings')) {
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

export type LinkedTotal = RankedTotal & { lifter_id?: string };

export const rankedTotalOf = ({ name, total }: RankedTotal): RankedTotal => ({ name, total });

const linkedRow = (row: { name: string; total: number; lifterId?: string }): LinkedTotal =>
  row.lifterId === undefined ? { name: row.name, total: row.total } : { name: row.name, total: row.total, lifter_id: row.lifterId };

/** Source rows per transaction for large historical ranking classes. */
const NATIONAL_RANKING_PAGE_SIZE = 1000;

export async function nationalRankingPage(ctx: QueryCtx, federation: string, ageCategory: string, cursor: string | null) {
  const page = await ctx.db.query('lifting_results')
    .withIndex('by_federation_age_and_date', (q) => q.eq('federation', federation).eq('age', ageCategory))
    .paginate({ cursor, numItems: NATIONAL_RANKING_PAGE_SIZE });
  const rows = page.page.flatMap((row) => (rankable(row) ? [linkedRow(row)] : []));
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

export function bestTotalPerAthlete<T extends LinkedTotal>(rows: Iterable<T>, sole: SoleLifters = NO_SOLE_LIFTERS): T[] {
  const best = new Map<string, T>();
  for (const row of rows) {
    const key = countedRowKey(row, sole);
    const existing = best.get(key);
    if (existing && existing.total >= row.total) continue;
    best.set(key, row);
  }
  return Array.from(best.values()).sort((a, b) => b.total - a.total || compareBytes(a.name, b.name));
}

export type DatedTotal = RankedTotal & { date: string };

type LinkedDatedTotal = LinkedTotal & { date: string };

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
  const rows = await readAll(
    ctx.db
      .query('lifting_results')
      .withIndex('by_federation_age_and_date', (q) =>
        q.eq('federation', federation).eq('age', ageCategory).gte('date', `${year}-01-01`).lte('date', `${year}-12-31`),
      ),
    DIVISION_YEAR_RESULTS_MAX,
    'results of one division in one year',
  );
  const ranked: LinkedDatedTotal[] = [];
  for (const row of rows) {
    if (rankable(row)) ranked.push({ ...linkedRow(row), date: row.date });
  }
  const sole = await soleLiftersOf(ctx, unlinkedNameKeys(ranked));
  return bestTotalPerAthlete(ranked, sole).map(({ name, total, date }) => ({ name, total, date }));
}

type RankingGender = 'Men' | 'Women';

type ClassSet = Record<RankingGender, readonly string[]>;
type ClassEra = { senior: ClassSet; '16-17': ClassSet; '14-15': ClassSet; under13: ClassSet };

/**
 * USAW's weight classes, newest first: senior (Open, Junior and every
 * Masters band), 16-17, 14-15, and 13 & Under / 11 & Under. The same table,
 * with its dates, is the app's `WEIGHT_CLASS_ERAS` (`src/constants/
 * weight-classes.ts`), which builds the app's picker (`getWeightClasses`) and
 * the website's (`division_groups`); a test holds this one to it.
 */
const CLASS_ERAS: readonly ClassEra[] = [
  // Since Aug 1, 2026.
  {
    senior: {
      Men: ['60', '65', '70', '75', '85', '95', '110', '110+'],
      Women: ['49', '53', '57', '61', '69', '77', '86', '86+'],
    },
    '16-17': {
      Men: ['55', '60', '65', '70', '75', '85', '95', '95+'],
      Women: ['45', '49', '53', '57', '61', '69', '77', '77+'],
    },
    '14-15': {
      Men: ['50', '55', '60', '65', '70', '75', '85', '95', '95+'],
      Women: ['45', '49', '53', '57', '61', '69', '77', '77+'],
    },
    under13: {
      Men: ['32', '36', '40', '45', '50', '55', '60', '65', '70', '70+'],
      Women: ['30', '33', '37', '41', '45', '49', '53', '57', '61', '61+'],
    },
  },
  // Jun 1, 2025 to Jul 31, 2026.
  {
    senior: {
      Men: ['60', '65', '71', '79', '88', '94', '110', '110+'],
      Women: ['48', '53', '58', '63', '69', '77', '86', '86+'],
    },
    '16-17': {
      Men: ['56', '60', '65', '71', '79', '88', '94', '94+'],
      Women: ['44', '48', '53', '58', '63', '69', '77', '77+'],
    },
    '14-15': {
      Men: ['48', '52', '56', '60', '65', '71', '79', '79+'],
      Women: ['40', '44', '48', '53', '58', '63', '69', '69+'],
    },
    under13: {
      Men: ['32', '36', '40', '44', '48', '52', '56', '60', '65', '65+'],
      Women: ['30', '33', '36', '40', '44', '48', '53', '58', '63', '63+'],
    },
  },
];
const MASTERS_BANDS = ['35-39', '40-44', '45-49', '50-54', '55-59', '60-64', '65-69', '70-74', '75-79', '80-84', '85-89', '90+'];

/**
 * Every ranking division the app and the website offer, current and retired
 * classes alike, spelled as they send it (`Open Men's 85kg`, `Women's 14-15
 * Age Group 49kg`, `Men's Masters (35-39) 79kg`). Such a class is real even
 * before anyone has a result in it.
 */
export const RANKING_DIVISIONS: ReadonlySet<string> = (() => {
  const divisions = new Set<string>();
  for (const era of CLASS_ERAS) {
    for (const gender of ['Men', 'Women'] as const) {
      for (const weight of era.senior[gender]) {
        divisions.add(`Open ${gender}'s ${weight}kg`);
        divisions.add(`Junior ${gender}'s ${weight}kg`);
        for (const band of MASTERS_BANDS) divisions.add(`${gender}'s Masters (${band}) ${weight}kg`);
      }
      for (const weight of era['16-17'][gender]) divisions.add(`${gender}'s 16-17 Age Group ${weight}kg`);
      for (const weight of era['14-15'][gender]) divisions.add(`${gender}'s 14-15 Age Group ${weight}kg`);
      for (const weight of era.under13[gender]) {
        divisions.add(`${gender}'s 13 Under Age Group ${weight}kg`);
        divisions.add(`${gender}'s 11 Under Age Group ${weight}kg`);
      }
    }
  }
  return divisions;
})();

/**
 * Every weight class of one gender's divisions (senior, junior, masters and
 * youth) in every era of `CLASS_ERAS`, as bare classes (`86+`): a start list
 * loaded by hand can be from either side of a class change.
 */
export function currentWeightClasses(gender: RankingGender): ReadonlySet<string> {
  return new Set(CLASS_ERAS.flatMap((era) => [...era.senior[gender], ...era['16-17'][gender], ...era['14-15'][gender], ...era.under13[gender]]));
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
 * category must be a division the clients offer (`isRankingDivision`) or
 * have results under that federation (an older spelling such as `Open Men's
 * 85 kg`). An offered division of USAW or USAMW costs no read; anything else
 * one or two.
 */
export async function requireKnownRankingClass(ctx: QueryCtx, federation: string, ageCategory: string): Promise<void> {
  if (!RANKING_FEDERATIONS.has(federation)) {
    const anyInFederation = await ctx.db
      .query('lifting_results')
      .withIndex('by_federation_age_and_date', (q) => q.eq('federation', federation))
      .first();
    if (anyInFederation === null) throw apiError(404, `unknown federation '${federation}'`);
  }
  if (isRankingDivision(ageCategory)) return;
  const anyInClass = await ctx.db
    .query('lifting_results')
    .withIndex('by_federation_age_and_date', (q) => q.eq('federation', federation).eq('age', ageCategory))
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

/** `GET /data/wso/`: the WSOs with stored records that a job keeps current (`MAINTAINED_WSOS`). */
export async function computeWsoList(ctx: QueryCtx): Promise<string[]> {
  const rows = await readAll(ctx.db.query('wso_records'), WSO_RECORDS_MAX, 'WSO records');
  return distinctCollated(rows.map((r) => r.wso).filter(isMaintainedWso));
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

export const isWsoRecordRow = (item: unknown): item is WsoRecordRow =>
  isRecord(item) && typeof item.wso === 'string' && typeof item.age_category === 'string' && typeof item.gender === 'string' && typeof item.weight_class === 'string';

/**
 * `GET /data/wso/records` for a whole WSO, in the route's order (gender, age,
 * class, insertion; then weight class). Narrowing by age or gender filters
 * this list, which keeps its order.
 */
export async function computeWsoRows(ctx: QueryCtx, wso: string): Promise<WsoRecordRow[]> {
  // A WSO no job maintains has no records to offer (`MAINTAINED_WSOS`).
  if (!isMaintainedWso(wso)) return [];
  const rows = (
    await readAll(
      ctx.db
        .query('wso_records')
        .withIndex('by_wso', (q) => q.eq('wso', wso)),
      WSO_RECORDS_MAX,
      'WSO records',
    )
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
  return narrowedByAgeAndGender(rows, { ageCategory, gender });
}

export function wsoAgeGroups(rows: WsoRecordRow[]): string[] {
  return distinctCollated(rows.map((r) => r.age_category));
}

// ---------------------------------------------------------------------------
// `GET /data/adaptive`
// ---------------------------------------------------------------------------

export const ADAPTIVE_RECORDS_SEASON_START = '2026';

const MEN = genderWordPattern('Men', 'label');
const WOMEN = genderWordPattern('Women', 'label');

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

export type AdaptiveRecord = { weight_class: string; snatch: number; cj: number; total: number };

/** The season's best lifts per weight class. */
export async function computeAdaptiveRecords(
  ctx: QueryCtx,
  gender: AdaptiveGender,
  excludeFederation: string,
  season: string,
): Promise<AdaptiveRecord[]> {
  // The season's results only: every adaptive result ever grows each year.
  const rows = await readAll(
    ctx.db
      .query('lifting_results')
      .withIndex('by_adaptive_and_date', (q) => q.eq('adaptive', true).gte('date', `${season}-01-01`)),
    ADAPTIVE_SEASON_RESULTS_MAX,
    'adaptive results in one season',
  );

  const byClass = new Map<string, AdaptiveRecord>();
  for (const row of rows) {
    if (row.federation !== undefined && row.federation === excludeFederation) continue;
    const age = row.age ?? '';
    if (!matchesGender(age, gender)) continue;
    const weightClass = classNamedIn(age, 'firstOutsideParentheses');
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
