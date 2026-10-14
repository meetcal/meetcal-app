// Pure parts of `scrapers/meets.ts` (port of `usaw/meet_to_supabase/scripts/sync-*.js`).

import { isValidIsoDate } from '../../lib/validation';
import { countryTimeZone, isUnitedStates, usTerritoryTimeZone } from '../lib/countries';
import { stateCode, usTimeZone } from '../lib/states';

const WIDGET = 'https://usaweightlifting.sport80.com/api/public/widget/data/new/1';

/** Meets per widget page: the page size the Node scripts asked for. */
export const WIDGET_PAGE_SIZE = 20;
/**
 * Pages read at most; a listing longer than this fails rather than drop the
 * rest. The whole listing of upcoming events held 97 meets in October 2026.
 */
export const MAX_WIDGET_PAGES = 25;

/**
 * The meets MeetCal lists, by title: WSO championships, national meets and
 * the Virus series. These are what the VPS's three widget searches matched,
 * with "National" for the dead "Nationals" (the 2026 and 2027 National
 * Championships are titled "National Championships"). Whole words, so an
 * "International Open" is no national meet; any case, as the widget's
 * search was.
 */
const LISTED_TITLES = [/\bWSO\b/i, /\bNationals?\b/i, /\bVirus Weightlifting\b/i];

/** Whether a Sport80 event's title is one of the meets MeetCal lists (`LISTED_TITLES`). */
export function listedMeetTitle(name: string): boolean {
  return LISTED_TITLES.some((pattern) => pattern.test(name));
}

/**
 * One page (from 0) of a widget search, upcoming meets soonest first. The
 * sync reads the whole listing (an empty search) and picks its meets by title
 * and by the event ids it has stored, so a meet Sport80 retitles out of the
 * keywords is still found.
 */
export function widgetPageUrl(search: string, page: number): string {
  return `${WIDGET}?p=${page}&i=${WIDGET_PAGE_SIZE}&l=&d=10&f=&s=${encodeURIComponent(search)}`;
}

/** A widget row; `address` and `subtitle` are null when the row has no such text. */
export type WidgetRow = { id: string | null; name: string; address: string | null; subtitle: string | null };

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/**
 * A widget page's rows and the search's total match count (the widget sends
 * the count as a string). Anything else is an error, never an empty page.
 */
export function readWidgetPage(body: unknown): { total: number; rows: WidgetRow[] } {
  if (typeof body !== 'object' || body === null) throw new Error('widget: response is not an object');
  const { total, data } = body as { total?: unknown; data?: unknown };
  const count = typeof total === 'number' ? total : typeof total === 'string' && /^\d+$/.test(total.trim()) ? Number(total) : NaN;
  if (!Number.isInteger(count)) throw new Error(`widget: no match count (total ${JSON.stringify(total)})`);
  if (!Array.isArray(data)) throw new Error('widget: no data array');
  const rows = data.map((item: unknown, i): WidgetRow => {
    const row = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    const name = (text(row.name) ?? '').trim();
    if (!name) throw new Error(`widget: row ${i} has no name`);
    const id = row.id === undefined || row.id === null ? null : String(row.id);
    return { id, name, address: text(row.address), subtitle: text(row.subtitle) };
  });
  return { total: count, rows };
}

/**
 * Every meet a search matches, once each, a page at a time until the widget's
 * count is reached (or a page comes back short or empty). A meet repeated on a
 * later page (the listing shifted between reads) is kept once. A search still
 * short of its count after `MAX_WIDGET_PAGES`, or that read fewer distinct
 * meets than the count, fails: a partial list would silently leave meets out.
 */
export async function readAllWidgetPages(fetchPage: (page: number) => Promise<unknown>): Promise<WidgetRow[]> {
  const rows: WidgetRow[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (let page = 0; page < MAX_WIDGET_PAGES; page++) {
    const result = readWidgetPage(await fetchPage(page));
    total = result.total;
    for (const row of result.rows) {
      if (row.id !== null) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
      }
      rows.push(row);
    }
    if (rows.length >= total || result.rows.length < WIDGET_PAGE_SIZE) break;
  }
  if (rows.length < total) throw new Error(`widget: read ${rows.length} distinct meets of ${total} (${MAX_WIDGET_PAGES} pages of ${WIDGET_PAGE_SIZE} at most)`);
  return rows;
}

