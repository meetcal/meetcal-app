import { v } from 'convex/values';
import { premiumQuery } from './lib/access';
import { query, type QueryCtx } from './_generated/server';
import { revalidated, revalidatedText, type Revalidated } from './lib/etag';
import type { Doc } from './_generated/dataModel';
import { clubKey, clubLabels } from './lib/clubs';
import { clubAthleteCount, clubStats, computeStatsRows, meetByName, meetResultTitles, readStatsViewItems } from './lib/meetData';
import { paddedDate, type MeetStatus } from './lib/meetStatus';
import { isPlaceholderMeet } from './meets';
import {
  ADAPTIVE_RECORDS_SEASON_START,
  clubNamesPage,
  computeAdaptiveRecords,
  computeIntlRankings,
  computeNationalRankingsForYear,
  computeQualifyingTotals,
  computeRecords,
  computeStandards,
  computeWsoList,
  computeWsoRows,
  distinctCollated,
  filterWsoRows,
  nationalRankingPage,
  requireAdaptiveGender,
  requireKnownRankingClass,
  wsoAgeGroups as ageGroupsOf,
  type WsoRecordRow,
} from './lib/referenceData';
import { athleteGenderLabel } from './lib/normalize';
import { compareCollated } from './lib/sort';
import { adaptiveKey, ADAPTIVE_VIEW_ARGS, meetKey, natKey, REF_VIEWS, wsoKey } from './lib/viewKeys';
import { readFreshView, readViewAnyAge, readViewJsonAnyAge } from './lib/views';
import { apiError, requireNonEmpty } from './lib/validation';
import { isMaintainedWso } from './lib/wsoSources';

// Reference data and clubs: each query answers the JSON of the Rust route of
// the same name in `meetcal-backend/app/src/routes/{comp_data,clubs}`, from a
// view when it is fresh (`convex/views.ts`) and computed live otherwise.

const ifNoneMatch = v.optional(v.string());

/** The view's text as the answer, or `compute()` when there is no fresh view. */
async function viewOrLive(
  ctx: QueryCtx,
  key: string,
  ifNoneMatch: string | undefined,
  compute: () => Promise<unknown>,
): Promise<Revalidated> {
  const view = await readFreshView(ctx, key);
  if (view) return await revalidatedText(view.etag, view.json, ifNoneMatch);
  return revalidated(await compute(), ifNoneMatch);
}

/** `GET /data/records` */
export const records = premiumQuery('reference:records', {
  args: { ifNoneMatch },
  handler: async (ctx, args) => await viewOrLive(ctx, REF_VIEWS.records, args.ifNoneMatch, () => computeRecords(ctx)),
});

/** `GET /data/standards` */
export const standards = premiumQuery('reference:standards', {
  args: { ifNoneMatch },
  handler: async (ctx, args) => await viewOrLive(ctx, REF_VIEWS.standards, args.ifNoneMatch, () => computeStandards(ctx)),
});

/** `GET /data/qualifying-totals` */
export const qualifyingTotals = premiumQuery('reference:qualifyingTotals', {
  args: { ifNoneMatch },
  handler: async (ctx, args) =>
    await viewOrLive(ctx, REF_VIEWS.qualifying_totals, args.ifNoneMatch, () => computeQualifyingTotals(ctx)),
});

/** `GET /data/intl-rankings` */
export const intlRankings = premiumQuery('reference:intlRankings', {
  args: { ifNoneMatch },
  handler: async (ctx, args) =>
    await viewOrLive(ctx, REF_VIEWS.intl_rankings, args.ifNoneMatch, () => computeIntlRankings(ctx)),
});

/**
 * The view's text whatever its age; without one, `compute()` when it fits
 * one query (null when it does not). For answers whose live computation can
 * be more than one query may read: the last complete build, at most a
 * refresh behind, beats an error.
 */
async function viewAnyAgeOrBounded(
  ctx: QueryCtx,
  key: string,
  ifNoneMatch: string | undefined,
  compute: () => Promise<unknown | null>,
): Promise<Revalidated> {
  const view = await readViewAnyAge(ctx, key);
  if (view) return await revalidatedText(view.etag, view.json, ifNoneMatch);
  const answer = await compute();
  // Only a large answer the refresh has not built yet (seconds after its
  // first rows were written).
  if (answer === null) throw apiError(503, 'this list is being built; try again in a minute');
  return revalidated(answer, ifNoneMatch);
}

