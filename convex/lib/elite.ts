import { type Gender, MAX_LEADERBOARD_YEARS, parseDivision, plausible, qpoints, type RankedFields, sinclair } from './leaderboard';
import { normalizeName } from './names';
import { normalizeGender } from './normalize';
import { compareBytes } from './sort';
import { apiError, isValidIsoDate, requireNonEmpty } from './validation';

/**
 * A WSO's elite lists (`results:wsoElite`): the WSO's top men and women
 * Overall and in each age group (Youth, Junior, Senior, Masters), each list
 * scored the way the WSO's elite program asks.
 *
 * - An athlete is the WSO's when their most recent registration naming a
 *   WSO names it (`latestRegistration`); every USAW result of theirs in the range counts,
 *   adaptive included, at any meet.
 * - A result's age group is the athlete's weightlifting age in the result's
 *   year (the year less their birth year, as USAW counts it): Youth up to 17,
 *   Junior 18 to 20, Senior 21 to 34, Masters 35 and over.
 * - Each list is scored by its own method (`EliteMethods`), and holds each
 *   athlete once, by their best-scoring result: highest first, ties to the
 *   earlier result, then the name.
 */

export type EliteGroup = 'youth' | 'junior' | 'senior' | 'masters';
export type EliteList = 'overall' | EliteGroup;
export type EliteMethod = 'percentA' | 'qpoints' | 'qmasters' | 'sinclair';
export type EliteMethods = Record<EliteList, EliteMethod>;

export const ELITE_LISTS: readonly EliteList[] = ['overall', 'youth', 'junior', 'senior', 'masters'];

/**
 * What each list may be scored by, its default first. Overall's `qpoints`
 * scores Juniors and Seniors by Q-points and Masters by Q-masters, and leaves
 * Youth out (Q-points do not score youth); its `percentA` scores Masters
 * against the Senior A standard, as there is no Masters one.
 */
export const ELITE_METHOD_CHOICES: Readonly<Record<EliteList, readonly EliteMethod[]>> = {
  overall: ['percentA', 'sinclair', 'qpoints'],
  youth: ['percentA', 'sinclair'],
  junior: ['percentA', 'qpoints', 'sinclair'],
  senior: ['percentA', 'qpoints', 'sinclair'],
  masters: ['qmasters', 'percentA', 'sinclair'],
};

/** Athletes per gender in each list. */
export const ELITE_LIST_SIZE = 20;

/** The oldest Youth and Junior, and the youngest Master (weightlifting age). */
export const YOUTH_MAX_AGE = 17;
export const JUNIOR_MAX_AGE = 20;
export const MASTERS_MIN_AGE = 35;
/** Ages outside this range are a registration's error: the result is in no group. */
export const PLAUSIBLE_AGE = { min: 5, max: 100 } as const;

/** The age group of a weightlifting age, or null for an implausible one. */
export function groupOfAge(age: number): EliteGroup | null {
  if (!Number.isInteger(age) || age < PLAUSIBLE_AGE.min || age > PLAUSIBLE_AGE.max) return null;
  if (age <= YOUTH_MAX_AGE) return 'youth';
  if (age <= JUNIOR_MAX_AGE) return 'junior';
  if (age < MASTERS_MIN_AGE) return 'senior';
  return 'masters';
}

// ---------------------------------------------------------------------------
// Q-masters
// ---------------------------------------------------------------------------

/**
 * Huebner's Masters age factors (2025), from age 30: index 0 is 30
 * (`Agefactors2025.docx`, https://osf.io/8x3nb/). Women's run to 90 and
 * men's to 95; an older athlete gets the last factor.
 */
export const AGE_FACTORS_FIRST_AGE = 30;
export const AGE_FACTORS_WOMEN = [
  1.0, 1.01, 1.021, 1.031, 1.042, 1.052, 1.063, 1.073, 1.084, 1.096, 1.108, 1.122, 1.138, 1.155, 1.173, 1.194, 1.216, 1.24, 1.265, 1.292, 1.321, 1.352,
  1.384, 1.419, 1.456, 1.494, 1.534, 1.575, 1.617, 1.66, 1.704, 1.748, 1.794, 1.841, 1.89, 1.942, 1.996, 2.052, 2.109, 2.168, 2.226, 2.285, 2.343, 2.402,
  2.464, 2.528, 2.597, 2.67, 2.749, 2.831, 2.918, 3.009, 3.104, 3.201, 3.301, 3.403, 3.507, 3.613, 3.72, 3.827, 3.935,
] as const;
export const AGE_FACTORS_MEN = [
  1.0, 1.01, 1.018, 1.026, 1.038, 1.052, 1.064, 1.076, 1.088, 1.1, 1.112, 1.124, 1.136, 1.148, 1.16, 1.173, 1.187, 1.201, 1.215, 1.23, 1.247, 1.264,
  1.283, 1.304, 1.327, 1.351, 1.376, 1.401, 1.425, 1.451, 1.477, 1.504, 1.531, 1.56, 1.589, 1.62, 1.654, 1.693, 1.736, 1.784, 1.833, 1.883, 1.932, 1.981,
  2.031, 2.083, 2.139, 2.202, 2.271, 2.348, 2.43, 2.524, 2.635, 2.755, 2.877, 3.008, 3.168, 3.356, 3.545, 3.709, 3.88, 4.059, 4.247, 4.443, 4.648, 4.863,
] as const;

