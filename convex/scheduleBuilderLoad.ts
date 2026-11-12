'use node';

import { v } from 'convex/values';
import { action, type ActionCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { apiError } from './lib/validation';
import { errorMessage } from './lib/errors';
import { fetchEntriesMeet, readEntries } from './scrapers/entries';
import { fetchLocatorPage, fetchWidgetPage } from './scrapers/meets';
import { canonicalEntriesUrl, entriesEventId, meetPageEventId } from './scrapers/parse/entries';
import { runBudget } from './scrapers/lib/budget';
import {
  findLocatorRow,
  isAdaptiveListing,
  locatorPageUrl,
  parseAddress,
  parseDateRange,
  readAllWidgetPages,
  readLocatorPage,
  transformMeets,
  WIDGET_PAGE_SIZE,
  widgetPageUrl,
  type LocatorRow,
  type WidgetRow,
} from './scrapers/parse/meets';

const SPORT80_HOST = 'usaweightlifting.sport80.com';
const NOT_UPCOMING = "Sport80 doesn't list this event as upcoming, so MeetCal can't add it";
const NO_ENTRY_LIST = "Sport80 doesn't show a public entry list for this meet yet";
export const LOAD_BUDGET_MS = 100_000;
export const SEARCH_BUDGET_MS = 30_000;
export const MIN_SEARCH_LENGTH = 3;
export const MAX_SEARCH_LENGTH = 80;
export const MAX_SEARCH_RESULTS = 20;
export const MAX_SEARCH_PAGES = 2;

type StoredMeet = { name: string; status: string; endDate: string };

export type Sport80Link = { eventId: string; entriesUrl: string | null };

export function sport80LinkOf(url: string): Sport80Link {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw apiError(400, "paste the meet's Sport80 link, like https://usaweightlifting.sport80.com/public/events/12345, or its entries list");
  }
  if (parsed.hostname !== SPORT80_HOST) throw apiError(400, `the URL must be a ${SPORT80_HOST} meet page or entries list`);
  const eventId = meetPageEventId(parsed.pathname);
  if (eventId !== null) return { eventId, entriesUrl: null };
  try {
    return { eventId: entriesEventId(parsed.pathname), entriesUrl: canonicalEntriesUrl(parsed.pathname) };
  } catch {
    throw apiError(400, "that page is not a Sport80 meet page or entries list; open the meet on Sport80 and copy its URL from the address bar");
  }
}

type Sport80Read = <T>(work: Promise<T>) => Promise<T>;

function sport80Within(budgetMs: number, purpose: string): Sport80Read {
  const budget = runBudget({ budgetMs, hardStopMs: budgetMs });
  return async (work) => {
    try {
      return await budget.orStop(work);
    } catch (error) {
      if (budget.spent()) throw apiError(504, 'Sport80 is slow right now; try again in a minute');
      console.error(`scheduleBuilder ${purpose}: ${errorMessage(error)}`);
      throw apiError(502, 'Sport80 did not answer; try again in a minute');
    }
  };
}

export function listedMeetProblem(rows: readonly WidgetRow[], eventId: string): { row: WidgetRow } | { problem: string } {
  const row = rows.find((r) => r.id === eventId);
  if (!row) return { problem: NOT_UPCOMING };
  const { meets, undated } = transformMeets([row]);
  if (meets.length > 0) return { row };
  if (undated.length > 0) return { problem: "Sport80 hasn't set this meet's dates yet" };
  if (isAdaptiveListing(row.name)) return { problem: "MeetCal doesn't build schedules for adaptive events yet" };
  return { problem: "MeetCal couldn't read this meet's dates on Sport80" };
}

type Listing = () => Promise<WidgetRow[]>;

function upcomingListing(fromSport80: Sport80Read): Listing {
  let rows: Promise<WidgetRow[]> | null = null;
  return () => (rows ??= fromSport80(readAllWidgetPages((page) => fetchWidgetPage(widgetPageUrl('', page)))));
}

async function entriesUrlOf(link: Sport80Link, listing: Listing, fromSport80: Sport80Read): Promise<string> {
  if (link.entriesUrl !== null) return link.entriesUrl;
  const listed = (await listing()).find((row) => row.id === link.eventId);
  if (!listed) throw apiError(422, NOT_UPCOMING);
  const row = await fromSport80(findLocatorRow(link.eventId, (page) => fetchLocatorPage(locatorPageUrl(listed.name, page))));
  if (!row?.entriesUrl) throw apiError(422, NO_ENTRY_LIST);
  return row.entriesUrl;
}