/**
 * `GET /data/nat-rankings`: each athlete's best total in the class, heaviest
 * first. An unknown federation or age category is a 404
 * (`requireKnownRankingClass`); a known class nobody has a total in is `[]`.
 */
export const nationalRankings = premiumQuery('reference:nationalRankings', {
  args: { federation: v.string(), ageCategory: v.string(), ifNoneMatch },
  handler: async (ctx, args) => {
    await requireKnownRankingClass(ctx, args.federation, args.ageCategory);
    return await viewAnyAgeOrBounded(ctx, natKey(args.federation, args.ageCategory), args.ifNoneMatch, async () => {
      // A class with no view has no results, or is new: one page answers it.
      const page = await nationalRankingPage(ctx, args.federation, args.ageCategory, null);
      return page.isDone ? page.rows : null;
    });
  },
});

/** `GET /data/nat-rankings-year`: `nationalRankings` within one calendar year, with dates. */
export const nationalRankingsByYear = premiumQuery('reference:nationalRankingsByYear', {
  args: { federation: v.string(), ageCategory: v.string(), year: v.string(), ifNoneMatch },
  handler: async (ctx, args) => {
    if (!/^\d{4}$/.test(args.year)) throw apiError(400, 'year must be a four-digit year');
    await requireKnownRankingClass(ctx, args.federation, args.ageCategory);
    const rankings = await computeNationalRankingsForYear(ctx, args.federation, args.ageCategory, args.year);
    return revalidated(rankings, args.ifNoneMatch);
  },
});

/**
 * `GET /data/wso/`. A fresh view is filtered too: one built before the
 * WSOs were limited to the maintained ones (`MAINTAINED_WSOS`) stays fresh
 * until its rows change, and would offer WSOs whose records answer `[]`.
 */
export const wsoList = premiumQuery('reference:wsoList', {
  args: { ifNoneMatch },
  handler: async (ctx, args) => {
    const view = await readFreshView<string>(ctx, REF_VIEWS.wso_list);
    const wsos = view ? (await view.items()).filter(isMaintainedWso) : await computeWsoList(ctx);
    return revalidated(wsos, args.ifNoneMatch);
  },
});

/** The most names `registrationWsos` reads (one index read each); there are about 30 WSOs. */
export const MAX_REGISTRATION_WSOS = 200;

/**
 * Every WSO name on registrations (`athletes.wso`), the names `wsoAthletes` matches. They differ
 * from the record sheets' (`wsoList`): "California North Central" registers athletes, "California
 * North" keeps records, and several WSOs keep none. A skip-scan of the `by_wso` index, one read
 * per WSO; answers the names in the list order (`distinctCollated`).
 */
export const registrationWsos = premiumQuery('reference:registrationWsos', {
  args: {},
  handler: async (ctx) => {
    const names: string[] = [];
    // Strings sort after missing and null values, so `> ''` starts at the first named WSO.
    let last = '';
    for (let i = 0; i < MAX_REGISTRATION_WSOS; i += 1) {
      const lower = last;
      const row = await ctx.db.query('athletes').withIndex('by_wso', (q) => q.gt('wso', lower)).first();
      if (!row || typeof row.wso !== 'string') break;
      names.push(row.wso);
      last = row.wso;
    }
    return distinctCollated(names.filter((name) => name.trim() !== ''));
  },
});

/**
 * A WSO's records, from a fresh view or live. Answers derived from them are
 * tagged with the hash of their body on both paths, so a client's tag
 * survives the view going stale and being rebuilt.
 */
async function wsoRows(ctx: QueryCtx, wso: string): Promise<WsoRecordRow[]> {
  // Before the views are rebuilt, an unmaintained WSO's old view is still fresh.
  if (!isMaintainedWso(wso)) return [];
  const view = await readFreshView<WsoRecordRow>(ctx, wsoKey(wso));
  return view ? await view.items() : await computeWsoRows(ctx, wso);
}

/** `GET /data/wso/age-groups` */
export const wsoAgeGroups = premiumQuery('reference:wsoAgeGroups', {
  args: { wso: v.string(), ifNoneMatch },
  handler: async (ctx, args) => {
    requireNonEmpty('wso', args.wso);
    return revalidated(ageGroupsOf(await wsoRows(ctx, args.wso)), args.ifNoneMatch);
  },
});

