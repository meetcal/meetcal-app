import { Platform } from 'react-native';
import { LiftResult } from '@/data/types/athletes';
import { lowerNameMatchesSearchWords, searchWords } from '@/lib/name-search';
import type { YearBests } from '@/lib/start-list-api';
import type { Schedule } from '@/types/schedule';
import type { SessionDetails } from '@/types/start-list';
import { meetCalendarDateAnchor } from '@/utils/dateTime';

const WEIGHT_CLASS_NAN_SENTINEL = Infinity;

export function sortWeightClasses(a: string, b: string): number {
  const aNum = parseInt(a.replace(/[^\d]/g, ''), 10);
  const bNum = parseInt(b.replace(/[^\d]/g, ''), 10);
  const aSafe = Number.isNaN(aNum) ? WEIGHT_CLASS_NAN_SENTINEL : aNum;
  const bSafe = Number.isNaN(bNum) ? WEIGHT_CLASS_NAN_SENTINEL : bNum;
  if (aSafe !== bSafe) return aSafe - bSafe;
  const aHasPlus = a.includes('+');
  const bHasPlus = b.includes('+');
  if (aHasPlus && !bHasPlus) return 1;
  if (!aHasPlus && bHasPlus) return -1;
  return 0;
}

export function sortAthletes(a: LiftResult, b: LiftResult): number {
  return a.name.localeCompare(b.name);
}

const TIME_24H_REGEX = /^(\d{1,2}):(\d{2})$/;
const TIME_12H_REGEX = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i;

export function parseStartTimeToMinutes(startTime: string): number | null {
  const trimmed = startTime.trim();
  const match12 = trimmed.match(TIME_12H_REGEX);
  if (match12) {
    const hours = Number(match12[1]);
    const minutes = Number(match12[2]);
    const period = match12[3].toUpperCase();
    if (
      Number.isNaN(hours) ||
      Number.isNaN(minutes) ||
      hours < 1 ||
      hours > 12 ||
      minutes < 0 ||
      minutes > 59
    ) {
      return null;
    }
    let hour24 = hours % 12;
    if (period === "PM") hour24 += 12;
    return hour24 * 60 + minutes;
  }

  const match24 = trimmed.match(TIME_24H_REGEX);
  if (match24) {
    const hours = Number(match24[1]);
    const minutes = Number(match24[2]);
    if (
      Number.isNaN(hours) ||
      Number.isNaN(minutes) ||
      hours < 0 ||
      hours > 23 ||
      minutes < 0 ||
      minutes > 59
    ) {
      return null;
    }
    return hours * 60 + minutes;
  }

  return null;
}

export function compareStartTimes(a: string, b: string): number {
  const aMinutes = parseStartTimeToMinutes(a);
  const bMinutes = parseStartTimeToMinutes(b);
  if (aMinutes != null && bMinutes != null) return aMinutes - bMinutes;
  if (aMinutes != null) return -1;
  if (bMinutes != null) return 1;
  return a.localeCompare(b);
}

/**
 * Order two meet calendar dates (`Schedule[n].fullDate`, an ISO `YYYY-MM-DD`
 * from the API).
 *
 * The CSV export and the shareable schedule image each sorted these with
 * `new Date(a.date).getTime() - new Date(b.date).getTime()` — the same policy
 * written twice (PoT #9), allocating two `Date`s per comparison, and returning
 * `NaN` for any date the API sends in a shape `Date` cannot parse, which makes
 * the comparator inconsistent and the resulting order arbitrary.
 *
 * ISO calendar dates sort correctly as plain strings, which is also what
 * TigerStyle "explicit vs implicit" asks for: a calendar date is not an
 * instant, so it should never be routed through `Date` just to be compared.
 */
export function compareCalendarDates(a: string, b: string): number {
  return a.localeCompare(b);
}

// Re-export from utils/calendar for backwards compatibility
export { requestCalendarPermissions } from '@/utils/calendar';

export const STARRED_CLUBS_FILTER = 'Favorites';

export function getChevronIcon(direction: 'down' | 'right'): string {
  return Platform.select({
    ios: `chevron.${direction}`,
    android: direction === 'right' ? 'chevron-forward' : 'chevron-down'
  }) || `chevron.${direction}`;
}

export function getSaveIcon(): string {
  return Platform.select({
    ios: "square.and.arrow.down",
    android: "download"
  }) || "square.and.arrow.down";
}

export function getCloseIcon(): string {
  return Platform.select({
    ios: "xmark",
    android: "close"
  }) || "xmark";
}

