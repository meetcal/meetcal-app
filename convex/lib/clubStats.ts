import type { QueryCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { clubKey, sameClub } from './clubs';
import { normalizeName } from './names';
import { bareWeightClass, classNamedIn } from './weightClass';
import { normalizeGender } from './normalize';
import { compareBytes, compareCollated } from './sort';
import { TIMELINE_READ_BATCH, meetResultDocs, rosterDocs } from './meetData';

/**
 * One athlete's result at a meet with everything a club summary needs:
 * their roster entry (DISTINCT ON the folded name), their best row at the
 * meet, placings within its ranking group (`rankingGroup`), and their best
 * non-BWL total before the meet.
 */
export type StatsRow = {
  key: string;
  name: string;
  club: string;
  weight_class: string;
  body_weight: number;
  attempts: [number, number, number, number, number, number];
  snatch_best: number;
  cj_best: number;
  total: number;
  /** Snatch, clean & jerk and total placings; null for a lift of 0 (a bomb-out), which places nowhere. */
  placings: [Placing, Placing, Placing];
  previous_best: number | null;
};

export type Placing = number | null;

/**
 * The group a result is placed in at its meet. Sport80 and USAMW results
 * carry their division in `age` ("Open Men's 95kg"): gender, age group and
 * weight class, so every finisher in it is ranked, on the roster or not. A
 * result whose `age` names no weight class falls back to its roster entry's
 * gender and weight class with that label; with no roster entry either, it
 * cannot be grouped and is left out (null).
 */
export function rankingGroup(
  age: string | undefined,
  athlete: Pick<Doc<'athletes'>, 'gender' | 'weightClass'> | undefined,
): string | null {
  if (age !== undefined && classNamedIn(age, 'atTheEnd') !== null) return age;
  return athlete ? `${normalizeGender(athlete.gender)}\u0000${athlete.weightClass}\u0000${age ?? ''}` : null;
}

/** What placing a lift reads from a result. */
export type RankedResult = Pick<
  Doc<'lifting_results'>,
  'date' | 'bodyWeight' | 'snatch1' | 'snatch2' | 'snatch3' | 'snatchBest' | 'cj1' | 'cj2' | 'cj3' | 'cjBest' | 'total'
>;

export type RankedLift = 'snatch' | 'cj' | 'total';

/** Results dated before this were tie-broken by body weight first (the IWF rules before 2017). */
const BODY_WEIGHT_TIE_BREAK_BEFORE = '2017-01-01';

/**
 * How a lift ranks: the heavier lift first, then the tie-breaks in order,
 * lower first. Ties go to whoever lifted first; before 2017, to the lighter
 * body weight and then whoever lifted first. Sport80 publishes no placing and
 * no lifting order, so "first" is read from the attempts: within a session
 * the bar only goes up, so the lighter deciding bar (for a total, the clean &
 * jerk that made it) came first, and at the same weight the lower attempt
 * number lifts first. Since 2017, lifters still tied after that (the same
 * weight on the same attempt) share the placing: who lifted first then
 * depends on the order of the lifts, which is not published, and body weight
 * is not the rule. An unknown attempt, or before 2017 an unknown body weight,
 * counts last.
 */
export type LiftKey = readonly [lift: number, ...tieBreaks: number[]];

/** The 1-based attempt that made `best`, or 4 when no attempt did (none recorded). */
function attemptOf(best: number, attempts: readonly (number | undefined)[]): number {
  const index = best > 0 ? attempts.indexOf(best) : -1;
  return index === -1 ? 4 : index + 1;
}

export function liftKey(row: RankedResult, lift: RankedLift): LiftKey {
  const snatch = row.snatchBest ?? 0;
  const cj = row.cjBest ?? 0;
  const [value, bar, attempt] =
    lift === 'snatch'
      ? [snatch, snatch, attemptOf(snatch, [row.snatch1, row.snatch2, row.snatch3])]
      : [lift === 'cj' ? cj : (row.total ?? 0), cj, attemptOf(cj, [row.cj1, row.cj2, row.cj3])];
  if (row.date >= BODY_WEIGHT_TIE_BREAK_BEFORE) return [value, bar, attempt];
  const bodyWeight = row.bodyWeight !== undefined && row.bodyWeight > 0 ? row.bodyWeight : Infinity;
  return [value, bodyWeight, bar, attempt];
}

function ranksAhead(a: LiftKey, b: LiftKey): boolean {
  if (a[0] !== b[0]) return a[0] > b[0];
  for (let i = 1; i < Math.min(a.length, b.length); i += 1) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

/**
 * One more than the number of the group's results that rank ahead
 * (`ranksAhead`); results equal on every field share the placing. A lift or
 * total of 0 or less is a bomb-out, not a result, so it gets no placing.
 */
export function rankOf(value: LiftKey, group: readonly LiftKey[]): Placing {
  if (!(value[0] > 0)) return null;
  let better = 0;
  for (const other of group) if (ranksAhead(other, value)) better += 1;
  return better + 1;
}

type StatsEntry = { key: string; row: Doc<'lifting_results'>; athlete: Doc<'athletes'>; group: string };

type StatsGroups = Map<string, { snatch: LiftKey[]; cj: LiftKey[]; total: LiftKey[] }>;

/**
 * An athlete's previous best total before a date: the best of their earlier
 * results with a total above 0, BWL excluded; null when there is none.
 */
export type PreviousBest = { key: string; before: string; best: number | null };

/** How `computeStatsRows` finds a `PreviousBest` it was handed. */
function previousBestId(key: string, before: string): string {
  return `${key}\u0000${before}`;
}

/** `DISTINCT ON (key) ORDER BY key, total DESC, date DESC, id DESC`: whether `row` comes before `current`. */
function isBetterResult(row: Doc<'lifting_results'>, current: Doc<'lifting_results'> | undefined): boolean {
  if (!current) return true;
  const total = row.total ?? 0;
  const currentTotal = current.total ?? 0;
  return (
    total > currentTotal ||
    (total === currentTotal && (row.date > current.date || (row.date === current.date && row._creationTime > current._creationTime)))
  );
}

/**
 * The meet's finishers joined to the roster, and each ranking group's lifts.
 * Groups hold every finisher of the meet, one result per folded name, so a
 * finisher missing from the roster (a late entry, a misspelt name) still
 * places ahead of the athletes they beat; only joined finishers get a row.
 */
async function statsEntries(ctx: QueryCtx, meet: string): Promise<{ joined: StatsEntry[]; groups: StatsGroups }> {
  const [athletes, results] = await Promise.all([rosterDocs(ctx, meet), meetResultDocs(ctx, meet)]);

  // Every roster entry under each folded name, in the order DISTINCT ON
  // (key) ORDER BY key, name, weight_class, club kept the first of.
  const roster = new Map<string, Doc<'athletes'>[]>();
  for (const athlete of [...athletes].sort(
    (a, b) =>
      compareCollated(a.name, b.name) || compareCollated(a.weightClass, b.weightClass) || compareCollated(a.club, b.club),
  )) {
    const key = normalizeName(athlete.name);
    roster.set(key, [...(roster.get(key) ?? []), athlete]);
  }

  // The best result per lifter (folded name and roster entry), overall (the
  // one reported) and within each ranking group (the ones ranked).
  const best = new Map<string, { key: string; row: Doc<'lifting_results'>; athlete: Doc<'athletes'> | undefined }>();
  const members = new Map<string, Map<string, Doc<'lifting_results'>>>();
  for (const row of results) {
    const key = normalizeName(row.name);
    const entries = roster.get(key);
    const athlete = rosterEntryFor(entries, row.age);
    const lifter = `${key}\u0000${athlete ? entries!.indexOf(athlete) : -1}`;
    if (isBetterResult(row, best.get(lifter)?.row)) best.set(lifter, { key, row, athlete });
    const group = rankingGroup(row.age, athlete);
    if (group === null) continue;
    const inGroup = members.get(group) ?? new Map<string, Doc<'lifting_results'>>();
    if (isBetterResult(row, inGroup.get(lifter))) inGroup.set(lifter, row);
    members.set(group, inGroup);
  }

  const joined: StatsEntry[] = [];
  for (const { key, row, athlete } of best.values()) {
    if (athlete) joined.push({ key, row, athlete, group: rankingGroup(row.age, athlete)! });
  }
  const groups: StatsGroups = new Map();
  for (const [group, rows] of members) {
    const ranked = [...rows.values()];
    groups.set(group, {
      snatch: ranked.map((row) => liftKey(row, 'snatch')),
      cj: ranked.map((row) => liftKey(row, 'cj')),
      total: ranked.map((row) => liftKey(row, 'total')),
    });
  }
  return { joined, groups };
}

function rosterEntryFor(entries: readonly Doc<'athletes'>[] | undefined, age: string | undefined): Doc<'athletes'> | undefined {
  if (!entries || entries.length <= 1) return entries?.[0];
  const weightClass = age === undefined ? null : classNamedIn(age, 'atTheEnd');
  const inClass = weightClass === null ? [] : entries.filter((entry) => bareWeightClass(entry.weightClass) === weightClass);
  return new Set(inClass.map((entry) => clubKey(entry.club))).size === 1 ? inClass[0] : entries[0];
}

/**
 * The previous bests the meet's stats need, without their values: what the
 * stats view builder reads in batches (`previousBests`) before it builds.
 */
export async function statsPreviousBestKeys(ctx: QueryCtx, meet: string): Promise<{ key: string; before: string }[]> {
  const { joined } = await statsEntries(ctx, meet);
  return joined.map(({ key, row }) => ({ key, before: row.date }));
}

/** Previous bests of `wanted`, TIMELINE_READ_BATCH athletes' reads in flight at a time. */
export async function previousBests(
  ctx: QueryCtx,
  wanted: readonly { key: string; before: string }[],
): Promise<PreviousBest[]> {
  const out: PreviousBest[] = [];
  for (let i = 0; i < wanted.length; i += TIMELINE_READ_BATCH) {
    out.push(
      ...(await Promise.all(
        wanted.slice(i, i + TIMELINE_READ_BATCH).map(async ({ key, before }) => ({ key, before, best: await previousBest(ctx, key, before) })),
      )),
    );
  }
  return out;
}

async function previousBest(ctx: QueryCtx, key: string, before: string): Promise<number | null> {
  const previous = await ctx.db
    .query('lifting_results')
    .withIndex('by_nameKey_and_date', (q) => q.eq('nameKey', key).lt('date', before))
    .collect();
  let best: number | null = null;
  for (const p of previous) {
    // A bomb-out (a total of 0) is no previous best: a first real total
    // after one is not a PR, as it is not for a first-timer (#248).
    if (p.federation === 'BWL' || p.total === undefined || !(p.total > 0)) continue;
    best = best === null ? p.total : Math.max(best, p.total);
  }
  return best;
}

/**
 * Stats rows for the meet, previous bests filled in only for athletes of
 * `onlyClub` when given (the live path for one club), for everyone otherwise
 * (the view, shared by every club).
 *
 * Every finisher's earlier results are far more documents than one Convex
 * transaction may read for a national meet, so the view builder reads them
 * beforehand in separate transactions and hands them in as `known`; only an
 * athlete missing from it (the meet changed meanwhile) is read here.
 */
export async function computeStatsRows(
  ctx: QueryCtx,
  meet: string,
  onlyClub?: string,
  known: readonly PreviousBest[] = [],
): Promise<StatsRow[]> {
  return (await computeStats(ctx, meet, onlyClub, known)).rows;
}

/**
 * `computeStatsRows`, and the latest date among the meet's finishers ('' with
 * none): no result dated on or after it can change any of their previous
 * bests (`lib/viewKeys.ts`, `athleteChangeAffects`).
 */
export async function computeStats(
  ctx: QueryCtx,
  meet: string,
  onlyClub?: string,
  known: readonly PreviousBest[] = [],
): Promise<{ rows: StatsRow[]; latest: string }> {
  const { joined, groups } = await statsEntries(ctx, meet);
  const wanted = onlyClub === undefined ? joined : joined.filter(({ athlete }) => sameClub(athlete.club, onlyClub));
  const found = new Map(known.map((p) => [previousBestId(p.key, p.before), p.best]));
  const missing = wanted
    .filter(({ key, row }) => !found.has(previousBestId(key, row.date)))
    .map(({ key, row }) => ({ key, before: row.date }));
  for (const p of await previousBests(ctx, missing)) found.set(previousBestId(p.key, p.before), p.best);
  const latest = joined.reduce((max, { row }) => (row.date > max ? row.date : max), '');
  return { rows: wanted.map((entry) => statsRow(entry, groups, found.get(previousBestId(entry.key, entry.row.date)) ?? null)), latest };
}

/**
 * The stats view's items: each club's athlete count as the first item, then
 * one item per row, so `jsonChunks` can cut a national meet's rows across
 * documents instead of holding them in one item over 1 MiB.
 */
export type StatsViewItem = ['club_counts', [string, number][]] | StatsRow;

export function statsViewItems(rows: readonly StatsRow[], clubCounts: [string, number][]): StatsViewItem[] {
  return [['club_counts', clubCounts], ...rows];
}

/**
 * The rows and club counts back from the stats view's items; also reads the
 * single `{ rows, club_counts }` item views were built as before.
 */
export function readStatsViewItems(items: readonly unknown[]): { rows: StatsRow[]; club_counts: [string, number][] } {
  const [first, ...rest] = items;
  if (Array.isArray(first) && first[0] === 'club_counts' && Array.isArray(first[1])) {
    return { rows: rest as StatsRow[], club_counts: first[1] as [string, number][] };
  }
  if (items.length === 1 && first && typeof first === 'object' && 'rows' in first && 'club_counts' in first) {
    const legacy = first as { rows: unknown; club_counts: unknown };
    if (Array.isArray(legacy.rows) && Array.isArray(legacy.club_counts)) {
      return { rows: legacy.rows as StatsRow[], club_counts: legacy.club_counts as [string, number][] };
    }
  }
  throw new Error('malformed stats view');
}

function statsRow({ key, row, athlete, group }: StatsEntry, groups: StatsGroups, previousBest: number | null): StatsRow {
  const g = groups.get(group)!;
  return {
    key,
    name: row.name,
    club: athlete.club,
    weight_class: athlete.weightClass,
    body_weight: row.bodyWeight ?? 0,
    attempts: [row.snatch1 ?? 0, row.snatch2 ?? 0, row.snatch3 ?? 0, row.cj1 ?? 0, row.cj2 ?? 0, row.cj3 ?? 0],
    snatch_best: row.snatchBest ?? 0,
    cj_best: row.cjBest ?? 0,
    total: row.total ?? 0,
    placings: [rankOf(liftKey(row, 'snatch'), g.snatch), rankOf(liftKey(row, 'cj'), g.cj), rankOf(liftKey(row, 'total'), g.total)],
    previous_best: previousBest,
  };
}

type Medal = 'gold' | 'silver' | 'bronze';

/**
 * The medal a placing earns. The lift is checked as well as the placing: a
 * stats view built before bomb-outs went unplaced still holds a placing for a
 * lift of 0, and a bomb-out never medals.
 */
export function medalFor(placing: Placing, lift: number): Medal | null {
  if (!(lift > 0)) return null;
  return placing === 1 ? 'gold' : placing === 2 ? 'silver' : placing === 3 ? 'bronze' : null;
}

function makeRatePercent(attempts: number[]): number {
  const declared = attempts.filter((a) => a !== 0).length;
  if (declared === 0) return 0;
  const made = attempts.filter((a) => a > 0).length;
  return Math.round((made / declared) * 100);
}

/** `GET /clubs/meet-stats` from the meet's stats rows and the club's roster count. */
export function clubStats(rows: readonly StatsRow[], club: string, totalAthletes: number) {
  const clubRows = rows.filter((r) => sameClub(r.club, club)).sort((a, b) => compareCollated(a.name, b.name));
  let gold = 0;
  let silver = 0;
  let bronze = 0;
  const snatchAttempts: number[] = [];
  const cjAttempts: number[] = [];
  const athleteResults = clubRows.map((r) => {
    const [snatchPlacing, cjPlacing, totalPlacing] = r.placings;
    const snatchMedal = medalFor(snatchPlacing, r.snatch_best);
    const cjMedal = medalFor(cjPlacing, r.cj_best);
    const totalMedal = medalFor(totalPlacing, r.total);
    for (const medal of [snatchMedal, cjMedal, totalMedal]) {
      if (medal === 'gold') gold += 1;
      else if (medal === 'silver') silver += 1;
      else if (medal === 'bronze') bronze += 1;
    }
    snatchAttempts.push(...r.attempts.slice(0, 3));
    cjAttempts.push(...r.attempts.slice(3));
    return {
      name: r.name,
      weight_class: r.weight_class,
      snatch_best: r.snatch_best,
      cj_best: r.cj_best,
      total: r.total,
      body_weight: r.body_weight,
      medal: totalMedal,
      snatch_medal: snatchMedal,
      cj_medal: cjMedal,
      total_medal: totalMedal,
      is_pr: r.previous_best !== null && r.total > r.previous_best,
      perfect_lifts: r.attempts.every((a) => a > 0),
    };
  });
  return {
    total_athletes: totalAthletes,
    gold_medals: gold,
    silver_medals: silver,
    bronze_medals: bronze,
    total_prs: athleteResults.filter((r) => r.is_pr).length,
    perfect_6_for_6: athleteResults.filter((r) => r.perfect_lifts).length,
    total_weight_lifted: athleteResults.reduce((sum, r) => sum + r.total, 0),
    snatch_make_rate: makeRatePercent(snatchAttempts),
    cj_make_rate: makeRatePercent(cjAttempts),
    combined_make_rate: makeRatePercent([...snatchAttempts, ...cjAttempts]),
    athlete_results: athleteResults,
  };
}

type WsoRosterEntry = { name: string; club: string; weightClass: string; wso?: string };

export function registeredWithWso(entry: { wso?: string }, wso: string): boolean {
  return entry.wso !== undefined && normalizeName(entry.wso) === normalizeName(wso);
}

function rosterEntryId(nameKey: string, club: string, weightClass: string): string {
  return `${nameKey}\u0000${club}\u0000${weightClass}`;
}

const EVERY_ROW_IN_ONE_CLUB = 'wso';

function entryEachStatsRowWasJoinedTo(roster: readonly WsoRosterEntry[]): Map<string, WsoRosterEntry> {
  const inStatsEntriesOrder = [...roster].sort(
    (a, b) => compareCollated(a.name, b.name) || compareCollated(a.weightClass, b.weightClass) || compareCollated(a.club, b.club),
  );
  const joined = new Map<string, WsoRosterEntry>();
  for (const entry of inStatsEntriesOrder) {
    const id = rosterEntryId(normalizeName(entry.name), entry.club, entry.weightClass);
    if (!joined.has(id)) joined.set(id, entry);
  }
  return joined;
}

export function wsoStats(rows: readonly StatsRow[], roster: readonly WsoRosterEntry[], wso: string) {
  const members = roster.filter((entry) => registeredWithWso(entry, wso));
  const joined = entryEachStatsRowWasJoinedTo(roster);
  const memberRows = rows
    .filter((row) => {
      const entry = joined.get(rosterEntryId(row.key, row.club, row.weight_class));
      return entry !== undefined && registeredWithWso(entry, wso);
    })
    .map((row) => ({ ...row, club: EVERY_ROW_IN_ONE_CLUB }));
  const distinctMembers = new Set(members.map((entry) => normalizeName(entry.name))).size;
  return clubStats(memberRows, EVERY_ROW_IN_ONE_CLUB, distinctMembers);
}

export async function computeStatsRowsOfWso(ctx: QueryCtx, meet: string, wso: string): Promise<StatsRow[]> {
  const { joined, groups } = await statsEntries(ctx, meet);
  const wanted = joined.filter(({ athlete }) => registeredWithWso(athlete, wso));
  const bests = await previousBests(
    ctx,
    wanted.map(({ key, row }) => ({ key, before: row.date })),
  );
  const found = new Map(bests.map((best) => [previousBestId(best.key, best.before), best.best]));
  return wanted.map((entry) => statsRow(entry, groups, found.get(previousBestId(entry.key, entry.row.date)) ?? null));
}

/** `COUNT(DISTINCT folded name)` of the club's entries at the meet, under any spelling of it (`clubKey`). */
export function clubAthleteCount(roster: readonly { name: string; club: string }[], club: string): number {
  return new Set(roster.filter((a) => sameClub(a.club, club)).map((a) => normalizeName(a.name))).size;
}

/** Each club's `COUNT(DISTINCT folded name)` at the meet, as `[clubKey, count]` pairs. */
export function clubAthleteCounts(roster: readonly { name: string; club: string }[]): [string, number][] {
  const byClub = new Map<string, Set<string>>();
  for (const athlete of roster) {
    const key = clubKey(athlete.club);
    const keys = byClub.get(key) ?? new Set<string>();
    keys.add(normalizeName(athlete.name));
    byClub.set(key, keys);
  }
  return [...byClub.entries()].map(([club, keys]): [string, number] => [club, keys.size]).sort((a, b) => compareBytes(a[0], b[0]));
}
