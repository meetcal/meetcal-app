import { isAnything, isListOf, isNumber, isPairOf, isRecord, isString, isStringList, parsedAs, itemAt } from './lib/json';
import { MEMBER_REGISTRATIONS_MAX, STANDARDS_MAX, readAll } from './lib/boundedRead';
import { v } from 'convex/values';
import { checkPass, premiumQuery, premiumRead } from './lib/access';
import { chunks, mapLimited } from './lib/concurrency';
import { revalidated, revalidatedText } from './lib/etag';
import { action, type ActionCtx, internalQuery, query, type QueryCtx } from './_generated/server';
import { internal } from './_generated/api';
import { nameMatcher, queryBigrams, searchDirectory } from './lib/directory';
import { latestMeetBests, readHistories, readSummaries, type Mark, type Summary } from './lib/history';
import { addBests, type Candidate, checkLeaderboardArgs, fromCompactRow, joinSoleLifters, type LeaderboardRow, leaderboardRow, monthSlices, parseCompactRows, pruneBests, rankBests, toCompactRow, readCompactRow, unlinkedBestNames } from './lib/leaderboard';
import { soleLifter, soleLiftersOf, type SoleLifters } from './lib/lifterKeys';
import { checkEliteArgs, type EliteAnswer, type EliteMember, type EliteRegistration, type EliteStandard, isLinkedMemberOrNull, isMemberOf, latestRegistration, type LinkedMember, type MemberResult, ownerOfResult, rankAll, standardTables } from './lib/elite';
import { byNameThenNewest, computeMeetResults, meetResultTitles } from './lib/meetData';
import { editionSummaries, newestEditionFirst, type EditionSummary } from './lib/meetSummary';
import { editionMedals, needsRoster, type EditionMedals, type RosterEntry } from './lib/placings';
import { takeWithinBudget, tooLargeToRead, type DocumentBudget } from './lib/readBudget';
import {
  athleteResults,
  choiceOf,
  choicesInOrder,
  lifterById,
  lifterCard,
  lifterOfMembership,
  newestFirst,
  rowsByLifter,
  rowsOfLifter,
  unlinked,
  type AthleteAnswer,
} from './lib/lifterHistory';
import { cleanNameList, distinctNameKeys, newestSpelling, normalizeName, requestedNamesByKey } from './lib/names';
import {
  bestsSince,
  hasAnyBest,
  namedBests,
  toApiLiftingResult,
  ZERO_BESTS,
  type ApiLiftingResult,
  type NamedBests,
  type YearBests,
} from './lib/results';
import { compareBytes } from './lib/sort';
import { selectWrapped, type WrappedAnswer } from './lib/wrapped';
import { meetKey, RESULT_NAMES_VIEW, SEARCH_SHARD_SIZES_VIEW, searchShardKey } from './lib/viewKeys';
import { readFreshView, readViewJsonAnyAge, readViewTextAnyAge } from './lib/views';
import { apiError, requireIsoDate, requireNameList, requireNonEmpty, requirePresentIsoDate, requireTextList } from './lib/validation';

// `/lifting-results/*` and `/search`: each query answers the JSON of the Rust
// route of the same name. Per-athlete reads go through the athlete history
// documents (`lib/history.ts`): one document per name instead of one per
// result. Row lists travel as JSON text (`{ json }`).

export const MAX_LIMIT_PER_NAME = 200;

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

/** Results one `leaderboardPage` read covers. */
export const LEADERBOARD_PAGE_SIZE = 2000;
/** Month slices of a leaderboard's range read side by side, each its own cursor chain. */
export const LEADERBOARD_CONCURRENCY = 8;
/** Most pages one month slice is read in before the leaderboard gives up (2,000 rows each). */
export const LEADERBOARD_MAX_PAGES = 50;

const metricArg = v.union(v.literal('total'), v.literal('snatch'), v.literal('cj'), v.literal('sinclair'), v.literal('qpoints'));
const genderArg = v.union(v.literal('Men'), v.literal('Women'));

/** One page of a leaderboard's read: its rows as JSON text of `CompactRow`s. */
export type LeaderboardPage = { json: string; isDone: boolean; continueCursor: string };

/**
 * One page of the results dated `start` to `end`, by date, as compact rows
 * (`lib/leaderboard.ts`). It takes nothing about the leaderboard asked for
 * and reads no pass, so Convex caches each page once for every caller,
 * metric and filter: a past month's pages are read from the database once
 * until its results change.
 */
