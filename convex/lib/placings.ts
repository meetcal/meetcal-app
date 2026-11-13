import type { Doc } from '../_generated/dataModel';
import { plausible } from './leaderboard';
import { liftKey, rankOf, type RankedResult } from './clubStats';
import { classNamedIn } from './weightClass';
import { countedRowKey } from './lifterKeys';
import { normalizeName } from './names';
import { normalizeGender } from './normalize';
import type { ApiLiftingResult } from './results';
import { compareBytes } from './sort';

export type EditionMedals = { year: string; gold: number; silver: number; bronze: number };

export type RosterEntry = Pick<Doc<'athletes'>, 'name' | 'gender' | 'weightClass' | 'club'>;

export function rosterClasses(roster: readonly RosterEntry[]): Map<string, string> {
  const inNameOrder = [...roster].sort(
    (a, b) => compareBytes(a.name, b.name) || compareBytes(a.weightClass, b.weightClass) || compareBytes(a.club, b.club),
  );
  const classes = new Map<string, string>();
  for (const athlete of inNameOrder) {
    const key = normalizeName(athlete.name);
    if (!classes.has(key)) classes.set(key, `${normalizeGender(athlete.gender).toLowerCase()}\u0000${athlete.weightClass}`);
  }
  return classes;
}

const divisionNamesWeightClass = (age: string) => classNamedIn(age, 'atTheEnd') !== null;

export function needsRoster(rows: readonly Pick<ApiLiftingResult, 'age'>[]): boolean {
  return rows.some((row) => !divisionNamesWeightClass(row.age));
}

function medalGroup(row: ApiLiftingResult, classes: ReadonlyMap<string, string>): string | null {
  const meet = normalizeName(row.meet);
  const division = normalizeName(row.age);
  if (divisionNamesWeightClass(row.age)) return JSON.stringify([meet, division]);
  const rosterClass = classes.get(normalizeName(row.name));
  return rosterClass === undefined ? null : JSON.stringify([meet, `${rosterClass}\u0000${division}`]);
}

export function rankedResultOf(row: ApiLiftingResult): RankedResult {
  return {
    date: row.date,
    bodyWeight: row.body_weight,
    snatch1: row.snatch1,
    snatch2: row.snatch2,
    snatch3: row.snatch3,
    snatchBest: row.snatch_best,
    cj1: row.cj1,
    cj2: row.cj2,
    cj3: row.cj3,
    cjBest: row.cj_best,
    total: row.total,
  };
}

const yearOf = (date: string) => date.slice(0, 4);

function bestOfEachLifterByGroup(rows: readonly ApiLiftingResult[], classes: ReadonlyMap<string, string>): Map<string, Map<string, ApiLiftingResult>> {
  const groups = new Map<string, Map<string, ApiLiftingResult>>();
  for (const row of rows) {
    if (!plausible(row)) continue;
    const group = medalGroup(row, classes);
    if (group === null) continue;
    const lifters = groups.get(group) ?? new Map<string, ApiLiftingResult>();
    const lifter = countedRowKey(row);
    const best = lifters.get(lifter);
    if (!best || row.total > best.total || (row.total === best.total && row.date > best.date)) lifters.set(lifter, row);
    groups.set(group, lifters);
  }
  return groups;
}

export function editionMedals(rows: readonly ApiLiftingResult[], roster: readonly RosterEntry[], members: readonly string[]): EditionMedals[] {
  const memberKeys = new Set(members.map(normalizeName));
  const classes = rosterClasses(roster);
  const byYear = new Map<string, ApiLiftingResult[]>();
  for (const row of rows) {
    const year = yearOf(row.date);
    const edition = byYear.get(year);
    if (edition) edition.push(row);
    else byYear.set(year, [row]);
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => compareBytes(a, b))
    .map(([year, edition]) => {
      const medals: EditionMedals = { year, gold: 0, silver: 0, bronze: 0 };
      for (const lifters of bestOfEachLifterByGroup(edition, classes).values()) {
        const ranked = [...lifters.values()].map((row) => ({ row, key: liftKey(rankedResultOf(row), 'total') }));
        const keys = ranked.map(({ key }) => key);
        ranked.forEach(({ row, key }) => {
          if (!memberKeys.has(normalizeName(row.name))) return;
          const place = rankOf(key, keys);
          if (place === 1) medals.gold += 1;
          else if (place === 2) medals.silver += 1;
          else if (place === 3) medals.bronze += 1;
        });
      }
      return medals;
    });
}