export function formatSessionDisplayDate(
  displayDate?: string,
  fullDate?: string,
  timeZoneId?: string
): string {
  if (!displayDate && !fullDate) return '';
  const normalized = displayDate?.toLowerCase();
  if (normalized === 'today' || normalized === 'tomorrow') return displayDate || '';
  const anchor = meetCalendarDateAnchor(fullDate);
  if (anchor) {
    return anchor.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      // `meetDetails` can still be loading (or be missing offline), so the
      // timezone is optional. Falling back to the *device* timezone would
      // read the UTC-noon anchor a day early/late depending on the offset;
      // UTC reads back the calendar date we put in.
      timeZone: timeZoneId || 'UTC'
    });
  }
  // Not a `YYYY-MM-DD` calendar date: shown as sent, like the schedule
  // mapper's day titles. This used to fall back to `new Date(source)`, which
  // parses text such as the mapped day title "January 15, 2026" as *device*
  // midnight; read back in UTC that is "Wed, Jan 14" on any device east of
  // Greenwich.
  return displayDate || fullDate || '';
}

/**
 * `calculateWeighInTime` deliberately does NOT live here.
 *
 * This module used to carry a line-by-line second copy of `utils/time.ts`'s
 * version — same two-hour lead, same midnight wrap, same 12-hour conversion —
 * differing only in that it rejected 24-hour start times and returned `null`
 * instead of `""`. One weigh-in policy, one implementation: import
 * `calculateWeighInTime` from `@/utils/time`, where `WEIGH_IN_LEAD_HOURS` is
 * declared and the parser also accepts the `HH:MM[:SS]` form the API can
 * return.
 */

export function getAgeCategory(age: number): string {
  if (!Number.isFinite(age) || age <= 0) return 'Unknown';
  if (age <= 13) return 'U13';
  if (age >= 14 && age <= 15) return 'U15';
  if (age >= 16 && age <= 17) return 'U17';
  if (age >= 18 && age <= 20) return 'Junior';
  if (age >= 21 && age <= 34) return 'Senior';
  if (age >= 90) return 'Masters 90+';
  const mastersStart = Math.floor((age - 35) / 5) * 5 + 35;
  return `Masters ${mastersStart}`;
}

/**
 * The weight classes in an athlete's `weightClass` field, normalized to
 * `NNkg` / `NN+kg`. Start lists write the unlimited class both ways round
 * (`110+` and `+110`); both normalize to `110+kg`, so one option matches
 * either. Anything else (an adaptive "K44", free text) is dropped.
 */
export function parseWeightClasses(weightClass: string): string[] {
  if (!weightClass) return [];
  const classes = weightClass.split(' / ');
  const weightClasses = new Set<string>();
  classes.forEach(classStr => {
    const trimmedClass = classStr.trim();
    const match = trimmedClass.match(/^(\+)?(\d+)(\+)?\s*(?:kg)?$/i);
    if (match && match[2]) {
      const plus = match[1] || match[3] ? '+' : '';
      weightClasses.add(`${match[2]}${plus}kg`);
    }
  });
  return Array.from(weightClasses);
}

export type AthleteSortOption =
  | 'alphabetical'
  | 'entryTotal'
  | 'bestTotal'
  | 'bestSnatch'
  | 'bestCJ';

export const ATHLETE_SORT_OPTIONS: readonly { value: AthleteSortOption; label: string }[] = [
  { value: 'alphabetical', label: 'A-Z' },
  { value: 'entryTotal', label: 'Entry Total' },
  { value: 'bestTotal', label: 'Best Total' },
  { value: 'bestSnatch', label: 'Best Sn' },
  { value: 'bestCJ', label: 'Best CJ' },
];

export function isAthleteSortOption(value: string): value is AthleteSortOption {
  return ATHLETE_SORT_OPTIONS.some((option) => option.value === value);
}

/** The sorts that order athletes by their bests from the last year. */
export function isBestLiftSort(sort: string): boolean {
  return sort === 'bestTotal' || sort === 'bestSnatch' || sort === 'bestCJ';
}

/**
 * Whether picking `value` in pill `id` needs a subscription.
 *
 * Best-lift sorts are premium, as they are in session details: the bests
 * themselves are premium everywhere (the row's "Bests From The Last Year",
 * session details' bests), and a free sort by them would expose the ranking
 * the paywall sells. Entry Total and A-Z stay free.
 */
export function isPremiumStartListPill(id: string, value: string): boolean {
  return id === 'sort' && isBestLiftSort(value);
}

/**
 * The sort the list actually applies. A best-lift sort picked while
 * subscribed falls back to A-Z whenever `isSubscribed` is not `true` (the
 * subscription lapsed, or its status is not known yet), instead of showing
 * a premium order.
 */
