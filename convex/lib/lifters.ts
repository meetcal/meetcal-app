import type { Infer } from 'convex/values';
import type { Doc } from '../_generated/dataModel';
import type { lifterMatch } from '../schema';
import { daysBetween } from './dates';
import { mastersAges, parseDivision } from './leaderboard';
import { normalizeName } from './names';
import { isDatedResult } from './results';

export type LifterMatch = Infer<typeof lifterMatch>;

export const SOURCE_DATE_TOLERANCE_DAYS = 7;
export const SAME_MEET_TOLERANCE_DAYS = 45;
export const BIRTH_YEAR_TOLERANCE = 1;

export type Sighting = {
  athleteId: string;
  name: string;
  gender: string | null;
  birthYear: number | null;
  club: string | null;
  wso: string | null;
  date: string;
};

export type LifterFields = Omit<Doc<'lifters'>, '_id' | '_creationTime'>;

function newerOrSame(date: string, than: string | undefined): boolean {
  return than === undefined || date >= than;
}

export function mergeSighting(stored: LifterFields | null, sighting: Sighting): LifterFields {
  const base: LifterFields = stored ?? { athleteId: sighting.athleteId, name: sighting.name, nameKey: normalizeName(sighting.name), seenAt: sighting.date };
  const latest = newerOrSame(sighting.date, stored?.seenAt);
  const merged: LifterFields = { ...base };
  if (latest) {
    merged.name = sighting.name;
    merged.nameKey = normalizeName(sighting.name);
    merged.seenAt = sighting.date;
    if (sighting.gender !== null) merged.gender = sighting.gender;
    if (sighting.birthYear !== null) merged.birthYear = sighting.birthYear;
  } else {
    if (merged.gender === undefined && sighting.gender !== null) merged.gender = sighting.gender;
    if (merged.birthYear === undefined && sighting.birthYear !== null) merged.birthYear = sighting.birthYear;
  }
  if (sighting.club !== null && newerOrSame(sighting.date, merged.clubSeenAt)) {
    merged.club = sighting.club;
    merged.clubSeenAt = sighting.date;
  }
  if (sighting.wso !== null && newerOrSame(sighting.date, merged.wsoSeenAt)) {
    merged.wso = sighting.wso;
    merged.wsoSeenAt = sighting.date;
  }
  return merged;
}

type SightingWithMembership = Sighting & { membership: string | null };

function latestOf<T extends Sighting>(sightings: readonly T[], keep: (sighting: T) => boolean): T | null {
  let latest: T | null = null;
  for (const sighting of sightings) if (keep(sighting) && (latest === null || sighting.date >= latest.date)) latest = sighting;
  return latest;
}

export function condenseSightings<T extends SightingWithMembership>(sightings: readonly T[]): T[] {
  const byAthlete = new Map<string, T[]>();
  for (const sighting of sightings) byAthlete.set(sighting.athleteId, [...(byAthlete.get(sighting.athleteId) ?? []), sighting]);
  const kept: T[] = [];
  for (const list of byAthlete.values()) {
    const picks = new Set<T>();
    const add = (sighting: T | null) => {
      if (sighting !== null) picks.add(sighting);
    };
    add(latestOf(list, () => true));
    add(latestOf(list, (s) => s.gender !== null));
    add(latestOf(list, (s) => s.birthYear !== null));
    add(latestOf(list, (s) => s.club !== null));
    add(latestOf(list, (s) => s.wso !== null));
    for (const membership of new Set(list.map((s) => s.membership))) add(latestOf(list, (s) => s.membership === membership));
    kept.push(...picks);
  }
  return kept;
}

export function sameLifterFields(a: LifterFields, b: LifterFields): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof LifterFields)[]);
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

export type SourceResult = { date: string; meet: string; age: string; total: number; snatchBest: number; cjBest: number };

export type LinkableResult = Pick<Doc<'lifting_results'>, 'date' | 'meet' | 'age' | 'total' | 'snatchBest' | 'cjBest' | 'federation'>;

export const foldDivision = (division: string | undefined) => (division ?? '').toLowerCase().replace(/\s+/g, '');