async function storeMeet(ctx: ActionCtx, eventId: string, title: string, listing: Listing): Promise<StoredMeet> {
  const known: StoredMeet | null = await ctx.runQuery(internal.scrapers.queries.entriesMeet, { sourceId: eventId, title });
  if (known) return known;
  const listed = listedMeetProblem(await listing(), eventId);
  if ('problem' in listed) throw apiError(422, listed.problem);
  await ctx.runMutation(internal.ingest.upsertMeets, { rows: transformMeets([listed.row]).meets });
  const stored: StoredMeet | null = await ctx.runQuery(internal.scrapers.queries.entriesMeet, { sourceId: eventId, title });
  if (!stored) throw new Error(`scheduleBuilder load: event ${eventId} was stored but cannot be read back`);
  return stored;
}

export const load = action({
  args: { url: v.string() },
  handler: async (ctx, { url }): Promise<{ meet: string; refreshed: boolean }> => {
    const link = sport80LinkOf(url);
    const claimed: { recentMeet: string } | { claim: Id<'schedule_builder_loads'> } = await ctx.runMutation(internal.scheduleBuilder.claimLoad, { eventId: link.eventId });
    if ('recentMeet' in claimed) return { meet: claimed.recentMeet, refreshed: false };
    const fromSport80 = sport80Within(LOAD_BUDGET_MS, 'load');
    const listing = upcomingListing(fromSport80);
    const entriesUrl = await entriesUrlOf(link, listing, fromSport80);
    const title = await fromSport80(fetchEntriesMeet(entriesUrl));
    const meet = await storeMeet(ctx, link.eventId, title, listing);
    if (meet.status === 'completed') throw apiError(409, 'this meet is over, so its schedule can no longer be built');
    await ctx.runMutation(internal.scrapers.entryTargets.addFromBuilder, { label: title, url: entriesUrl });
    const entries = await fromSport80(readEntries(ctx, entriesUrl, meet.name));
    if (entries.length > 0) {
      try {
        await ctx.runMutation(internal.ingest.upsertEntryAthletes, { meet: meet.name, rows: entries, complete: true });
      } catch (error) {
        console.error(`scheduleBuilder load (${meet.name}): ${errorMessage(error)}`);
        throw apiError(409, "the meet's entries changed more than MeetCal updates on its own; they'll be checked by hand. Try again later");
      }
    }
    await ctx.runMutation(internal.scheduleBuilder.finishLoad, { claim: claimed.claim, meet: meet.name });
    return { meet: meet.name, refreshed: true };
  },
});

export type MeetMatch = { eventId: string; name: string; startDate: string; endDate: string; place: string; entriesUrl: string | null };

export function searchQueryOf(query: string): string {
  const trimmed = query.trim();
  if (trimmed.length < MIN_SEARCH_LENGTH) throw apiError(400, `type at least ${MIN_SEARCH_LENGTH} characters of the meet's name`);
  if (trimmed.length > MAX_SEARCH_LENGTH) throw apiError(400, `a meet name is at most ${MAX_SEARCH_LENGTH} characters`, { max: MAX_SEARCH_LENGTH });
  return trimmed;
}

const KNOWN = (part: string) => part !== '' && part !== 'Unknown';

export function meetMatchOf(row: LocatorRow): MeetMatch {
  const dates = parseDateRange(row.subtitle);
  const { city, state } = parseAddress(row.address);
  return {
    eventId: row.id,
    name: row.name,
    startDate: dates?.startDate ?? '',
    endDate: dates?.endDate ?? '',
    place: row.address === '' ? '' : [city, state].filter(KNOWN).join(', '),
    entriesUrl: row.entriesUrl,
  };
}

export async function upcomingMatches(fetchPage: (page: number) => Promise<unknown>): Promise<{ results: MeetMatch[]; truncated: boolean }> {
  const matches: MeetMatch[] = [];
  let read = 0;
  let more = false;
  for (let page = 0; page < MAX_SEARCH_PAGES && matches.length <= MAX_SEARCH_RESULTS; page++) {
    const { total, rows } = readLocatorPage(await fetchPage(page));
    read += rows.length;
    matches.push(...rows.filter((row) => row.isEvent).map(meetMatchOf));
    more = read < total && rows.length === WIDGET_PAGE_SIZE;
    if (!more) break;
  }
  return { results: matches.slice(0, MAX_SEARCH_RESULTS), truncated: matches.length > MAX_SEARCH_RESULTS || more };
}

export const search = action({
  args: { query: v.string() },
  handler: async (ctx, { query }): Promise<{ results: MeetMatch[]; truncated: boolean }> => {
    const name = searchQueryOf(query);
    await ctx.runMutation(internal.scheduleBuilder.claimSearch, {});
    const fromSport80 = sport80Within(SEARCH_BUDGET_MS, 'search');
    return await fromSport80(upcomingMatches((page) => fetchWidgetPage(widgetPageUrl(name, page))));
  },
});