/** `GET /data/wso/records`, optionally narrowed to one age category and/or gender. */
export const wsoRecords = premiumQuery('reference:wsoRecords', {
  args: {
    wso: v.string(),
    ageCategory: v.optional(v.string()),
    gender: v.optional(v.string()),
    ifNoneMatch,
  },
  handler: async (ctx, args) => {
    requireNonEmpty('wso', args.wso);
    const rows = await wsoRows(ctx, args.wso);
    return revalidated(filterWsoRows(rows, args.ageCategory, args.gender), args.ifNoneMatch);
  },
});

/** `GET /data/adaptive`: the season's best lifts per weight class. `gender` is `men` or `women`, any case. */
export const adaptiveRecords = premiumQuery('reference:adaptiveRecords', {
  args: {
    gender: v.string(),
    excludeFederation: v.string(),
    season: v.optional(v.string()),
    ifNoneMatch,
  },
  handler: async (ctx, args) => {
    const season = args.season ?? ADAPTIVE_RECORDS_SEASON_START;
    if (!/^\d{4}$/.test(season)) throw apiError(400, 'season must be a four-digit year');
    const gender = requireAdaptiveGender(args.gender);
    const compute = () => computeAdaptiveRecords(ctx, gender, args.excludeFederation, season);
    const viewed =
      season === ADAPTIVE_RECORDS_SEASON_START &&
      ADAPTIVE_VIEW_ARGS.some((a) => a.gender === gender && a.excludeFederation === args.excludeFederation);
    if (!viewed) return revalidated(await compute(), args.ifNoneMatch);
    return await viewOrLive(ctx, adaptiveKey(gender, args.excludeFederation, season), args.ifNoneMatch, compute);
  },
});

/**
 * `GET /clubs`: one name per club, however many ways its registrants spelled
 * it (`clubLabels`, #363); the club answers below take any spelling.
 */
export const clubs = premiumQuery('reference:clubs', {
  args: { ifNoneMatch },
  handler: async (ctx, args) =>
    await viewAnyAgeOrBounded(ctx, REF_VIEWS.clubs, args.ifNoneMatch, async () => {
      const page = await clubNamesPage(ctx, null);
      return page.after === null ? clubLabels(page.clubs) : null;
    }),
});

/**
 * Every stored spelling of `club` (`clubKey`), the one asked for first, from
 * the club spellings view whatever its age: a spelling first registered
 * since the last build is missing for seconds, and the one asked for is
 * always read.
 */
export async function clubSpellings(ctx: QueryCtx, club: string): Promise<string[]> {
  const text = await readViewJsonAnyAge(ctx, REF_VIEWS.club_spellings);
  const key = clubKey(club);
  const group = text === null ? undefined : (JSON.parse(text) as [string, string[]][]).find(([k]) => k === key)?.[1];
  return [club, ...(group ?? []).filter((spelling) => spelling !== club)];
}

/** Registrations per page of `clubAthletes` / `wsoAthletes`. */
const ATHLETE_PAGE_SIZE = 2000;
/**
 * Registrations answered to a client that does not page (the app, site and
 * CLI before paging). `clubAthletes` answers an array, which holds at most
 * 8,192 elements: a larger answer failed before paging, so every club that
 * answered then still answers in full. `wsoAthletes` answers text, which has
 * no element limit; before paging it failed past the 32,000 documents one
 * query may read, and this keeps under that with room to spare.
 */
const UNPAGED_CLUB_ATHLETE_LIMIT = 8192;
const UNPAGED_WSO_ATHLETE_LIMIT = 30000;
/** Meets a too-large unpaged club answer keeps one entry of: one index range each, of the 4,096 a query may use. */
const UNPAGED_CLUB_MEET_LIMIT = 4000;
/**
 * Index ranges an unpaged `clubAthletes` spends at most on registrations,
 * meet seeks and meet dates together, under the 4,096 one query may use.
 */
const UNPAGED_CLUB_RANGE_BUDGET = 3900;
/** Registrations an unpaged `clubAthletes` reads at most, under the 32,000 documents one query may read. */
const UNPAGED_CLUB_DOC_BUDGET = 24000;

const athleteCursor = v.optional(v.union(v.string(), v.null()));