/** The venue fields; absent together when the widget gave no address, so the stored venue stays. */
type ScrapedVenue = { venueName: string; venueStreet: string; venueCity: string; venueState: string; venueZip: string };

export type ScrapedMeet = Partial<ScrapedVenue> & {
  name: string;
  /** The Sport80 event id, when the widget gave one: a retitled meet is matched on it. */
  sourceId?: string;
  /** Absent when neither the state nor the country tells it: reported, not guessed. */
  timeZone?: string;
  startDate: string;
  endDate: string;
  status: 'upcoming';
  federation: 'USAW';
};

type Address = { venueName: string; street: string; city: string; state: string; zip: string };

/**
 * A US address's venue and street from the parts before its city: a leading
 * part that starts with a digit begins the street, with no venue name;
 * otherwise the first part is the venue, and so is any part before the first
 * one that starts with a digit (a building: "Wayne State University, Mort
 * Harris Recreation Center, 5210 Gullen Mall"). The street keeps every part
 * from there to the city, a suite or unit included ("17630 Juniper Path,
 * Suite F").
 */
function venueAndStreet(parts: readonly string[]): { venueName: string; street: string } {
  if (parts.length === 0) return { venueName: '', street: '' };
  if (/^\d/.test(parts[0])) return { venueName: '', street: parts.join(', ') };
  const rest = parts.slice(1);
  const streetAt = rest.findIndex((part) => /^\d/.test(part));
  if (streetAt <= 0) return { venueName: parts[0], street: rest.join(', ') };
  return { venueName: [parts[0], ...rest.slice(0, streetAt)].join(', '), street: rest.slice(streetAt).join(', ') };
}

/**
 * `parseAddress`: "Venue, Street, [Suite], City, State, United States of
 * America, Zip". A US address (one naming the United States, or a US state
 * before its zip) is read back from the state: the part before it is the
 * city, whatever comes between the venue and the city ("17630 Juniper Path,
 * Suite F, Lakeville" is not in "Suite F"). Any other address keeps the
 * Node scripts' reading by position, which takes the country as the state.
 */
export function parseAddress(raw: string): Address {
  try {
    const address = raw.replace(/,\s*,/g, ',');
    const parts = address.split(', ');
    if (parts.length < 4) return { venueName: '', street: address, city: 'Unknown', state: 'Unknown', zip: 'Unknown' };
    const zip = parts[parts.length - 1];
    const stateIndex = parts.findIndex((part) => part === 'United States of America');
    const state = stateIndex > 0 ? parts[stateIndex - 1] : parts[parts.length - 2];
    const usStateAt = stateIndex > 0 ? stateIndex - 1 : stateCode(state) === null ? -1 : parts.length - 2;
    if (usStateAt >= 1) {
      const city = parts[usStateAt - 1];
      return { ...venueAndStreet(parts.slice(0, usStateAt - 1)), city, state, zip };
    }
    let venueName = '';
    let street = '';
    let city = '';
    if (!/^\d/.test(parts[0])) {
      venueName = parts[0];
      if (parts.length >= 6) {
        street = parts[1];
        if (/Suite|Unit|Apt|#/i.test(parts[2])) {
          street += `, ${parts[2]}`;
          city = parts[3];
        } else {
          city = parts[2];
        }
      } else {
        street = parts[1];
        city = parts[2];
      }
    } else {
      street = parts[0];
      city = parts[1];
    }
    return { venueName, street, city, state, zip };
  } catch {
    return { venueName: '', street: raw, city: 'Unknown', state: 'Unknown', zip: 'Unknown' };
  }
}