export function effectiveStartListSort(
  sort: AthleteSortOption,
  isSubscribed: boolean | null,
): AthleteSortOption {
  return isBestLiftSort(sort) && isSubscribed !== true ? 'alphabetical' : sort;
}

/** Everything the Start List's search box and filter pills hold. */
export interface StartListFilters {
  weightClass: string;
  club: string;
  ageGroup: string;
  adaptive: string;
  gender: string;
  wso: string;
  sort: AthleteSortOption;
  search: string;
}

export const DEFAULT_START_LIST_FILTERS: Readonly<StartListFilters> = Object.freeze({
  weightClass: '',
  club: '',
  ageGroup: '',
  adaptive: '',
  gender: '',
  wso: '',
  sort: 'alphabetical',
  search: '',
});

/** Whether any pill (not the search box) differs from its default. */
export function hasActiveStartListFilters(filters: StartListFilters): boolean {
  return Boolean(
    filters.weightClass ||
      filters.club ||
      filters.ageGroup ||
      filters.adaptive ||
      filters.gender ||
      filters.wso ||
      filters.sort !== 'alphabetical',
  );
}

/**
 * The filters after picking `value` in pill `id` ("" is the pill's "all"
 * option). Gender, age group and adaptive change which weight classes are on
 * offer, so picking one of them clears the weight class.
 */
export function applyStartListPillSelection(
  filters: StartListFilters,
  id: string,
  value: string,
): StartListFilters {
  switch (id) {
    case 'sort':
      return { ...filters, sort: isAthleteSortOption(value) ? value : 'alphabetical' };
    case 'gender':
      return { ...filters, gender: value, weightClass: '' };
    case 'ageGroup':
      return { ...filters, ageGroup: value, weightClass: '' };
    case 'adaptiveAthlete':
      return { ...filters, adaptive: value, weightClass: '' };
    case 'weightClass':
      return { ...filters, weightClass: value };
    case 'wso':
      return { ...filters, wso: value };
    default:
      return filters;
  }
}

export const ADAPTIVE_ATHLETES_FILTER = 'Adaptive Athletes';
export const NON_ADAPTIVE_ATHLETES_FILTER = 'Non-Adaptive Athletes';

/** Whether an athlete passes the Adaptive pill ("" lets everyone through). */
export function matchesAdaptiveFilter(
  athlete: Pick<LiftResult, 'adaptive'>,
  adaptiveFilter: string,
): boolean {
  if (adaptiveFilter === ADAPTIVE_ATHLETES_FILTER) return athlete.adaptive === true;
  if (adaptiveFilter === NON_ADAPTIVE_ATHLETES_FILTER) return athlete.adaptive === false;
  return true;
}

export interface WeightClassOptionFilters {
  gender: string;
  ageGroup: string;
  adaptive: string;
}

/**
 * The Weight Class pill's options: every class the athletes still in view
 * (after the gender, age-group and adaptive pills) are entered in, lightest
 * first, exactly as the filter matches them.
 *
 * This used to relabel the heaviest class present per gender as a "+" class
 * and drop the real one. Whenever nobody was in the unlimited class (a WSO or
 * local meet, or any age-group filter) the menu offered "110+", which matched
 * nobody, and no "110", so those lifters could not be filtered at all. A "+"
 * option now appears only when the data has a "+" class.
 */
export function buildWeightClassOptions(
  athletes: readonly LiftResult[],
  filters: WeightClassOptionFilters,
): string[] {
  const gender = filters.gender.toLowerCase();
  const weightClasses = new Set<string>();
  for (const athlete of athletes) {
    if (gender && athlete.gender.toLowerCase() !== gender) continue;
    if (filters.ageGroup && getAgeCategory(athlete.age) !== filters.ageGroup) continue;
    if (!matchesAdaptiveFilter(athlete, filters.adaptive)) continue;
    for (const weightClass of parseWeightClasses(athlete.weightClass)) {
      weightClasses.add(weightClass);
    }
  }
  return Array.from(weightClasses).sort(sortWeightClasses);
}

export const AGE_GROUP_OPTIONS: readonly string[] = [
  'U13',
  'U15',
  'U17',
  'Junior',
  'Senior',
  'Masters 35',
  'Masters 40',
  'Masters 45',
  'Masters 50',
  'Masters 55',
  'Masters 60',
  'Masters 65',
  'Masters 70',
  'Masters 75',
  'Masters 80',
  'Masters 85',
  'Masters 90+',
];