function clubAthleteRow(r: Doc<'athletes'>) {
  return {
    name: r.name,
    meet: r.meet,
    club: r.club,
    gender: athleteGenderLabel(r.gender),
    weight_class: r.weightClass,
    entry_total: r.entryTotal,
    member_id: r.memberId,
  };
}

/**
 * The start date of the distinct meets of `rows`, one meet read each, for
 * at most `lookups` meets (those of the most recent registrations first);
 * the rest have none.
 */
async function meetDatesOf(ctx: QueryCtx, rows: readonly Doc<'athletes'>[], lookups: number): Promise<Map<string, string | null>> {
  const meets = [...new Set([...rows].sort((a, b) => b._creationTime - a._creationTime).map((r) => r.meet))].slice(0, Math.max(0, lookups));
  const dates = await Promise.all(meets.map(async (meet) => (await meetByName(ctx, meet))?.startDate ?? null));
  return new Map(meets.map((meet, i) => [meet, dates[i]]));
}

async function clubAthleteRows(ctx: QueryCtx, rows: Doc<'athletes'>[], dateLookups: number) {
  const meetDates = await meetDatesOf(ctx, rows, dateLookups);
  // The meet's first day, for listing a club's meets newest first (#341);
  // null for a roster with no meet row.
  return rows.sort(namesDescending).map((r) => ({ ...clubAthleteRow(r), meet_date: meetDates.get(r.meet) ?? null }));
}

const namesDescending = (a: Doc<'athletes'>, b: Doc<'athletes'>) => compareCollated(b.name, a.name);

/** What an unpaged `clubAthletes` may still read. */
type ReadBudget = { ranges: number; docs: number };

/**
 * A club's registrations under every spelling for a client that does not
 * page: all of them when they fit in UNPAGED_CLUB_ATHLETE_LIMIT. Past it, one
 * entry of every meet the club entered under any spelling (the app lists a
 * club's meets from this answer, so none goes missing), then the most
 * recently written for the rest. Reads within `budget`, which is left with
 * what the meet dates may use.
 */
async function unpagedClubAthletes(ctx: QueryCtx, spellings: readonly string[], budget: ReadBudget): Promise<Doc<'athletes'>[]> {
  const read: Doc<'athletes'>[] = [];
  for (const club of spellings) {
    if (budget.ranges <= 0 || budget.docs <= 0) break;
    read.push(...(await unpagedSpellingAthletes(ctx, club, budget)));
  }
  const recentFirst = read.sort((a, b) => b._creationTime - a._creationTime);
  const kept = new Map<string, Doc<'athletes'>>();
  const meets = new Set<string>();
  for (const row of recentFirst) {
    if (kept.size >= UNPAGED_CLUB_ATHLETE_LIMIT) break;
    if (meets.has(row.meet)) continue;
    meets.add(row.meet);
    kept.set(row._id, row);
  }
  for (const row of recentFirst) {
    if (kept.size >= UNPAGED_CLUB_ATHLETE_LIMIT) break;
    kept.set(row._id, row);
  }
  return [...kept.values()];
}

/**
 * One spelling's registrations: all of them when they fit in
 * UNPAGED_CLUB_ATHLETE_LIMIT; past it, the most recent and one entry of each
 * meet it entered (one index seek per meet, within `budget`).
 */
async function unpagedSpellingAthletes(ctx: QueryCtx, club: string, budget: ReadBudget): Promise<Doc<'athletes'>[]> {
  budget.ranges -= 1;
  const recent = await ctx.db
    .query('athletes')
    .withIndex('by_club', (q) => q.eq('club', club))
    .order('desc')
    .take(Math.min(UNPAGED_CLUB_ATHLETE_LIMIT + 1, budget.docs));
  budget.docs -= recent.length;
  if (recent.length <= UNPAGED_CLUB_ATHLETE_LIMIT) return recent;
  const perMeet: Doc<'athletes'>[] = [];
  let last: string | null = null;
  for (let i = 0; i < UNPAGED_CLUB_MEET_LIMIT && budget.ranges > 0; i += 1) {
    const after: string | null = last;
    budget.ranges -= 1;
    // One index seek per meet: the club's next meet after the last one seen.
    const row: Doc<'athletes'> | null = await ctx.db
      .query('athletes')
      .withIndex('by_club_and_meet', (q) => (after === null ? q.eq('club', club) : q.eq('club', club).gt('meet', after)))
      .first();
    if (!row) break;
    perMeet.push(row);
    last = row.meet;
  }
  return [...recent, ...perMeet];
}

