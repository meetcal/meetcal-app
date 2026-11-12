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
import { findLocatorRow, isAdaptiveListing, locatorPageUrl, readAllWidgetPages, transformMeets, widgetPageUrl, type WidgetRow } from './scrapers/parse/meets';

const SPORT80_HOST = 'usaweightlifting.sport80.com';
const NOT_UPCOMING = "Sport80 doesn't list this event as upcoming, so MeetCal can't add it";
const NO_ENTRY_LIST = "Sport80 doesn't show a public entry list for this meet yet";

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

async function fromSport80<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    console.error(`scheduleBuilder load: ${errorMessage(error)}`);
    throw apiError(502, 'Sport80 did not answer; try again in a minute');
  }
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

function upcomingListing(): Listing {
  let rows: Promise<WidgetRow[]> | null = null;
  return () => (rows ??= fromSport80(readAllWidgetPages((page) => fetchWidgetPage(widgetPageUrl('', page)))));
}

async function entriesUrlOf(link: Sport80Link, listing: Listing): Promise<string> {
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
    const listing = upcomingListing();
    const entriesUrl = await entriesUrlOf(link, listing);
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