/** The age factor at `age`: 1 below 30, the last one past the table's end. */
export function ageFactor(age: number, gender: Gender): number {
  const factors = gender === 'Men' ? AGE_FACTORS_MEN : AGE_FACTORS_WOMEN;
  if (age < AGE_FACTORS_FIRST_AGE) return 1;
  return factors[Math.min(age - AGE_FACTORS_FIRST_AGE, factors.length - 1)];
}

/** A total's Q-masters: its Q-points times the age factor; null where Q-points are. */
export function qmasters(total: number, bodyWeight: number, gender: Gender, age: number): number | null {
  const points = qpoints(total, bodyWeight, gender);
  return points === null ? null : points * ageFactor(age, gender);
}

// ---------------------------------------------------------------------------
// A standards
// ---------------------------------------------------------------------------

/** A stored A standard (`standards`), as the action reads it. */
export type EliteStandard = { ageCategory: string; gender: string; weightClass: string; standardA: number };

/** The standards category a group is held to: Masters to Senior's. */
const STANDARD_CATEGORY: Record<EliteGroup, string> = { youth: 'Youth', junior: 'Junior', senior: 'Senior', masters: 'Senior' };

/** A class's upper limit (kg) and whether it is the open-ended top class (`+86kg`, `86+kg`); null for neither. */
export function classLimit(weightClass: string): { limit: number; open: boolean } | null {
  const match = /^\s*(\+)?\s*(\d+(?:\.\d+)?)\s*(\+)?\s*(?:kg)?\s*$/i.exec(weightClass);
  if (!match) return null;
  return { limit: Number(match[2]), open: match[1] !== undefined || match[3] !== undefined };
}

/** One category and gender's classes, lightest first, the open class last. */
type ClassTable = { limit: number; open: boolean; weightClass: string; standardA: number }[];

/** The standards by `category|gender`, each table lightest first. */
export function standardTables(standards: readonly EliteStandard[]): Map<string, ClassTable> {
  const tables = new Map<string, ClassTable>();
  for (const standard of standards) {
    const parsed = classLimit(standard.weightClass);
    if (!parsed || !(standard.standardA > 0)) continue;
    const key = `${standard.ageCategory}|${normalizeGender(standard.gender)}`;
    const table = tables.get(key) ?? [];
    table.push({ ...parsed, weightClass: standard.weightClass, standardA: standard.standardA });
    tables.set(key, table);
  }
  for (const table of tables.values()) table.sort((a, b) => Number(a.open) - Number(b.open) || a.limit - b.limit);
  return tables;
}

/**
 * The A standard a result is held to: its group's category, in the class
 * today's classes put its bodyweight in (the lightest whose limit it is
 * within, else the open class). Null without a table or a class.
 */