/**
 * Where a paged `clubAthletes` is: the spellings it has finished, the one it
 * is reading, and its cursor there. Spellings are named, not numbered, so a
 * spellings list rebuilt between pages (one added or gone) neither repeats
 * nor skips one. A cursor from before spellings were read (a bare Convex
 * cursor) is the first spelling's: the one asked for.
 */
type ClubCursor = { done: string[]; spelling: string | null; cursor: string | null };

function clubCursor(cursor: string | null): ClubCursor {
  if (cursor === null) return { done: [], spelling: null, cursor: null };
  try {
    const parsed: unknown = JSON.parse(cursor);
    if (
      Array.isArray(parsed) &&
      parsed[0] === 'club' &&
      Array.isArray(parsed[1]) &&
      parsed[1].every((done) => typeof done === 'string') &&
      typeof parsed[2] === 'string' &&
      (typeof parsed[3] === 'string' || parsed[3] === null)
    ) {
      return { done: parsed[1] as string[], spelling: parsed[2], cursor: parsed[3] as string | null };
    }
  } catch {
    // A bare Convex cursor.
  }
  return { done: [], spelling: null, cursor };
}

const encodeClubCursor = (done: readonly string[], spelling: string, cursor: string | null) => JSON.stringify(['club', done, spelling, cursor]);

/**
 * `GET /clubs/athletes`: a club's entries across meets, names descending,
 * under every spelling of the club (`clubSpellings`, #363), each with its
 * meet's date (`meet_date`).
 *
 * With `cursor` (null for the first page) it answers a page,
 * `{ json, cursor, isDone }`: call again with `cursor` until `isDone`. Each
 * page is in name order and holds one spelling's entries; pages are not
 * merged, and a roster replaced while a client pages can appear twice.
 * Without it (clients that predate paging), the plain array of
 * `unpagedClubAthletes`.
 */
export const clubAthletes = premiumQuery('reference:clubAthletes', {
  args: { club: v.string(), cursor: athleteCursor },
  handler: async (ctx, args) => {
    requireNonEmpty('club', args.club);
    const spellings = await clubSpellings(ctx, args.club);
    if (args.cursor !== undefined) {
      const at = clubCursor(args.cursor);
      const done = new Set(at.done);
      // The spelling the cursor is in, if the list still has it; else the
      // next one not yet read, from its start.
      const current = at.spelling !== null && spellings.includes(at.spelling) && !done.has(at.spelling) ? at.spelling : spellings.find((s) => !done.has(s));
      if (current === undefined) return { json: '[]', cursor: args.cursor ?? 'done', isDone: true };
      const cursor = current === (at.spelling ?? spellings[0]) ? at.cursor : null;
      const page = await ctx.db
        .query('athletes')
        .withIndex('by_club', (q) => q.eq('club', current))
        .paginate({ cursor, numItems: ATHLETE_PAGE_SIZE });
      const json = JSON.stringify(await clubAthleteRows(ctx, page.page, ATHLETE_PAGE_SIZE));
      if (!page.isDone) return { json, cursor: encodeClubCursor(at.done, current, page.continueCursor), isDone: false };
      const finished = [...at.done, current];
      const next = spellings.find((s) => !finished.includes(s));
      if (next === undefined) return { json, cursor: encodeClubCursor(finished, current, page.continueCursor), isDone: true };
      return { json, cursor: encodeClubCursor(finished, next, null), isDone: false };
    }
    const budget: ReadBudget = { ranges: UNPAGED_CLUB_RANGE_BUDGET, docs: UNPAGED_CLUB_DOC_BUDGET };
    const rows = await unpagedClubAthletes(ctx, spellings, budget);
    return await clubAthleteRows(ctx, rows, budget.ranges);
  },
});

/**
 * Distinct meets `clubMeets` lists at most across a club's spellings. Each
 * costs up to four index ranges (its seek, its meet row, its results titles
 * and one results probe), so 900 fit in `CLUB_MEETS_RANGE_BUDGET` with room
 * for a spelling's last seek and a few linked results titles.
 */
export const MAX_CLUB_MEETS = 900;
/**
 * Index ranges `clubMeets` spends at most on seeks, meet rows and results
 * probes together, under the 4,096 one query may use; the rest is the
 * access pass and the spellings view.
 */
