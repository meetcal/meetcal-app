import { normalizeGender } from './normalize';
import { currentWeightClasses } from './referenceData';

/**
 * Rules for a meet's roster (`athletes`): when an athlete has a session, and
 * what a start list loaded by hand must look like before it is stored.
 */

type SessionFields = { sessionNumber?: number; sessionPlatform?: string };

/**
 * Whether a start list placed the athlete in a session: a session number and
 * a platform both. The one rule for every reader (the start list joins the
 * schedule on both; the entries sync stops adding entrants once any athlete
 * has one), so a row with only one of them reads as unscheduled everywhere
 * (#219). `replaceMeetAthletes` refuses such rows.
 */
export function hasSession(athlete: SessionFields): boolean {
  return athlete.sessionNumber !== undefined && (athlete.sessionPlatform ?? '').trim() !== '';
}

/** A row that sets one of session number and platform without the other, or a blank platform. */
export function halfSession(athlete: SessionFields): boolean {
  const platform = athlete.sessionPlatform;
  return (athlete.sessionNumber === undefined) !== (platform === undefined) || (platform !== undefined && platform.trim() === '');
}

/**
 * Rows the retired page scrapers wrote from page chrome (#384): Sport80's
 * empty-table placeholder read as an athlete (`undefined undefined`, member
 * id `No Member Entries`), or a name with no letters.
 */
export function isJunkEntrant(row: { name: string; memberId: string }): boolean {
  return !/\p{L}/u.test(row.name) || /\bundefined\b/i.test(row.name) || /no member entries/i.test(row.memberId);
}

/** A membership number the syncs store: digits, or a `noid:` placeholder for an entrant without one. */
export function isStoredMemberId(memberId: string): boolean {
  return /^\d+$/.test(memberId) || memberId.startsWith('noid:');
}

/**
 * Meet names the retired page scrapers took from page chrome (#384): a
 * site's cookie banner, or a CSV line read as a title.
 */
export function isJunkMeetName(meet: string): boolean {
  return /your choice regarding cookies/i.test(meet) || /^\d+,[^,]*,\d+,/.test(meet);
}

/** A weight class without `kg` or spaces, a leading plus moved to the end (`+109kg` -> `109+`). */
export function bareWeightClass(text: string): string {
  const bare = text.replace(/kg/gi, '').replace(/\s+/g, '');
  return bare.startsWith('+') ? `${bare.slice(1)}+` : bare;
}

const AGE_RANGE = { min: 5, max: 100 } as const;
/** A roster this size or more with this share of one age has ages that are buckets or a default. */
const ONE_AGE = { roster: 20, share: 0.4 } as const;
/** A roster this size with no superheavy class has had the `+` dropped. */
const PLUS_CLASS_ROSTER = 50;

type RosterRow = SessionFields & { name: string; memberId: string; age: number; gender: string; weightClass: string };

/**
 * What is wrong with a start list loaded by hand (#388), each problem naming
 * its rows: an age outside 5-100, or one age for much of the roster
 * (category buckets, a default of 0); a gender that is neither men nor
 * women; a weight class that is not a bare class (`77`, `86+`), or only the
 * other gender's (a woman stored as a man); no superheavy class in a large
 * roster (the `+` dropped); a placeholder entrant (`isJunkEntrant`).
 */
export function rosterProblems(rows: readonly RosterRow[]): string[] {
  const problems: string[] = [];
  const named = (list: readonly RosterRow[]) => `${list.length} row(s): ${list.slice(0, 5).map((row) => JSON.stringify(row.name)).join(', ')}${list.length > 5 ? ', …' : ''}`;
  const report = (what: string, list: readonly RosterRow[]) => {
    if (list.length) problems.push(`${what}, ${named(list)}`);
  };
  report('age outside 5-100', rows.filter((row) => !(row.age >= AGE_RANGE.min && row.age <= AGE_RANGE.max)));
  if (rows.length >= ONE_AGE.roster) {
    const counts = new Map<number, number>();
    for (const row of rows) counts.set(row.age, (counts.get(row.age) ?? 0) + 1);
    const [age, count] = [...counts].sort((a, b) => b[1] - a[1])[0];
    if (count > rows.length * ONE_AGE.share) problems.push(`${count} of ${rows.length} rows have age ${age} (category buckets or a default?)`);
  }
  report('gender neither men nor women', rows.filter((row) => !['Men', 'Women'].includes(normalizeGender(row.gender))));
  report('weight class not a bare class such as 77 or 86+', rows.filter((row) => !/^\d+(\.\d+)?\+?$/.test(bareWeightClass(row.weightClass))));
  const men = currentWeightClasses('Men');
  const women = currentWeightClasses('Women');
  report(
    "weight class only the other gender's",
    rows.filter((row) => {
      const weightClass = bareWeightClass(row.weightClass);
      const gender = normalizeGender(row.gender);
      return gender === 'Men' ? women.has(weightClass) && !men.has(weightClass) : gender === 'Women' && men.has(weightClass) && !women.has(weightClass);
    }),
  );
  if (rows.length > PLUS_CLASS_ROSTER && !rows.some((row) => bareWeightClass(row.weightClass).endsWith('+'))) {
    problems.push(`no superheavy (+) class among ${rows.length} rows (the + dropped?)`);
  }
  report('a placeholder, not an athlete', rows.filter(isJunkEntrant));
  return problems;
}