const SLASH_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/** "9/5/2026" -> "2026-09-05"; null for anything else or a date that does not exist. */
function isoFromSlash(text: string): string | null {
  const match = SLASH_DATE.exec(text.trim());
  if (!match) return null;
  const iso = `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
  return isValidIsoDate(iso) ? iso : null;
}

/**
 * `parseDateRange`: "MM/DD/YYYY - MM/DD/YYYY" or one "MM/DD/YYYY" (escaped
 * slashes allowed) to ISO dates, zero-padded. Null for anything else ("TBD",
 * a date that does not exist, an end before the start): meet dates are
 * compared as text, so a malformed one ("undefined-TBD-undefined",
 * "2026-9-5") would sort in the wrong place and never complete.
 */
export function parseDateRange(range: string): { startDate: string; endDate: string } | null {
  const sides = range.replace(/\\\//g, '/').split(/\s+-\s+/);
  if (sides.length > 2) return null;
  const startDate = isoFromSlash(sides[0]);
  const endDate = sides.length === 2 ? isoFromSlash(sides[1]) : startDate;
  if (!startDate || !endDate || endDate < startDate) return null;
  return { startDate, endDate };
}

/** A subtitle for dates not set yet. */
const UNSET_DATES = /^\s*(?:TBD|TBA)?\s*$/i;

export type TransformedMeets = {
  meets: ScrapedMeet[];
  /** Meets left out because their dates could not be read, with the text. */
  rejected: string[];
  /** Meets left out because their dates are not set yet ("TBD"): not an error. */
  undated: string[];
  /** Meets synced without a time zone (an unknown state or country, a country with several zones, or no address). */
  unknownZone: string[];
};

/**
 * A meet's zone from its widget address, or why there is none. A US address
 * (it names the United States) takes its state's zone, or a territory's. An
 * address abroad names its country last, or last before a postcode (a part
 * with a digit): a country on one clock gives its zone, one with several gives
 * none. Anything else is read as a US address, as before, so "…, Lebanon,
 * Ohio" with no postcode is an unknown state, not Lebanon.
 */
export function addressTimeZone(raw: string, state: string, city: string): { zone: string } | { problem: string } {
  const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  if (!parts.some(isUnitedStates)) {
    let at = parts.length - 1;
    if (at > 0 && /\d/.test(parts[at])) at -= 1;
    // The city and region before the country, read for outlying islands.
    const country = at >= 0 ? countryTimeZone([parts[at]], parts.slice(Math.max(0, at - 2), at).join(', ')) : null;
    if (country !== null) return country.zone === null ? { problem: `${country.country} spans several time zones` } : { zone: country.zone };
  }
  const zone = usTimeZone(state, city) ?? usTerritoryTimeZone(state);
  return zone === null ? { problem: `state ${JSON.stringify(state)}` } : { zone };
}

/**
 * `transformMeetsData`: widget rows to meets, dropping adaptive ones. A meet
 * whose dates cannot be read (or that has no dates field at all) is left out
 * and reported, never stored with made-up dates; one whose dates are still
 * "TBD" (or blank) is left out until they are set, without failing the run,
 * which would mask a real outage while the meet stays listed. The zone comes
 * from the state and, in a state that spans two zones, the city
 * (`lib/states.ts`), or from the country abroad (`lib/countries.ts`,
 * `addressTimeZone`). A meet with no address is synced without venue or zone,
 * so the stored ones stay.
 */
export function transformMeets(rows: (Pick<WidgetRow, 'name' | 'address' | 'subtitle'> & { id?: string | null })[]): TransformedMeets {
  const result: TransformedMeets = { meets: [], rejected: [], undated: [], unknownZone: [] };
  for (const row of rows) {
    if (row.name.toUpperCase().includes('ADAPTIVE')) continue;
    const source = row.id ? { sourceId: row.id } : {};
    if (row.subtitle === null) {
      result.rejected.push(`${row.name}: no dates`);
      continue;
    }
    const dates = parseDateRange(row.subtitle);
    if (!dates) {
      if (UNSET_DATES.test(row.subtitle)) result.undated.push(row.name);
      else result.rejected.push(`${row.name}: unreadable dates ${JSON.stringify(row.subtitle)}`);
      continue;
    }
    if (row.address === null || !row.address.trim()) {
      result.unknownZone.push(`${row.name}: no address`);
      result.meets.push({ name: row.name, ...source, ...dates, status: 'upcoming', federation: 'USAW' });
      continue;
    }
    const { venueName, street, city, state, zip } = parseAddress(row.address);
    const zone = addressTimeZone(row.address, state, city);
    const timeZone = 'zone' in zone ? zone.zone : null;
    if ('problem' in zone) result.unknownZone.push(`${row.name}: ${zone.problem}`);
    result.meets.push({
      name: row.name,
      ...source,
      venueName: venueName || row.name,
      venueStreet: street,
      venueCity: city,
      venueState: stateCode(state) ?? state,
      venueZip: zip,
      ...(timeZone === null ? {} : { timeZone }),
      ...dates,
      status: 'upcoming',
      federation: 'USAW',
    });
  }
  return result;
}