const CLUB_MEETS_RANGE_BUDGET = 3900;
/** Meets `clubMeets` looks up at once: one function may have only so many reads in flight. */
const CLUB_MEET_LOOKUP_BATCH = 100;
/** Index ranges one meet's lookup may need beyond its seek: its meet row, its results titles, a results probe. */
const CLUB_MEET_LOOKUP_RANGES = 3;

/** One meet of `clubMeets`. */
type ClubMeetRow = {
  meet: string;
  /** The meet's first day, `YYYY-MM-DD`; null without a meet row. */
  date: string | null;
  /** The meet row's status; null without one. */
  status: MeetStatus | null;
  /** Whether any result is stored for the meet, under its name or a linked results title. */
  has_results: boolean;
};

/**
 * The distinct meets `spellings` registered for, in reverse name order
 * within a spelling: one index seek per meet (the next meet before the last
 * one seen), so a club's history costs one read per meet, not per
 * registration. Stops at MAX_CLUB_MEETS or when `budget` is spent; `complete`
 * says whether it read them all. Most meets are named for their year, so a
 * club cut short keeps its recent meets.
 */
async function clubMeetNames(ctx: QueryCtx, spellings: readonly string[], budget: ClubMeetsBudget): Promise<{ names: string[]; complete: boolean }> {
  const names = new Set<string>();
  for (const club of spellings) {
    let last: string | null = null;
    for (;;) {
      if (budget.ranges <= 0) return { names: [...names], complete: false };
      const before: string | null = last;
      budget.ranges -= 1;
      const row: Doc<'athletes'> | null = await ctx.db
        .query('athletes')
        .withIndex('by_club_and_meet', (q) => (before === null ? q.eq('club', club) : q.eq('club', club).lt('meet', before)))
        .order('desc')
        .first();
      if (!row) break;
      if (!names.has(row.meet) && names.size >= MAX_CLUB_MEETS) return { names: [...names], complete: false };
      names.add(row.meet);
      last = row.meet;
    }
  }
  return { names: [...names], complete: true };
}

/** What `clubMeets` may still read: index ranges, and whether a lookup had to stop short. */
type ClubMeetsBudget = { ranges: number; short: boolean };

/**
 * Whether any result is stored under `meet` or a results title linked to it,
 * one probe per title. A probe the budget cannot afford is not made: the
 * meet reads as having none, and the budget is marked short.
 */
async function meetHasResults(ctx: QueryCtx, meet: string, budget: ClubMeetsBudget): Promise<boolean> {
  budget.ranges -= 1;
  for (const title of await meetResultTitles(ctx, meet)) {
    if (budget.ranges <= 0) {
      budget.short = true;
      return false;
    }
    budget.ranges -= 1;
    const row = await ctx.db
      .query('lifting_results')
      .withIndex('by_meet', (q) => q.eq('meet', title))
      .first();
    if (row) return true;
  }
  return false;
}

/**
 * `meet` joined to its meet row, or null for a test entry
 * (`isPlaceholderMeet`). An upcoming meet has no results, so it is not probed.
 */
async function clubMeetRow(ctx: QueryCtx, meet: string, budget: ClubMeetsBudget): Promise<ClubMeetRow | null> {
  budget.ranges -= 1;
  const row = await meetByName(ctx, meet);
  if (row && isPlaceholderMeet(row)) return null;
  const has_results = row?.status === 'upcoming' ? false : await meetHasResults(ctx, meet, budget);
  return { meet, date: row ? paddedDate(row.startDate) : null, status: row?.status ?? null, has_results };
}

/** A leading four-digit year in a meet's name ("2026 Arnold"), or -1. */
function nameYear(meet: string): number {
  const match = /^\s*(\d{4})\b/.exec(meet);
  return match ? Number(match[1]) : -1;
}

/**
 * Newest first: by date, then a meet with no date by the year its name
 * starts with, then by name (as the app's `clubMeetsNewestFirst`).
 */
function newestMeetFirst(a: ClubMeetRow, b: ClubMeetRow): number {
  if (a.date !== b.date) {
    if (a.date === null) return 1;
    if (b.date === null) return -1;
    return a.date < b.date ? 1 : -1;
  }
  return nameYear(b.meet) - nameYear(a.meet) || compareCollated(a.meet, b.meet);
}