export const leaderboardPage = internalQuery({
  args: { start: v.string(), end: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { start, end, cursor }): Promise<LeaderboardPage> => {
    const result = await ctx.db
      .query('lifting_results')
      .withIndex('by_date', (q) => q.gte('date', start).lte('date', end))
      .paginate({ cursor, numItems: LEADERBOARD_PAGE_SIZE });
    return {
      json: JSON.stringify(result.page.map((row) => toCompactRow(toApiLiftingResult(row)))),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const SOLE_LIFTER_NAMES_PER_READ = 50;

export const soleLifters = internalQuery({
  args: { nameKeys: v.array(v.string()) },
  handler: async (ctx, { nameKeys }): Promise<[string, string][]> => [...(await soleLiftersOf(ctx, nameKeys.slice(0, SOLE_LIFTER_NAMES_PER_READ)))],
});

export async function readSoleLifters(ctx: ActionCtx, nameKeys: readonly string[]): Promise<SoleLifters> {
  const answers = await mapLimited(chunks(nameKeys, SOLE_LIFTER_NAMES_PER_READ), LEADERBOARD_CONCURRENCY, (batch) =>
    ctx.runQuery(internal.results.soleLifters, { nameKeys: batch }),
  );
  return new Map(answers.flat());
}

/** A leaderboard: `rows` best first, and the federations in the range (`federations`, sorted, non-blank). */
export type LeaderboardAnswer = { rows: LeaderboardRow[]; federations: string[] };

/**
 * The leaderboard of every athlete in a date range (`lib/leaderboard.ts`):
 * each athlete once, by their best `by` (`total`, `snatch`, `cj`, `sinclair`
 * or `qpoints`), best first, at most `limit` (default 50, at most 500).
 * Filters: `gender` (needed for `sinclair` and `qpoints`), `category`,
 * `division` (text it contains), `federation` (BWL is left out unless
 * asked for) and `adaptive` (left out unless true). The range spans less
 * than five years. Premium: an action (it reads every result in the range,
 * a page per internal query), so it takes the pass itself (`PREMIUM_ACTIONS`).
 */
export const leaderboard = action({
  args: {
    from: v.string(),
    to: v.string(),
    by: metricArg,
    gender: v.optional(genderArg),
    category: v.optional(v.string()),
    division: v.optional(v.string()),
    federation: v.optional(v.string()),
    adaptive: v.optional(v.boolean()),
    limit: v.optional(v.number()),
    pass: v.optional(v.string()),
  },
  handler: async (ctx, { pass, ...args }): Promise<LeaderboardAnswer> => {
    checkPass('results:leaderboard', pass, await ctx.runQuery(internal.accessPass.passes, {}));
    const { from, to, by, limit, filters } = checkLeaderboardArgs(args);
    const slices = monthSlices(from, to);
    const best = new Map<string, Candidate>();
    const federations = new Set<string>();
    const readSlice = async ([start, end]: (typeof slices)[number]) => {
      let cursor: string | null = null;
      for (let pages = 0; pages < LEADERBOARD_MAX_PAGES; pages++) {
        const page: LeaderboardPage = await ctx.runQuery(internal.results.leaderboardPage, { start, end, cursor });
        const rows = parseCompactRows(page.json);
        for (const row of rows) federations.add(row.federation);
        addBests(best, rows, by, filters);
        pruneBests(best, limit);
        if (page.isDone) return;
        cursor = page.continueCursor;
      }
      throw apiError(500, `results from ${start} to ${end} did not finish within ${LEADERBOARD_MAX_PAGES} pages`);
    };
    await mapLimited(slices, LEADERBOARD_CONCURRENCY, readSlice);
    const sole = await readSoleLifters(ctx, unlinkedBestNames(best));
    return {
      rows: rankBests(joinSoleLifters(best, sole).values(), limit).map(leaderboardRow),
      federations: [...federations].filter((federation) => federation.trim() !== '').sort(compareBytes),
    };
  },
});

// ---------------------------------------------------------------------------
// WSO elite lists
// ---------------------------------------------------------------------------

/** Registrations one `eliteRegistrations` read covers. */
export const ELITE_REGISTRATION_PAGE_SIZE = 2000;
/** Most pages of a WSO's registrations read before the action gives up. */
export const ELITE_MAX_REGISTRATION_PAGES = 50;
/** Members one `eliteMembers` read looks up (their registrations, and those meets' dates). */
export const ELITE_MEMBER_BATCH = 100;
/** Histories one `eliteResults` read covers. */
export const ELITE_HISTORY_BATCH = 50;
/** Member and history reads run side by side. */
export const ELITE_CONCURRENCY = 8;

/** One page of a WSO's registrations: the distinct member ids on it, as JSON text. */
export const eliteRegistrations = internalQuery({
  args: { wso: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { wso, cursor }): Promise<LeaderboardPage> => {
    const page = await ctx.db
      .query('athletes')
      .withIndex('by_wso', (q) => q.eq('wso', wso))
      .paginate({ cursor, numItems: ELITE_REGISTRATION_PAGE_SIZE });
    return { json: JSON.stringify([...new Set(page.page.map((row) => row.memberId))]), isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

export const eliteMembers = internalQuery({
  args: { memberIds: v.array(v.string()) },
  handler: async (ctx, { memberIds }): Promise<string> => {
    const meetDates = new Map<string, Promise<string>>();
    const meetDate = (meet: string) => {
      let date = meetDates.get(meet);
      if (date === undefined) {
        date = ctx.db
          .query('meets')
          .withIndex('by_name', (q) => q.eq('name', meet))
          .first()
          .then((row) => row?.startDate ?? '');
        meetDates.set(meet, date);
      }
      return date;
    };
    const members = await Promise.all(
      memberIds.map(async (memberId): Promise<[string, { member: EliteMember; lifter: string | null } | null]> => {
        const rows = await readAll(
          ctx.db
            .query('athletes')
            .withIndex('by_memberId', (q) => q.eq('memberId', memberId)),
          MEMBER_REGISTRATIONS_MAX,
          'registrations of one member',
        );
        const registrations = await Promise.all(
          rows.map(async (row): Promise<EliteRegistration> => ({
            name: row.name,
            wso: row.wso ?? '',
            gender: row.gender,
            age: row.age,
            meet: row.meet,
            meetDate: await meetDate(row.meet),
            created: row._creationTime,
          })),
        );
        const member = latestRegistration(registrations);
        return [memberId, member === null ? null : { member, lifter: await lifterOfMembership(ctx, memberId) }];
      }),
    );
    return JSON.stringify(members);
  },
});

export type EliteNameResults = { sole: string | null; linked: boolean; rows: unknown[] };

const isEliteNameResults = (value: unknown): value is EliteNameResults =>
  isRecord(value) && (value.sole === null || typeof value.sole === 'string') && typeof value.linked === 'boolean' && Array.isArray(value.rows);

export const eliteResults = internalQuery({
  args: { keys: v.array(v.string()), from: v.string(), to: v.string() },
  handler: async (ctx, { keys, from, to }): Promise<string> => {
    const histories = await readHistories(ctx, keys);
    const pairs = [...histories].map(([key, rows]): [string, EliteNameResults] => [
      key,
      {
        sole: soleLifter(rows),
        linked: rows.some((row) => row.lifter_id !== undefined),
        rows: rows.filter((row) => row.federation === 'USAW' && row.date >= from && row.date <= to).map(toCompactRow),
      },
    ]);
    return JSON.stringify(pairs);
  },
});

/** Every stored A standard. */
export const eliteStandards = internalQuery({
  args: {},
  handler: async (ctx): Promise<EliteStandard[]> =>
    (await readAll(ctx.db.query('standards'), STANDARDS_MAX, 'standards')).map(({ ageCategory, gender, weightClass, standardA }) => ({ ageCategory, gender, weightClass, standardA })),
});


const eliteMethodArg = v.union(v.literal('percentA'), v.literal('qpoints'), v.literal('qmasters'), v.literal('sinclair'));

/**
 * A WSO's elite lists (`lib/elite.ts`): the top 20 men and women Overall,
 * Youth, Junior, Senior and Masters over `from` to `to` (under five years),
 * each list scored by its `methods` entry (`ELITE_METHOD_CHOICES`, defaulted
 * per list) as `lists`, and by every method it offers as `rankings`.
 * Members are the athletes whose latest registration naming a WSO names this
 * one (spelled as registrations spell it: `reference:registrationWsos`).
 * Premium: an action (it reads every member's registrations and history in
 * batches), so it takes the pass itself (`PREMIUM_ACTIONS`).
 */
export const wsoElite = action({
  args: {
    wso: v.string(),
    from: v.string(),
    to: v.string(),
    methods: v.optional(
      v.object({
        overall: v.optional(eliteMethodArg),
        youth: v.optional(eliteMethodArg),
        junior: v.optional(eliteMethodArg),
        senior: v.optional(eliteMethodArg),
        masters: v.optional(eliteMethodArg),
      }),
    ),
    pass: v.optional(v.string()),
  },
  handler: async (ctx, { pass, ...args }): Promise<EliteAnswer> => {
    checkPass('results:wsoElite', pass, await ctx.runQuery(internal.accessPass.passes, {}));
    const { wso, from, to, methods } = checkEliteArgs(args);

    const memberIds = new Set<string>();
    let cursor: string | null = null;
    for (let pages = 0; ; pages++) {
      if (pages === ELITE_MAX_REGISTRATION_PAGES) throw apiError(500, `${wso}'s registrations did not finish within ${ELITE_MAX_REGISTRATION_PAGES} pages`);
      const page: LeaderboardPage = await ctx.runQuery(internal.results.eliteRegistrations, { wso, cursor });
      for (const id of parsedAs(page.json, isStringList, 'a page of registrations')) memberIds.add(id);
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    if (memberIds.size === 0) throw apiError(404, `No registrations found for WSO "${wso}"`);

    const looked = await mapLimited(chunks([...memberIds], ELITE_MEMBER_BATCH), ELITE_CONCURRENCY, async (ids) =>
      parsedAs(await ctx.runQuery(internal.results.eliteMembers, { memberIds: ids }), isListOf(isPairOf(isString, isLinkedMemberOrNull)), 'a batch of members'),
    );
    const membersByKey = new Map<string, LinkedMember[]>();
    let members = 0;
    for (const [memberKey, linked] of looked.flat()) {
      if (linked === null || !isMemberOf(linked.member, wso)) continue;
      members += 1;
      const key = normalizeName(linked.member.name);
      membersByKey.set(key, [...(membersByKey.get(key) ?? []), { memberKey, ...linked }]);
    }

    const [standards, read] = await Promise.all([
      ctx.runQuery(internal.results.eliteStandards, {}),
      mapLimited(chunks([...membersByKey.keys()], ELITE_HISTORY_BATCH), ELITE_CONCURRENCY, async (keys) =>
        parsedAs(await ctx.runQuery(internal.results.eliteResults, { keys, from, to }), isListOf(isPairOf(isString, isEliteNameResults)), 'a batch of results'),
      ),
    ]);
    const results: (MemberResult & { memberKey: string })[] = [];
    for (const [key, { sole, linked, rows }] of read.flat()) {
      const named = membersByKey.get(key) ?? [];
      for (const compact of rows) {
        const row = fromCompactRow(readCompactRow(compact));
        const owner = ownerOfResult(named, row, sole, linked);
        if (owner) results.push({ row, memberKey: owner.memberKey, member: owner.member });
      }
    }

    return { wso, from, to, members, ...rankAll(results, methods, standardTables(standards)) };
  },
});

export const byMeet = premiumQuery('results:byMeet', {
  args: { meet: v.string(), ifNoneMatch: v.optional(v.string()) },
  handler: async (ctx, { meet, ifNoneMatch }) => {
    requireNonEmpty('meet', meet);
    const view = await readFreshView(ctx, meetKey(meet, 'results'));
    if (view) return await revalidatedText(view.etag, view.json, ifNoneMatch);
    return revalidated(await computeMeetResults(ctx, meet), ifNoneMatch);
  },
});

export const MAX_MEDAL_MEETS = 10;
export const MAX_MEDAL_MEMBERS = 2000;
export const MAX_SUMMARY_MEETS = 4;
export const MEET_ROWS_READ_BUDGET = 30000;

async function rowsWithinBudget<T>(budget: DocumentBudget, meets: readonly string[], take: (limit: number) => Promise<T[]>): Promise<T[]> {
  const rows = await takeWithinBudget(budget, take);
  if (rows === null) throw apiError(413, tooLargeToRead(meets), { max: MEET_ROWS_READ_BUDGET });
  return rows;
}

async function resultRowsOfTitles(ctx: QueryCtx, titles: readonly string[], budget: DocumentBudget, meets: readonly string[]): Promise<ApiLiftingResult[]> {
  const rows: ApiLiftingResult[] = [];
  for (const title of titles) {
    const docs = await rowsWithinBudget(budget, meets, (limit) =>
      ctx.db
        .query('lifting_results')
        .withIndex('by_meet', (q) => q.eq('meet', title))
        .take(limit),
    );
    rows.push(...docs.map(toApiLiftingResult));
  }
  return rows;
}

async function titlesSpelledLike(ctx: QueryCtx, meets: readonly string[]): Promise<string[]> {
  const titles = new Set<string>();
  for (const meet of meets) {
    const key = normalizeName(meet);
    for (const title of await meetResultTitles(ctx, meet)) if (normalizeName(title) === key) titles.add(title);
  }
  return [...titles];
}

export const groupMedals = premiumQuery('results:groupMedals', {
  args: { meets: v.array(v.string()), members: v.array(v.string()) },
  handler: async (ctx, { meets, members }): Promise<EditionMedals[]> => {
    requireTextList('meets', meets, MAX_MEDAL_MEETS);
    requireTextList('members', members, MAX_MEDAL_MEMBERS);
    const budget: DocumentBudget = { left: MEET_ROWS_READ_BUDGET };
    const results = await resultRowsOfTitles(ctx, await titlesSpelledLike(ctx, meets), budget, meets);
    const roster: RosterEntry[] = [];
    if (needsRoster(results)) {
      for (const meet of new Set(meets)) {
        roster.push(
          ...(await rowsWithinBudget(budget, meets, (limit) =>
            ctx.db
              .query('athletes')
              .withIndex('by_meet', (q) => q.eq('meet', meet))
              .take(limit),
          )),
        );
      }
    }
    return editionMedals(results, roster, members);
  },
});

export const meetSummaries = premiumQuery('results:meetSummaries', {
  args: { meets: v.array(v.string()) },
  handler: async (ctx, { meets }): Promise<EditionSummary[]> => {
    requireTextList('meets', meets, MAX_SUMMARY_MEETS);
    const budget: DocumentBudget = { left: MEET_ROWS_READ_BUDGET };
    const summaries: EditionSummary[] = [];
    for (const meet of new Set(meets)) {
      const rows = await resultRowsOfTitles(ctx, await meetResultTitles(ctx, meet), budget, [meet]);
      rows.sort(byNameThenNewest);
      summaries.push(...editionSummaries(meet, rows));
    }
    return summaries.sort(newestEditionFirst);
  },
});

/** A newest-first history cut at `cutoff` (inclusive). */
function since(history: readonly ApiLiftingResult[], cutoff: string): ApiLiftingResult[] {
  const rows: ApiLiftingResult[] = [];
  for (const row of history) {
    if (row.date < cutoff) break;
    rows.push(row);
  }
  return rows;
}

type Histories = Map<string, ApiLiftingResult[]>;

export function answerByNames(histories: Histories, latestOnly: boolean, limit: number | undefined): string {
  const rows: ApiLiftingResult[] = [];
  for (const history of histories.values()) {
    let kept = history;
    if (latestOnly && kept.length > 0) kept = kept.filter((row) => row.date === itemAt(history, 0).date);
    if (limit !== undefined) kept = kept.slice(0, limit);
    rows.push(...kept);
  }
  return JSON.stringify(newestFirst(rows));
}

export function answerRecent(histories: Histories, cutoff: string): string {
  const rows: ApiLiftingResult[] = [];
  for (const history of histories.values()) rows.push(...since(history, cutoff));
  return JSON.stringify(newestFirst(rows));
}

export function answerBests(summaries: Map<string, Summary>, names: readonly string[], cutoff: string): NamedBests[] {
  const bestByKey = new Map<string, YearBests>();
  for (const [key, { marks }] of summaries) {
    const bests = bestsSince(marks, cutoff);
    if (bests) bestByKey.set(key, bests);
  }
  return namedBests(names, bestByKey);
}

export type NamedBestsOrLatest = NamedBests & { latest?: true };

export function answerBestsOrLatest(summaries: Map<string, Summary>, names: readonly string[], cutoff: string): NamedBestsOrLatest[] {
  return answerBests(summaries, names, cutoff).map((row) => {
    if (hasAnyBest(row)) return row;
    const latest = summaries.get(normalizeName(row.name))?.latest ?? [];
    return { ...row, ...(latestMeetBests(latest) ?? ZERO_BESTS), latest: true };
  });
}

export function answerYearBests(marks: readonly Mark[], cutoff: string): YearBests {
  return bestsSince(marks, cutoff) ?? ZERO_BESTS;
}

/** `answerByNames` with `latestOnly`, from the summaries' latest rows. */
export function answerLatest(summaries: Map<string, Summary>, limit: number | undefined): string {
  const rows: ApiLiftingResult[] = [];
  for (const { latest } of summaries.values()) rows.push(...(limit === undefined ? latest : latest.slice(0, limit)));
  return JSON.stringify(newestFirst(rows));
}

function checkLimit(limit: number | undefined): void {
  if (limit !== undefined && !(Number.isInteger(limit) && limit >= 1 && limit <= MAX_LIMIT_PER_NAME)) {
    throw apiError(400, `limit_per_name must be between 1 and ${MAX_LIMIT_PER_NAME}`);
  }
}

/**
 * `POST /lifting-results/by-names`: every result for the names, newest first.
 * `latestOnly` keeps each athlete's most recent meet date; `limitPerName`
 * caps each athlete's rows (newest first). Answers `{ json }`.
 */
export const byNames = premiumQuery('results:byNames', {
  args: {
    names: v.array(v.string()),
    latestOnly: v.optional(v.boolean()),
    limitPerName: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const names = cleanNameList(args.names);
    requireNameList(names);
    checkLimit(args.limitPerName);
    const keys = distinctNameKeys(names);
    if (args.latestOnly) return { json: answerLatest(await readSummaries(ctx, keys), args.limitPerName) };
    return { json: answerByNames(await readHistories(ctx, keys), false, args.limitPerName) };
  },
});

/** `POST /lifting-results/recent`: results since `cutoffDate`, newest first. Answers `{ json }`. */
export const recent = premiumQuery('results:recent', {
  args: { names: v.array(v.string()), cutoffDate: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const names = cleanNameList(args.names);
    requireNameList(names);
    const cutoff = requirePresentIsoDate('cutoff_date', args.cutoffDate);
    return { json: answerRecent(await readHistories(ctx, distinctNameKeys(names)), cutoff) };
  },
});

/** `GET /lifting-results/year`: one athlete's bests since `cutoffDate`. */
export const yearBests = premiumQuery('results:yearBests', {
  args: { name: v.string(), cutoffDate: v.optional(v.string()) },
  handler: async (ctx, args): Promise<YearBests> => {
    requireNonEmpty('name', args.name);
    const cutoff = requirePresentIsoDate('cutoff_date', args.cutoffDate);
    const key = normalizeName(args.name);
    return answerYearBests((await readSummaries(ctx, [key])).get(key)?.marks ?? [], cutoff);
  },
});

export const bests = premiumQuery('results:bests', {
  args: { names: v.array(v.string()), cutoffDate: v.optional(v.string()), latestWhenEmpty: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<NamedBests[] | NamedBestsOrLatest[]> => {
    const names = cleanNameList(args.names);
    requireNameList(names);
    const cutoff = requirePresentIsoDate('cutoff_date', args.cutoffDate);
    const summaries = await readSummaries(ctx, [...requestedNamesByKey(names).keys()]);
    if (args.latestWhenEmpty) return answerBestsOrLatest(summaries, names, cutoff);
    return answerBests(summaries, names, cutoff);
  },
});

export const athlete = premiumQuery('results:athlete', {
  args: {
    name: v.string(),
    lifter: v.optional(v.string()),
    membership: v.optional(v.string()),
    other: v.optional(v.boolean()),
    cutoffDate: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<AthleteAnswer> => {
    requireNonEmpty('name', args.name);
    requireIsoDate('cutoff_date', args.cutoffDate);
    const year = new Date(Date.now()).getUTCFullYear();
    const nameKey = normalizeName(args.name);
    const lifterAnswer = async (athleteId: string) => {
      const [lifter, rows] = await Promise.all([lifterById(ctx, athleteId), rowsOfLifter(ctx, athleteId, [nameKey])]);
      return athleteResults(lifterCard(athleteId, lifter, rows, year), rows, args.cutoffDate);
    };
    if (args.lifter !== undefined) {
      requireNonEmpty('lifter', args.lifter);
      return await lifterAnswer(args.lifter);
    }
    const history = (await readHistories(ctx, [nameKey])).get(nameKey) ?? [];
    if (args.other === true) return athleteResults(null, history.filter(unlinked), args.cutoffDate);
    const member = args.membership === undefined ? null : await lifterOfMembership(ctx, args.membership);
    if (member !== null) return await lifterAnswer(member);
    const byLifter = rowsByLifter(history);
    const otherResults = history.filter(unlinked).length;
    const [only] = byLifter.keys();
    if (only === undefined) return athleteResults(null, history, args.cutoffDate);
    if (byLifter.size === 1 && otherResults === 0) return await lifterAnswer(only);
    const choices = await Promise.all(
      [...byLifter].map(async ([athleteId, rows]) => choiceOf(lifterCard(athleteId, await lifterById(ctx, athleteId), rows, year), rows)),
    );
    return { kind: 'choose', name: newestSpelling(history) ?? args.name, lifters: choicesInOrder(choices), other_results: otherResults };
  },
});

// ---------------------------------------------------------------------------
// `GET /search`
// ---------------------------------------------------------------------------

/**
 * The most results one `results:search` answer holds. When more match, it
 * keeps the most recent and says so (`truncated`).
 */
export const MAX_SEARCH_RESULT_ROWS = 600;
const MAX_SEARCH_SUGGESTIONS = 8;
/**
 * A one- or two-letter query matches most of the directory. Postgres scans the
 * table for those; here the fallback reads the first this-many matching
 * athletes in name order.
 */
const MAX_FALLBACK_NAMES = 1000;

async function directory(ctx: QueryCtx): Promise<string> {
  const text = await readViewTextAnyAge(ctx, RESULT_NAMES_VIEW);
  if (text === null) throw apiError(503, 'search directory is not built yet');
  return text;
}

/**
 * The names a query can match: the shard of its rarest two-letter sequence
 * when it has one (`lib/directory.ts`), otherwise the whole directory. A
 * sequence no name contains means no match at all.
 */
async function searchText(ctx: QueryCtx, query: string): Promise<string> {
  const bigrams = queryBigrams(query);
  if (bigrams) {
    const sizesText = await readViewJsonAnyAge(ctx, SEARCH_SHARD_SIZES_VIEW);
    if (sizesText !== null) {
      const sizes = new Map(parsedAs(sizesText, isListOf(isPairOf(isString, isNumber)), 'the search shard sizes'));
      let rarest: string | null = null;
      for (const bigram of bigrams) {
        const size = sizes.get(bigram) ?? 0;
        if (size === 0) return '';
        if (rarest === null || size < (sizes.get(rarest) ?? 0)) rarest = bigram;
      }
      if (rarest !== null) {
        const shard = await readViewTextAnyAge(ctx, searchShardKey(rarest));
        if (shard !== null) return shard;
      }
    }
  }
  return await directory(ctx);
}

/** Rows dated `start` to `end`, both inclusive, oldest first. */
function inRange(history: readonly ApiLiftingResult[], start: string, end: string): ApiLiftingResult[] {
  return history.filter((row) => row.date >= start && row.date <= end).reverse();
}

/**
 * A `results:search` answer. `truncated` says more results match than it
 * holds: it keeps the most recent `MAX_SEARCH_RESULT_ROWS`, and a client
 * should ask for a narrower search to see the rest.
 */
export type SearchAnswer = {
  matched_name: string | null;
  suggestions: string[];
  results: ApiLiftingResult[];
  truncated: boolean;
};

/** Oldest-first `rows` cut to the most recent `MAX_SEARCH_RESULT_ROWS`, still oldest first. */
function mostRecent(rows: ApiLiftingResult[]): { results: ApiLiftingResult[]; truncated: boolean } {
  if (rows.length <= MAX_SEARCH_RESULT_ROWS) return { results: rows, truncated: false };
  return { results: rows.slice(rows.length - MAX_SEARCH_RESULT_ROWS), truncated: true };
}

export function exactSearchAnswer(
  history: readonly ApiLiftingResult[],
  start: string,
  end: string,
): SearchAnswer | null {
  const rows = inRange(history, start, end);
  const matchedName = newestSpelling(rows);
  if (matchedName === null) return null;
  return { matched_name: matchedName, suggestions: [], ...mostRecent(rows) };
}

/**
 * Every matching name's results in the range, oldest first, from the
 * histories of `matched` (the directory's first `MAX_FALLBACK_NAMES` matches;
 * reaching that many means more names may match, so the answer is truncated).
 */
export function fallbackSearchAnswer(
  query: string,
  matched: readonly string[],
  histories: Histories,
  start: string,
  end: string,
): SearchAnswer {
  const matches = nameMatcher(query);
  const rows: ApiLiftingResult[] = [];
  for (const history of histories.values()) {
    for (const row of inRange(history, start, end)) {
      if (matches(row.name)) rows.push(row);
    }
  }
  rows.sort((a, b) => compareBytes(a.date, b.date));
  const { results, truncated } = mostRecent(rows);
  return {
    matched_name: null,
    suggestions: matched.slice(0, MAX_SEARCH_SUGGESTIONS),
    results,
    truncated: truncated || matched.length >= MAX_FALLBACK_NAMES,
  };
}

/**
 * `GET /search`: without dates, name suggestions (`ILIKE '%query%'`). With
 * dates (`startDate` to `endDate`, both inclusive), the exact (case- and
 * whitespace-folded) name's results in the range, or, failing that, every
 * matching name's results plus suggestions. Results are oldest first, at most
 * `MAX_SEARCH_RESULT_ROWS` of them; see `SearchAnswer`.
 */
export const search = query({
  args: {
    query: v.string(),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    // The access pass (`lib/access.ts`), for results.
    pass: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SearchAnswer> => {
    requireNonEmpty('query', args.query);
    requireIsoDate('start_date', args.startDate);
    requireIsoDate('end_date', args.endDate);
    const matchingNames = async (limit: number) => searchDirectory(await searchText(ctx, args.query), args.query, limit);

    if (args.startDate === undefined || args.endDate === undefined) {
      return { matched_name: null, suggestions: await matchingNames(MAX_SEARCH_SUGGESTIONS), results: [], truncated: false };
    }
    // Results are premium; name suggestions alone are not.
    await premiumRead(ctx, 'results:search', args.pass);
    if (args.endDate < args.startDate) throw apiError(400, 'end_date must not be before start_date');
    return await datedSearch(ctx, args.query, args.startDate, args.endDate);
  },
});

/**
 * The dated search behind `search` and `wrapped`: the exact (folded) name's
 * results in the range, or, failing that, every matching name's results plus
 * suggestions. With `exactOnly`, no fallback: just the suggestions.
 */
async function datedSearch(
  ctx: QueryCtx,
  query: string,
  start: string,
  end: string,
  {
    exactOnly = false,
    fallbackNames = MAX_FALLBACK_NAMES,
    fallbackForKnownName = true,
  }: { exactOnly?: boolean; fallbackNames?: number; fallbackForKnownName?: boolean } = {},
): Promise<SearchAnswer> {
  const exactKey = normalizeName(query);
  const history = (await readHistories(ctx, [exactKey])).get(exactKey) ?? [];
  const exact = exactSearchAnswer(history, start, end);
  if (exact) return exact;
  // `exactOnly`, or (unless `fallbackForKnownName`) the exact name is an
  // athlete with no results in the range: no fallback, which would show
  // someone else.
  if (exactOnly || (!fallbackForKnownName && history.length > 0)) {
    const suggestions = searchDirectory(await searchText(ctx, query), query, MAX_SEARCH_SUGGESTIONS);
    return { matched_name: null, suggestions, results: [], truncated: false };
  }
  const matched = searchDirectory(await searchText(ctx, query), query, fallbackNames);
  // As many names as the cap: more may match. Ask for more of the name before reading their histories.
  if (fallbackNames < MAX_FALLBACK_NAMES && matched.length >= fallbackNames) {
    return { matched_name: null, suggestions: matched.slice(0, MAX_SEARCH_SUGGESTIONS), results: [], truncated: true };
  }
  return fallbackSearchAnswer(query, matched, await readHistories(ctx, distinctNameKeys(matched)), start, end);
}

/** The earliest and latest years `wrapped` answers for. */
export const WRAPPED_YEARS = { first: 1900, last: 2100 } as const;
/**
 * The most names a Wrapped's name-contains fallback reads histories for. It
 * offers at most `MAX_WRAPPED_NAME_CHOICES`; a query matching more names asks
 * for more of the name before reading any history, which keeps this public
 * query cheap.
 */
export const WRAPPED_FALLBACK_NAMES = 100;

/**
 * Weightlifting Wrapped for `query`'s calendar `year` (`lib/wrapped.ts`): the
 * year's stats, never the results behind them, so it is free and public.
 * Answers `{ kind }`: `athlete` with `name` and `stats`, `ambiguous` with the
 * `names` to pick from (ask again with `picked`, which only takes the exact
 * name), `narrow`, `tooManyResults`, or `none` with name `suggestions`.
 */
export const wrapped = query({
  args: { query: v.string(), year: v.number(), picked: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<WrappedAnswer> => {
    requireNonEmpty('query', args.query);
    if (!Number.isInteger(args.year) || args.year < WRAPPED_YEARS.first || args.year > WRAPPED_YEARS.last) {
      throw apiError(400, 'year must be a four-digit year');
    }
    const answer = await datedSearch(ctx, args.query, `${args.year}-01-01`, `${args.year}-12-31`, {
      exactOnly: args.picked === true,
      fallbackNames: WRAPPED_FALLBACK_NAMES,
      fallbackForKnownName: false,
    });
    return selectWrapped(answer);
  },
});