export function standardFor(tables: ReadonlyMap<string, ClassTable>, group: EliteGroup, gender: Gender, bodyWeight: number) {
  const table = tables.get(`${STANDARD_CATEGORY[group]}|${gender}`);
  if (!table || !(bodyWeight > 0)) return null;
  const closed = table.find((row) => !row.open && bodyWeight <= row.limit);
  const chosen = closed ?? table.find((row) => row.open && bodyWeight > row.limit) ?? null;
  return chosen && { weightClass: chosen.weightClass, standardA: chosen.standardA };
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

/** One registration (`athletes`), with its meet's name and start date ('' when the meet is not stored). */
export type EliteRegistration = { name: string; wso: string; gender: string; age: number; meet: string; meetDate: string; created: number };

/** A member as the lists read them: their WSO, name, gender and birth year from their registrations. */
export type EliteMember = { name: string; wso: string; gender: Gender | null; birthYear: number | null };

/** A registration's gender, or null for anything but men's and women's. */
export function registrationGender(value: string): Gender | null {
  const lower = value.trim().toLowerCase();
  if (['women', 'woman', 'female', 'f', 'w'].includes(lower)) return 'Women';
  if (['men', 'man', 'male', 'm'].includes(lower)) return 'Men';
  return null;
}

/** Whether `next` is a more recent registration than `current`: a later meet start date, then written later. */
const newer = (next: EliteRegistration, current: EliteRegistration | null) =>
  current === null || next.meetDate > current.meetDate || (next.meetDate === current.meetDate && next.created > current.created);

/** A registration's meet year: its start date's, else the year its name gives; NaN for neither. */
const meetYear = (registration: EliteRegistration) =>
  registration.meetDate !== '' ? Number(registration.meetDate.slice(0, 4)) : Number(/\b(?:19|20)\d{2}\b/.exec(registration.meet)?.[0] ?? NaN);

/**
 * A member from their registrations, by the most recent of each kind (the
 * latest meet start date, then the latest written; a registration whose meet
 * is not stored counts as oldest): the WSO of the latest that names one (an
 * entries row may name none, as the entries sync fills it from the member's
 * other rows), the name and gender of the latest, and the birth year of the
 * latest that gives an age (a missing age is stored as 0): its meet's year
 * less that weightlifting age.
 */
export function latestRegistration(registrations: readonly EliteRegistration[]): EliteMember | null {
  let latest: EliteRegistration | null = null;
  let named: EliteRegistration | null = null;
  let aged: EliteRegistration | null = null;
  for (const registration of registrations) {
    if (newer(registration, latest)) latest = registration;
    if (registration.wso.trim() !== '' && newer(registration, named)) named = registration;
    if (Number.isInteger(registration.age) && registration.age > 0 && Number.isInteger(meetYear(registration)) && newer(registration, aged)) {
      aged = registration;
    }
  }
  if (latest === null) return null;
  const birthYear = aged === null ? null : meetYear(aged) - aged.age;
  return { name: latest.name, wso: named?.wso ?? '', gender: registrationGender(latest.gender), birthYear };
}

/** Whether a member's latest registration naming a WSO is under `wso` (case and spacing ignored). */
export const isMemberOf = (member: EliteMember, wso: string) => normalizeName(member.wso) === normalizeName(wso);

// ---------------------------------------------------------------------------
// Scoring and ranking
// ---------------------------------------------------------------------------

/** A result scored for one list. */
export type EliteRow = {
  name: string;
  date: string;
  meet: string;
  /** The division. */
  division: string;
  gender: Gender;
  group: EliteGroup;
  /** Weightlifting age in the result's year. */
  age: number;
  body_weight: number;
  snatch_best: number;
  cj_best: number;
  total: number;
  /** What the list ranks by: a percentage for `percentA`. */
  score: number;
  /** The class and A standard a `percentA` score is against; null otherwise. */
  weight_class: string | null;
  standard_a: number | null;
};

export type EliteListAnswer = { method: EliteMethod; men: EliteRow[]; women: EliteRow[] };

/** One list ranked by one method. */
export type EliteRanking = { men: EliteRow[]; women: EliteRow[] };

export type EliteAnswer = {
  wso: string;
  from: string;
  to: string;
  /** Athletes whose latest registration is under the WSO. */
  members: number;
  lists: Record<EliteList, EliteListAnswer>;
  /**
   * Every list ranked by every method it offers (`ELITE_METHOD_CHOICES`), so
   * a page can switch a list's method without asking again.
   */
  rankings: Record<EliteList, Partial<Record<EliteMethod, EliteRanking>>>;
};

/** A result of a member's, with what its scores need. */
export type MemberResult = { row: RankedFields; member: EliteMember };

/** What a result scores by `method` in `list`, or null when it scores nothing there. */
export function scoreResult(
  { row, member }: MemberResult,
  list: EliteList,
  method: EliteMethod,
  tables: ReadonlyMap<string, ClassTable>,
): EliteRow | null {
  if (row.federation !== 'USAW' || !plausible(row) || !(row.total > 0)) return null;
  if (member.birthYear === null) return null;
  const age = Number(row.date.slice(0, 4)) - member.birthYear;
  const group = groupOfAge(age);
  if (group === null || (list !== 'overall' && list !== group)) return null;
  const gender = parseDivision(row.age).gender ?? member.gender;
  if (gender === null) return null;

  let score: number | null = null;
  let standard: { weightClass: string; standardA: number } | null = null;
  switch (method) {
    case 'percentA':
      standard = standardFor(tables, group, gender, row.body_weight);
      score = standard && (row.total / standard.standardA) * 100;
      break;
    case 'sinclair':
      score = sinclair(row.total, row.body_weight, gender);
      break;
    case 'qpoints':
      if (group === 'youth') return null;
      score = group === 'masters' ? qmasters(row.total, row.body_weight, gender, age) : qpoints(row.total, row.body_weight, gender);
      break;
    case 'qmasters':
      score = qmasters(row.total, row.body_weight, gender, age);
      break;
  }
  if (score === null || !(score > 0)) return null;
  return {
    name: member.name,
    date: row.date,
    meet: row.meet,
    division: row.age,
    gender,
    group,
    age,
    body_weight: row.body_weight,
    snatch_best: row.snatch_best,
    cj_best: row.cj_best,
    total: row.total,
    score,
    weight_class: standard?.weightClass ?? null,
    standard_a: standard?.standardA ?? null,
  };
}

/** Whether `next` replaces `current` as an athlete's best: higher, or as high and earlier. */
const beats = (next: EliteRow, current: EliteRow) => next.score > current.score || (next.score === current.score && next.date < current.date);

/** One list: each member once (by `memberKey`) by their best result, best first, `size` per gender. */
export function rankList(
  results: readonly (MemberResult & { memberKey: string })[],
  list: EliteList,
  method: EliteMethod,
  tables: ReadonlyMap<string, ClassTable>,
  size = ELITE_LIST_SIZE,
): EliteListAnswer {
  const best = { Men: new Map<string, EliteRow>(), Women: new Map<string, EliteRow>() };
  for (const result of results) {
    const row = scoreResult(result, list, method, tables);
    if (row === null) continue;
    const current = best[row.gender].get(result.memberKey);
    if (current === undefined || beats(row, current)) best[row.gender].set(result.memberKey, row);
  }
  const ranked = (rows: Map<string, EliteRow>) =>
    [...rows.values()].sort((a, b) => b.score - a.score || compareBytes(a.date, b.date) || compareBytes(a.name, b.name)).slice(0, size);
  return { method, men: ranked(best.Men), women: ranked(best.Women) };
}

/** Every list by its asked method (`lists`), and by each method it offers (`rankings`). */
export function rankAll(
  results: readonly (MemberResult & { memberKey: string })[],
  methods: EliteMethods,
  tables: ReadonlyMap<string, ClassTable>,
): Pick<EliteAnswer, 'lists' | 'rankings'> {
  const lists = {} as EliteAnswer['lists'];
  const rankings = {} as EliteAnswer['rankings'];
  for (const list of ELITE_LISTS) {
    rankings[list] = {};
    for (const method of ELITE_METHOD_CHOICES[list]) {
      const { men, women } = rankList(results, list, method, tables);
      rankings[list][method] = { men, women };
    }
    const asked = rankings[list][methods[list]]!;
    lists[list] = { method: methods[list], men: asked.men, women: asked.women };
  }
  return { lists, rankings };
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

export type EliteArgs = { wso: string; from: string; to: string; methods?: Partial<Record<EliteList, string>> };
export type CheckedEliteArgs = { wso: string; from: string; to: string; methods: EliteMethods };

const plusYears = (date: string, years: number) => `${String(Number(date.slice(0, 4)) + years).padStart(4, '0')}${date.slice(4)}`;

/** The arguments checked, each list's method defaulted: 400 for a blank WSO, a bad range, or a method a list does not offer. */
export function checkEliteArgs(args: EliteArgs): CheckedEliteArgs {
  const wso = requireNonEmpty('wso', args.wso).trim();
  if (!isValidIsoDate(args.from)) throw apiError(400, 'from must be a valid YYYY-MM-DD date');
  if (!isValidIsoDate(args.to)) throw apiError(400, 'to must be a valid YYYY-MM-DD date');
  if (args.to < args.from) throw apiError(400, 'to must not be before from');
  if (args.to >= plusYears(args.from, MAX_LEADERBOARD_YEARS)) {
    throw apiError(400, `elite lists cover at most ${MAX_LEADERBOARD_YEARS} years: narrow the range`);
  }
  const methods = {} as EliteMethods;
  for (const list of ELITE_LISTS) {
    const choices = ELITE_METHOD_CHOICES[list];
    const asked = args.methods?.[list];
    if (asked !== undefined && !(choices as readonly string[]).includes(asked)) {
      throw apiError(400, `${list} can be scored by ${choices.join(', ')}, not "${asked}"`);
    }
    methods[list] = (asked as EliteMethod | undefined) ?? choices[0];
  }
  return { wso, from: args.from, to: args.to, methods };
}
