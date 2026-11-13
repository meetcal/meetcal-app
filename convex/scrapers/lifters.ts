'use node';

import { v } from 'convex/values';
import { errorMessage } from '../lib/errors';
import { internalAction, type ActionCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { MAX_LIFTER_SIGHTINGS, MAX_LINK_NAMES, MAX_QUEUED_RELINK_NAMES } from '../ingest';
import { MAX_LIFTER_NAME_LOOKUPS, type LifterName, type UnlinkedResult } from '../lifters';
import { sourcesFailed, type SourceFailure } from '../lib/cronAlerts';
import { DAY_MS, daysBetween, isoDateOf, isoDaysAfter } from '../lib/dates';
import { condenseSightings, isSport80Result, needsSourceHistories, SAME_MEET_TOLERANCE_DAYS, SOURCE_DATE_TOLERANCE_DAYS, type SourceResult } from '../lib/lifters';
import { chunks, mapLimited } from '../lib/concurrency';
import { logInLines } from '../lib/logLines';
import { itemAt } from '../lib/json';
import { Sport80, Sport80HttpError, type RankingsReading } from './lib/sport80Api';
import { formatAthleteResults, lifterSighting, rankingClasses, rankingClassIds, type LifterSighting, type RankingClass } from './parse/sport80';
import { compareBytes } from '../lib/sort';
import { isDatedResult } from '../lib/results';

export const SPORT80_CONCURRENCY = 4;
export const SIGHTINGS_PER_STORE = Math.min(100, MAX_LIFTER_SIGHTINGS);
export const NAMES_PER_LINK = Math.min(10, MAX_LINK_NAMES);
export const BACKFILL_CLASSES_PER_RUN = 30;
export const BACKFILL_RUN_BUDGET_MS = 3 * 60 * 1000;
export const BACKFILL_READ_STOP_MS = 6 * 60 * 1000;
export const NIGHTLY_READ_BUDGET_MS = 3 * 60 * 1000;
export const NIGHTLY_LINK_BUDGET_MS = 3 * 60 * 1000;
export const RECENT_INSERT_DAYS = 10;
export const IN_FLIGHT_WRITE_MS = 10 * 60 * 1000;
export const BACKFILL_FROM = '1900-01-01';
export const MAX_REPORTED_FAILURES = 200;

export type LinkCounts = { history: number; fit: number; unlinked: number; changed: number };

const NO_LINKS: LinkCounts = { history: 0, fit: 0, unlinked: 0, changed: 0 };

const addCounts = (a: LinkCounts, b: LinkCounts): LinkCounts => ({
  history: a.history + b.history,
  fit: a.fit + b.fit,
  unlinked: a.unlinked + b.unlinked,
  changed: a.changed + b.changed,
});

const today = () => isoDateOf(Date.now());

export async function readSightings(
  api: Sport80,
  classes: readonly RankingClass[],
  from: string,
  to: string,
  failures: SourceFailure[],
  { deadline = Infinity, reading = {} }: { deadline?: number; reading?: RankingsReading } = {},
): Promise<{ sightings: LifterSighting[]; unread: Set<number>; late: number }> {
  const unread = new Set<number>();
  let late = 0;
  const read = await mapLimited(classes, SPORT80_CONCURRENCY, async (rankingClass) => {
    const source = `rankings ${rankingClass.label} (class ${rankingClass.id})`;
    if (Date.now() >= deadline) {
      unread.add(rankingClass.id);
      late += 1;
      return [];
    }
    try {
      const rows = await api.rankings(rankingClass.id, from, to, reading);
      const sightings = rows.map(lifterSighting).filter((s): s is LifterSighting => s !== null);
      if (rows.length > 0 && sightings.length === 0) {
        failures.push({ source, error: `none of ${rows.length} rows readable (payload changed?)` });
        unread.add(rankingClass.id);
      }
      return sightings;
    } catch (error) {
      failures.push({ source, error: errorMessage(error) });
      unread.add(rankingClass.id);
      return [];
    }
  });
  if (late > 0) failures.push({ source: 'rankings', error: `${late} of ${classes.length} classes not read in time; read on the next run` });
  return { sightings: read.flat(), unread, late };
}

export function byAthleteBatches(sightings: readonly LifterSighting[]): LifterSighting[][] {
  const byAthlete = new Map<string, LifterSighting[]>();
  for (const sighting of sightings) byAthlete.set(sighting.athleteId, [...(byAthlete.get(sighting.athleteId) ?? []), sighting]);
  const batches: LifterSighting[][] = [];
  let batch: LifterSighting[] = [];
  for (const group of byAthlete.values()) {
    if (batch.length > 0 && batch.length + group.length > SIGHTINGS_PER_STORE) {
      batches.push(batch);
      batch = [];
    }
    batch.push(...group);
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

async function storeSightings(ctx: ActionCtx, sightings: readonly LifterSighting[], queueRelinks: boolean): Promise<string[]> {
  const results: { changedKeys: string[] }[] = await mapLimited(byAthleteBatches(condenseSightings(sightings)), SPORT80_CONCURRENCY, (batch) =>
    ctx.runMutation(internal.ingest.upsertLifters, { sightings: batch, queueRelinks }),
  );
  return [...new Set(results.flatMap((result) => result.changedKeys))];
}

export const MISSING_ATHLETE_STATUS = 404;

export async function sourceHistory(api: Sport80, athleteId: string): Promise<SourceResult[] | null> {
  let items: Record<string, unknown>[];
  try {
    items = await api.athleteResults(athleteId);
  } catch (error) {
    if (error instanceof Sport80HttpError && error.status === MISSING_ATHLETE_STATUS) return null;
    throw error;
  }
  const rows = formatAthleteResults(items);
  const results: SourceResult[] = [];
  for (const row of rows) {
    if (row.name === null || row.age === null) continue;
    results.push({ date: row.date, meet: row.meet, age: row.age, total: row.total ?? 0, snatchBest: row.snatchBest ?? 0, cjBest: row.cjBest ?? 0 });
  }
  if (rows.length > 0 && results.length === 0) throw new Error(`none of its ${rows.length} history rows readable (payload changed?)`);
  return results;
}

type NameToLink = { nameKey: string; histories?: { athleteId: string; results: SourceResult[] }[] };

export type Sport80Connection = () => Promise<Sport80>;

export function connectOnce(): Sport80Connection {
  let connection: Promise<Sport80> | null = null;
  return () => (connection ??= Sport80.connect());
}

function warnLinkedByFitAlone(names: readonly Pick<LifterName, 'nameKey' | 'athleteIds'>[]): void {
  logInLines(
    `lifters: Sport80 has no such athlete, so these lifters' USAW results stay unlinked and other federations' are linked by fit:`,
    names.map((name) => `${name.nameKey} (athlete ${name.athleteIds.join(', ')})`),
    console.warn,
  );
}

export type HistoryReads = { answered: boolean; allMissing: LifterName[] };

export const newHistoryReads = (): HistoryReads => ({ answered: false, allMissing: [] });

async function withHistories(
  sport80: Sport80Connection,
  name: LifterName,
  failures: SourceFailure[],
  reads: HistoryReads,
  deadline: number,
): Promise<NameToLink | null> {
  if (!needsSourceHistories(name.athleteIds.length, name.sport80Results)) return { nameKey: name.nameKey };
  const read: { athleteId: string; results: SourceResult[] | null }[] = [];
  for (const athleteId of name.athleteIds) {
    if (Date.now() >= deadline) return null;
    try {
      const results = await sourceHistory(await sport80(), athleteId);
      if (results !== null) reads.answered = true;
      read.push({ athleteId, results });
    } catch (error) {
      failures.push({ source: `history of ${name.nameKey} (athlete ${athleteId})`, error: errorMessage(error) });
      return null;
    }
  }
  const missing = read.filter((history) => history.results === null).map((history) => history.athleteId);
  if (missing.length === read.length && !reads.answered) {
    reads.allMissing.push(name);
    return null;
  }
  if (missing.length > 0) warnLinkedByFitAlone([{ nameKey: name.nameKey, athleteIds: missing }]);
  return { nameKey: name.nameKey, histories: read.map(({ athleteId, results }) => ({ athleteId, results: results ?? [] })) };
}

async function queueFailedRelinks(ctx: ActionCtx, nameKeys: readonly string[]): Promise<void> {
  for (const batch of chunks(nameKeys, MAX_QUEUED_RELINK_NAMES)) await ctx.runMutation(internal.ingest.queueLifterRelinks, { nameKeys: batch });
}

export async function relink(
  ctx: ActionCtx,
  sport80: Sport80Connection,
  names: readonly LifterName[],
  failures: SourceFailure[],
  dryRun: boolean,
  reads: HistoryReads,
  deadline = Infinity,
): Promise<LinkCounts> {
  let counts = NO_LINKS;
  const unfinished: string[] = [];
  for (const batch of chunks(names, NAMES_PER_LINK)) {
    if (Date.now() >= deadline) {
      unfinished.push(...batch.map((name) => name.nameKey));
      continue;
    }
    const prepared = await mapLimited(batch, SPORT80_CONCURRENCY, (name) => withHistories(sport80, name, failures, reads, deadline));
    const ready = prepared.filter((name): name is NameToLink => name !== null);
    unfinished.push(...batch.filter((_, i) => prepared[i] === null).map((name) => name.nameKey));
    if (ready.length === 0) continue;
    const result: LinkCounts & { stale: string[] } = await ctx.runMutation(internal.ingest.linkLifterResults, { names: ready, dryRun });
    for (const nameKey of result.stale) failures.push({ source: `links of ${nameKey}`, error: 'its lifters changed while their histories were read; queued for the next run' });
    unfinished.push(...result.stale);
    counts = addCounts(counts, result);
  }
  if (!dryRun && unfinished.length > 0) await queueFailedRelinks(ctx, unfinished);
  return counts;
}

export async function settleAllMissing(ctx: ActionCtx, reads: HistoryReads, failures: SourceFailure[], dryRun: boolean): Promise<LinkCounts> {
  const names = reads.allMissing.splice(0);
  if (!reads.answered) {
    for (const name of names) {
      failures.push({ source: `histories of ${name.nameKey}`, error: `Sport80 answered ${MISSING_ATHLETE_STATUS} for every one of its lifters and no other history was read (the endpoint moved?)` });
    }
    return NO_LINKS;
  }
  let counts = NO_LINKS;
  warnLinkedByFitAlone(names);
  for (const batch of chunks(names, NAMES_PER_LINK)) {
    const ready = batch.map((name) => ({ nameKey: name.nameKey, histories: name.athleteIds.map((athleteId) => ({ athleteId, results: [] })) }));
    const result: LinkCounts & { stale: string[] } = await ctx.runMutation(internal.ingest.linkLifterResults, { names: ready, dryRun });
    for (const nameKey of result.stale) failures.push({ source: `links of ${nameKey}`, error: 'its lifters changed while their histories were read; queued for the next run' });
    if (!dryRun && result.stale.length > 0) await queueFailedRelinks(ctx, result.stale);
    counts = addCounts(counts, result);
  }
  return counts;
}

async function readUnlinked(ctx: ActionCtx, insertedSince: number): Promise<UnlinkedResult[]> {
  const rows: UnlinkedResult[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: { rows: UnlinkedResult[]; cursor: string; isDone: boolean } = await ctx.runQuery(internal.lifters.unlinkedResultsPage, { insertedSince, cursor });
    rows.push(...page.rows);
    if (page.isDone) return rows;
    cursor = page.cursor;
  }
}

async function liftersOf(ctx: ActionCtx, nameKeys: readonly string[]): Promise<LifterName[]> {
  const found: LifterName[] = [];
  for (const batch of chunks(nameKeys, MAX_LIFTER_NAME_LOOKUPS)) {
    found.push(...(await ctx.runQuery(internal.lifters.liftersByName, { nameKeys: batch })));
  }
  return found;
}

const isRanked = (row: UnlinkedResult) => isSport80Result(row);

export function classesOfResults(rows: readonly UnlinkedResult[], classes: readonly RankingClass[]): { picked: RankingClass[]; unknown: string[] } {
  const ages = new Set(rows.filter(isRanked).map((row) => row.age).filter((age): age is string => age !== null));
  const wanted = new Set<number>();
  const unknown: string[] = [];
  for (const age of ages) {
    const ids = rankingClassIds(age, classes);
    if (ids.length === 0) unknown.push(age);
    for (const id of ids) wanted.add(id);
  }
  return { picked: classes.filter((c) => wanted.has(c.id)), unknown: unknown.sort() };
}

export type RankingsWindow = { from: string; to: string; rows: UnlinkedResult[] };

export function rankingsWindows(rows: readonly UnlinkedResult[], todayIso: string): RankingsWindow[] {
  const dated = rows.filter((row) => isRanked(row) && isDatedResult(row.date)).sort((a, b) => compareBytes(a.date, b.date));
  const clusters: UnlinkedResult[][] = [];
  for (const row of dated) {
    const cluster = clusters[clusters.length - 1];
    const last = cluster?.[cluster.length - 1];
    if (last && daysBetween(last.date, row.date) <= SAME_MEET_TOLERANCE_DAYS + SOURCE_DATE_TOLERANCE_DAYS) cluster.push(row);
    else clusters.push([row]);
  }
  return clusters.map((cluster) => {
    const latest = isoDaysAfter(itemAt(cluster, cluster.length - 1).date, SOURCE_DATE_TOLERANCE_DAYS);
    return { from: isoDaysAfter(itemAt(cluster, 0).date, -SAME_MEET_TOLERANCE_DAYS), to: latest < todayIso ? latest : todayIso, rows: cluster };
  });
}

const reported = (failures: readonly SourceFailure[]) => failures.slice(0, MAX_REPORTED_FAILURES);

type SightingsRead = { classes: number; sightings: number; unreadRows: UnlinkedResult[] };

async function sightingsAround(
  sport80: Sport80Connection,
  windows: readonly RankingsWindow[],
  failures: SourceFailure[],
  store: (sightings: LifterSighting[]) => Promise<void>,
  deadline: number,
): Promise<SightingsRead> {
  const read: SightingsRead = { classes: 0, sightings: 0, unreadRows: [] };
  if (windows.length === 0) return read;
  const api = await sport80();
  const known = rankingClasses(await api.rankingsTable());
  let skipped = 0;
  for (const window of oldestStoredFirst(windows)) {
    if (Date.now() >= deadline) {
      read.unreadRows.push(...window.rows);
      skipped += 1;
      continue;
    }
    const { picked, unknown } = classesOfResults(window.rows, known);
    for (const age of unknown) failures.push({ source: `rankings class ${JSON.stringify(age)}`, error: 'no Sport80 rankings class has this name, so its results are not linked' });
    const classRead = await readSightings(api, picked, window.from, window.to, failures, { deadline });
    read.classes += picked.length - classRead.late;
    await store(classRead.sightings);
    read.sightings += classRead.sightings.length;
    read.unreadRows.push(
      ...window.rows.filter((row) => {
        if (row.age === null) return false;
        const ids = rankingClassIds(row.age, known);
        return ids.length === 0 || ids.some((id) => classRead.unread.has(id));
      }),
    );
  }
  if (skipped > 0) failures.push({ source: 'rankings', error: `${skipped} of ${windows.length} date windows not read in time; read on the next run` });
  return read;
}

const earliestStored = (window: RankingsWindow) => Math.min(...window.rows.map((row) => row.storedAt));

export function oldestStoredFirst(windows: readonly RankingsWindow[]): RankingsWindow[] {
  return [...windows].sort((a, b) => earliestStored(a) - earliestStored(b));
}

export const run = internalAction({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }) => {
    const now = Date.now();
    const lastComplete: number | null = await ctx.runQuery(internal.lifters.lastCompleteRun, {});
    const insertedSince = Math.max(now - RECENT_INSERT_DAYS * DAY_MS, (lastComplete ?? 0) - IN_FLIGHT_WRITE_MS);
    const rows = await readUnlinked(ctx, insertedSince);
    const failures: SourceFailure[] = [];
    const sport80 = connectOnce();
    const windows = rankingsWindows(rows, isoDateOf(now));
    const store = async (found: LifterSighting[]) => {
      if (!dryRun) await storeSightings(ctx, found, true);
    };
    let read: SightingsRead = { classes: 0, sightings: 0, unreadRows: [] };
    try {
      read = await sightingsAround(sport80, windows, failures, store, now + NIGHTLY_READ_BUDGET_MS);
    } catch (error) {
      failures.push({ source: 'rankings', error: errorMessage(error) });
      read = { ...read, unreadRows: windows.flatMap((window) => window.rows) };
    }
    const { classes, sightings, unreadRows } = read;
    const queued: string[] = await ctx.runQuery(internal.lifters.queuedRelinks, {});
    const deferred = new Set(unreadRows.map((row) => row.nameKey));
    const nameKeys = [...new Set([...rows.map((row) => row.nameKey), ...queued])].filter((nameKey) => !deferred.has(nameKey));
    if (nameKeys.length === 0) {
      if (failures.length > 0) throw sourcesFailed(`lifters: ${failures.length} problem(s), nothing linked`, reported(failures));
      if (!dryRun) await ctx.runMutation(internal.lifters.recordCompleteRun, { startedAt: now });
      return { unlinked: rows.length, queued: queued.length, deferred: deferred.size, classes, sightings, names: 0, links: NO_LINKS };
    }
    const names = await liftersOf(ctx, nameKeys);
    const reads = newHistoryReads();
    const relinked = await relink(ctx, sport80, names, failures, dryRun ?? false, reads, Date.now() + NIGHTLY_LINK_BUDGET_MS);
    const links = addCounts(relinked, await settleAllMissing(ctx, reads, failures, dryRun ?? false));
    console.log(
      `lifters: ${rows.length} unlinked results stored since ${new Date(insertedSince).toISOString()}, ${queued.length} names queued for relinking, ${classes} classes read, ${sightings} sightings, ${deferred.size} names left for the next run, ` +
        `${names.length} names relinked: ${links.history} by history, ${links.fit} by fit, ${links.unlinked} unlinked, ${links.changed} changed`,
    );
    if (failures.length > 0) throw sourcesFailed(`lifters: ${failures.length} problem(s), the rest was linked`, reported(failures));
    if (!dryRun) await ctx.runMutation(internal.lifters.recordCompleteRun, { startedAt: now });
    return { unlinked: rows.length, queued: queued.length, deferred: deferred.size, classes, sightings, names: names.length, links };
  },
});

export const BACKFILL_ATTEMPTS = 3;
export const BACKFILL_RETRY_DELAY_MS = 60_000;

const linkCountsArg = v.object({ history: v.number(), fit: v.number(), unlinked: v.number(), changed: v.number() });
const failureArg = v.object({ source: v.string(), error: v.string() });

const backfillArgs = {
  stage: v.optional(v.union(v.literal('rankings'), v.literal('link'))),
  offset: v.optional(v.number()),
  classIds: v.optional(v.array(v.number())),
  unreadClassIds: v.optional(v.array(v.number())),
  after: v.optional(v.string()),
  previewLinks: v.optional(v.boolean()),
  failures: v.optional(v.array(failureArg)),
  failureCount: v.optional(v.number()),
  links: v.optional(linkCountsArg),
  attempt: v.optional(v.number()),
};

type BackfillArgs = {
  stage?: 'rankings' | 'link';
  offset?: number;
  classIds?: number[];
  unreadClassIds?: number[];
  after?: string;
  previewLinks?: boolean;
  failures?: SourceFailure[];
  failureCount?: number;
  links?: LinkCounts;
  attempt?: number;
};

type BackfillStep =
  | { next: BackfillArgs }
  | { stop: { reason: string; resume: BackfillArgs } }
  | { done: { links: LinkCounts; failureCount: number; failures: SourceFailure[] } };

async function backfillStep(ctx: ActionCtx, args: BackfillArgs): Promise<BackfillStep> {
  const failures: SourceFailure[] = [];
  const sport80 = connectOnce();
  const carried = (links: LinkCounts) => {
    logInLines('lifters backfill: failed', failures.map(({ source, error }) => `${source}: ${error}`), console.warn);
    return {
      previewLinks: args.previewLinks,
      links,
      failureCount: (args.failureCount ?? 0) + failures.length,
      failures: [...(args.failures ?? []), ...failures].slice(0, MAX_REPORTED_FAILURES),
    };
  };
  if ((args.stage ?? 'rankings') === 'rankings') {
    const api = await sport80();
    const all = rankingClasses(await api.rankingsTable());
    const wanted = args.classIds === undefined ? null : new Set(args.classIds);
    const classes = wanted === null ? all : all.filter((c) => wanted.has(c.id));
    const offset = args.offset ?? 0;
    const slice = classes.slice(offset, offset + BACKFILL_CLASSES_PER_RUN);
    const startedAt = Date.now();
    const sightings: LifterSighting[] = [];
    const unread = new Set(args.unreadClassIds ?? []);
    const reading: RankingsReading = { deadline: startedAt + BACKFILL_READ_STOP_MS, wholeTables: true, retryDroppedConnections: true };
    let read = 0;
    while (read < slice.length && Date.now() - startedAt < BACKFILL_RUN_BUDGET_MS) {
      const batch = slice.slice(read, read + SPORT80_CONCURRENCY);
      const classRead = await readSightings(api, batch, BACKFILL_FROM, today(), failures, { reading });
      sightings.push(...classRead.sightings);
      for (const id of classRead.unread) unread.add(id);
      read += batch.length;
    }
    await storeSightings(ctx, sightings, !args.previewLinks);
    const reached = offset + read;
    console.log(`lifters backfill: rankings classes ${offset + 1}-${reached} of ${classes.length}, ${sightings.length} sightings, ${failures.length} failed`);
    const links = args.links ?? NO_LINKS;
    const position = { ...carried(links), classIds: args.classIds, unreadClassIds: [...unread] };
    if (reached < classes.length) return { next: { ...position, stage: 'rankings', offset: reached } };
    if (unread.size > 0) {
      return {
        stop: {
          reason: `the rankings of ${unread.size} weight class(es) could not be read, so no name was linked: a lifter only they name would be passed over`,
          resume: { previewLinks: args.previewLinks, links, stage: 'rankings', classIds: [...unread] },
        },
      };
    }
    return { next: { ...carried(links), stage: 'link', after: '' } };
  }
  const page: { names: string[]; done: boolean } = await ctx.runQuery(internal.lifters.lifterNamesPage, { after: args.after ?? '' });
  const candidates = await liftersOf(ctx, page.names);
  const startedAt = Date.now();
  let links = args.links ?? NO_LINKS;
  let linked = 0;
  const reads = newHistoryReads();
  while (linked < candidates.length && Date.now() - startedAt < BACKFILL_RUN_BUDGET_MS) {
    const batch = candidates.slice(linked, linked + NAMES_PER_LINK);
    links = addCounts(links, await relink(ctx, sport80, batch, failures, args.previewLinks ?? false, reads, startedAt + BACKFILL_RUN_BUDGET_MS));
    linked += batch.length;
  }
  links = addCounts(links, await settleAllMissing(ctx, reads, failures, args.previewLinks ?? false));
  const shared = candidates.slice(0, linked).filter((name) => name.athleteIds.length > 1).length;
  console.log(`lifters backfill: linked ${linked} names (${shared} shared) after ${JSON.stringify(args.after ?? '')}; so far ${JSON.stringify(links)}`);
  const last = candidates[linked - 1]?.nameKey;
  if (last !== undefined && (linked < candidates.length || !page.done)) return { next: { ...carried(links), stage: 'link', after: last } };
  return { done: carried(links) };
}

function resumeArgs({ attempt: _attempt, ...position }: BackfillArgs): BackfillArgs {
  return position;
}

export const backfill = internalAction({
  args: backfillArgs,
  handler: async (ctx, args): Promise<void> => {
    let step: BackfillStep;
    try {
      step = await backfillStep(ctx, args);
    } catch (error) {
      const attempt = args.attempt ?? 1;
      if (attempt < BACKFILL_ATTEMPTS) {
        console.error(`lifters backfill: attempt ${attempt} of ${JSON.stringify(resumeArgs(args))} failed, retrying: ${errorMessage(error)}`);
        await ctx.scheduler.runAfter(BACKFILL_RETRY_DELAY_MS, internal.scrapers.lifters.backfill, { ...args, attempt: attempt + 1 });
        return;
      }
      throw new Error(
        `lifters backfill stopped after ${attempt} attempts: ${errorMessage(error)}. ` +
          `Resume it by running scrapers/lifters:backfill (with --prod on production) with these arguments:\n${JSON.stringify(resumeArgs(args))}`,
      );
    }
    if ('next' in step) {
      console.log(`lifters backfill: next ${JSON.stringify(resumeArgs(step.next))}`);
      await ctx.scheduler.runAfter(0, internal.scrapers.lifters.backfill, step.next);
      return;
    }
    if ('stop' in step) {
      throw new Error(
        `lifters backfill stopped before linking: ${step.stop.reason}. ` +
          `Read them again by running scrapers/lifters:backfill (with --prod on production) with these arguments:\n${JSON.stringify(step.stop.resume)}`,
      );
    }
    const { links, failureCount, failures } = step.done;
    console.log(`lifters backfill done${args.previewLinks ? ' (links previewed, not written)' : ''}: ${JSON.stringify(links)}, ${failureCount} failure(s)`);
    if (failureCount > 0) throw sourcesFailed(`lifters backfill: ${failureCount} problem(s), the rest was stored`, failures);
  },
});