/**
 * The distinct meets a club registered for under any of its spellings
 * (`clubSpellings`), newest first, each with its first day, status and
 * whether it has results (#209): the club's meets without reading every
 * registration, as `clubAthletes` must. Answers `{ meets, truncated }`.
 * Reads one index seek per meet and spelling and up to three ranges per meet
 * to join it, within CLUB_MEETS_RANGE_BUDGET; a club past MAX_CLUB_MEETS or
 * the budget answers the meets it read, the most recent by name, with
 * `truncated` set. Test entries (`isPlaceholderMeet`) are left out.
 */
export const clubMeets = premiumQuery('reference:clubMeets', {
  args: { club: v.string() },
  handler: async (ctx, args) => {
    requireNonEmpty('club', args.club);
    const spellings = await clubSpellings(ctx, args.club);
    const budget: ClubMeetsBudget = { ranges: CLUB_MEETS_RANGE_BUDGET, short: false };
    const { names, complete } = await clubMeetNames(ctx, spellings, budget);
    // The most recent by name first, so a budget that runs out leaves out the oldest.
    names.sort((a, b) => nameYear(b) - nameYear(a) || compareCollated(b, a));
    const meets: ClubMeetRow[] = [];
    let described = 0;
    for (; described < names.length; described += CLUB_MEET_LOOKUP_BATCH) {
      const batch = names.slice(described, described + CLUB_MEET_LOOKUP_BATCH);
      // Only a batch the budget can afford: a linked results title costs one range more.
      if (budget.ranges < batch.length * CLUB_MEET_LOOKUP_RANGES) break;
      const rows = await Promise.all(batch.map((meet) => clubMeetRow(ctx, meet, budget)));
      for (const row of rows) if (row) meets.push(row);
    }
    return { meets: meets.sort(newestMeetFirst), truncated: !complete || budget.short || described < names.length };
  },
});

/**
 * `GET /wsos/athletes`: a WSO's registrations across meets, names descending.
 * An athlete's WSO is the one they registered under at each meet, since
 * affiliation can change between meets. Answers `{ json }`: a large WSO has
 * thousands of registrations. Paged with `cursor` as `clubAthletes` is.
 */
export const wsoAthletes = premiumQuery('reference:wsoAthletes', {
  args: { wso: v.string(), cursor: athleteCursor },
  handler: async (ctx, args) => {
    requireNonEmpty('wso', args.wso);
    const row = (r: Doc<'athletes'>) => ({ ...clubAthleteRow(r), wso: args.wso });
    const rows = ctx.db.query('athletes').withIndex('by_wso', (q) => q.eq('wso', args.wso));
    if (args.cursor !== undefined) {
      const page = await rows.paginate({ cursor: args.cursor, numItems: ATHLETE_PAGE_SIZE });
      return { json: JSON.stringify(page.page.sort(namesDescending).map(row)), cursor: page.continueCursor, isDone: page.isDone };
    }
    const recent = await rows.order('desc').take(UNPAGED_WSO_ATHLETE_LIMIT);
    return { json: JSON.stringify(recent.sort(namesDescending).map(row)) };
  },
});

/**
 * `GET /clubs/meet-stats`: a club's medals, PRs and make rates at one meet,
 * from the meet's stats and roster views when fresh.
 */
export const clubMeetStats = premiumQuery('reference:clubMeetStats', {
  args: { club: v.string(), meet: v.string() },
  handler: async (ctx, { club, meet }) => {
    requireNonEmpty('club', club);
    requireNonEmpty('meet', meet);
    const statsView = await readFreshView(ctx, meetKey(meet, 'stats'));
    if (statsView) {
      const { rows, club_counts } = readStatsViewItems(await statsView.items());
      // Counts are keyed by `clubKey`; a view built before that holds one per spelling.
      const key = clubKey(club);
      const count = club_counts.filter(([name]) => clubKey(name) === key).reduce((sum, [, n]) => sum + n, 0);
      return clubStats(rows, club, count);
    }
    // The meet's whole roster: every spelling of the club at this meet, one
    // first registered since the spellings view was built included.
    const [rows, roster] = await Promise.all([
      computeStatsRows(ctx, meet, club),
      ctx.db
        .query('athletes')
        .withIndex('by_meet', (q) => q.eq('meet', meet))
        .collect(),
    ]);
    return clubStats(rows, club, clubAthleteCount(roster, club));
  },
});