/** The Age Group pill's options: the age groups present, youngest first. */
export function buildAgeGroupOptions(athletes: readonly LiftResult[]): string[] {
  const present = new Set(athletes.map((athlete) => getAgeCategory(athlete.age)));
  return AGE_GROUP_OPTIONS.filter((ageGroup) => present.has(ageGroup));
}

/** The WSO pill's options: the athletes' WSOs, trimmed, deduplicated, A-Z. */
export function buildWsoOptions(athletes: readonly LiftResult[]): string[] {
  return Array.from(
    new Set(
      athletes
        .map((athlete) => athlete.wso?.trim())
        .filter((wso): wso is string => Boolean(wso)),
    ),
  ).sort((a, b) => a.localeCompare(b));
}

/** Per-athlete values the filters compare against, derived once per roster. */
export interface NormalizedStartListAthlete {
  athlete: LiftResult;
  weightClasses: string[];
  ageCategory: string;
  nameLower: string;
  genderLower: string;
  wso: string;
}

/**
 * Parses each athlete's filter fields once per roster, so a pill change or a
 * keystroke in the search box re-runs only the comparisons.
 */
export function normalizeStartListAthletes(
  athletes: readonly LiftResult[],
): NormalizedStartListAthlete[] {
  return athletes.map((athlete) => ({
    athlete,
    weightClasses: parseWeightClasses(athlete.weightClass),
    ageCategory: getAgeCategory(athlete.age),
    nameLower: athlete.name.toLowerCase(),
    genderLower: athlete.gender.toLowerCase(),
    wso: athlete.wso?.trim() || '',
  }));
}

/** The athletes that pass every pill and the search box, in roster order. */
export function filterStartListAthletes(
  normalized: readonly NormalizedStartListAthlete[],
  filters: StartListFilters,
  starredClubs: readonly string[],
): LiftResult[] {
  const words = searchWords(filters.search);
  const gender = filters.gender.toLowerCase();
  const result: LiftResult[] = [];
  for (const { athlete, nameLower, weightClasses, ageCategory, genderLower, wso } of normalized) {
    if (filters.weightClass && !weightClasses.includes(filters.weightClass)) continue;
    if (filters.club) {
      const inClub =
        filters.club === STARRED_CLUBS_FILTER
          ? starredClubs.includes(athlete.club)
          : athlete.club === filters.club;
      if (!inClub) continue;
    }
    if (!lowerNameMatchesSearchWords(nameLower, words)) continue;
    if (filters.ageGroup && ageCategory !== filters.ageGroup) continue;
    if (!matchesAdaptiveFilter(athlete, filters.adaptive)) continue;
    if (gender && genderLower !== gender) continue;
    if (filters.wso && wso !== filters.wso) continue;
    result.push(athlete);
  }
  return result;
}

/**
 * The comparator for a Start List sort: highest first for the numeric sorts,
 * A-Z within ties. An athlete with no bests counts as 0, so sorts last.
 */
export function compareStartListAthletes(
  sort: AthleteSortOption,
  bestsByName: Readonly<Record<string, YearBests | undefined>>,
): (left: LiftResult, right: LiftResult) => number {
  if (sort === 'alphabetical') return sortAthletes;
  const valueOf = (athlete: LiftResult): number => {
    if (sort === 'entryTotal') return athlete.entryTotal || 0;
    const bests = bestsByName[athlete.name];
    if (sort === 'bestTotal') return bests?.bestTotal || 0;
    if (sort === 'bestSnatch') return bests?.bestSnatch || 0;
    return bests?.bestCJ || 0;
  };
  return (left, right) => {
    const difference = valueOf(right) - valueOf(left);
    return difference !== 0 ? difference : sortAthletes(left, right);
  };
}

/**
 * The group a shareable schedule (image or CSV) is made for: the picked club,
 * else the picked WSO, else "" (none; the share actions ask for one). The
 * Favorites filter is several clubs, so it is not a group.
 */
export function getShareGroup(filters: Pick<StartListFilters, 'club' | 'wso'>): string {
  if (filters.club && filters.club !== STARRED_CLUBS_FILTER) return filters.club;
  return filters.wso;
}

/** A session-number lookup over a meet schedule, built once per schedule. */
export function buildSessionDetailsLookup(
  schedule: Schedule,
): (sessionNumber: number) => SessionDetails | null {
  const index = new Map<number, SessionDetails>();
  for (const day of schedule) {
    for (const session of day.sessions) {
      index.set(session.number, {
        date: day.fullDate,
        startTime: session.startTime,
        weighInTime: session.weighInTime,
        displayDate: day.date,
        platforms: session.platforms,
      });
    }
  }
  return (sessionNumber) => index.get(sessionNumber) ?? null;
}