function sameLiftDay(row: Pick<LinkableResult, 'date' | 'meet'>, source: Pick<SourceResult, 'date' | 'meet'>): boolean {
  const apart = daysBetween(row.date, source.date);
  if (apart <= SOURCE_DATE_TOLERANCE_DAYS) return true;
  const meet = normalizeName(row.meet);
  return apart <= SAME_MEET_TOLERANCE_DAYS && meet !== '' && meet === normalizeName(source.meet);
}

export function sameSourceResult(row: LinkableResult, source: SourceResult): boolean {
  return (
    foldDivision(row.age) === foldDivision(source.age) &&
    (row.total ?? 0) === source.total &&
    (row.snatchBest ?? 0) === source.snatchBest &&
    (row.cjBest ?? 0) === source.cjBest &&
    sameLiftDay(row, source)
  );
}

type AgeBand = { min: number | null; max: number | null };

const OPEN_BAND: AgeBand = { min: null, max: null };

const CATEGORY_BANDS: Record<string, AgeBand> = {
  Senior: OPEN_BAND,
  Junior: { min: 15, max: 20 },
  U23: { min: 15, max: 23 },
  U17: { min: null, max: 17 },
  U15: { min: null, max: 15 },
  U13: { min: null, max: 13 },
  U11: { min: null, max: 11 },
};

export function ageBandOf(division: string): AgeBand {
  const masters = mastersAges(division);
  if (masters) return masters;
  const { category } = parseDivision(division);
  return (category === null ? undefined : CATEGORY_BANDS[category]) ?? OPEN_BAND;
}

export type LifterFacts = Pick<Doc<'lifters'>, 'athleteId' | 'gender' | 'birthYear'>;

export function fitsDivision(row: Pick<LinkableResult, 'age' | 'date'>, lifter: LifterFacts): boolean {
  const division = parseDivision(row.age ?? '');
  if (division.gender !== null && lifter.gender !== undefined && division.gender !== lifter.gender) return false;
  if (lifter.birthYear === undefined || !isDatedResult(row.date)) return true;
  const age = Number(row.date.slice(0, 4)) - lifter.birthYear;
  const band = ageBandOf(row.age ?? '');
  if (band.min !== null && age < band.min - BIRTH_YEAR_TOLERANCE) return false;
  if (band.max !== null && age > band.max + BIRTH_YEAR_TOLERANCE) return false;
  return true;
}

export const SPORT80_FEDERATION = 'USAW';

export const isSport80Result = (row: { federation?: string | null }) =>
  row.federation === undefined || row.federation === null || row.federation === SPORT80_FEDERATION;

export type LifterLink = { lifterId: string; lifterMatch: LifterMatch } | null;

export type SourceHistories = ReadonlyMap<string, readonly SourceResult[]>;

export function linkFor(row: LinkableResult, lifters: readonly LifterFacts[], histories: SourceHistories | null): LifterLink {
  if (lifters.length === 0) return null;
  let candidates = lifters;
  if (isSport80Result(row)) {
    if (histories === null) return null;
    const owners = lifters.filter((lifter) => (histories.get(lifter.athleteId) ?? []).some((source) => sameSourceResult(row, source)));
    if (owners.length === 0) return null;
    if (owners.length === 1) return { lifterId: owners[0].athleteId, lifterMatch: 'history' };
    candidates = owners;
  }
  const fitting = candidates.filter((lifter) => fitsDivision(row, lifter));
  return fitting.length === 1 ? { lifterId: fitting[0].athleteId, lifterMatch: 'fit' } : null;
}

export function sameLink(row: Pick<Doc<'lifting_results'>, 'lifterId' | 'lifterMatch'>, link: LifterLink): boolean {
  if (link === null) return row.lifterId === undefined && row.lifterMatch === undefined;
  return row.lifterId === link.lifterId && row.lifterMatch === link.lifterMatch;
}

export function needsSourceHistories(lifterCount: number, hasSport80Result: boolean): boolean {
  return lifterCount > 0 && hasSport80Result;
}
