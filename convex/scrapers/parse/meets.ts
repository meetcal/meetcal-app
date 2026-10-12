// Pure parts of `scrapers/meets.ts` (port of `usaw/meet_to_supabase/scripts/sync-*.js`).

import { isValidIsoDate } from '../../lib/validation';
import { stateCode, usTimeZone } from '../lib/states';

const WIDGET = 'https://usaweightlifting.sport80.com/api/public/widget/data/new/1';

/** Meets per widget page: the page size the Node scripts asked for. */
export const WIDGET_PAGE_SIZE = 20;
/** Pages read per search at most; a search matching more fails rather than drop the rest. */
export const MAX_WIDGET_PAGES = 10;

/** The three searches the VPS ran; only the WSO one skips completed meets. */
export const MEET_SEARCHES = [
  { key: 'wso', search: 'WSO', skipCompleted: true },
  { key: 'nationals', search: 'Nationals', skipCompleted: false },
  { key: 'virus', search: 'Virus Weightlifting', skipCompleted: false },
] as const;

/** One page (from 0) of a widget search, upcoming meets soonest first. */
export function widgetPageUrl(search: string, page: number): string {
  return `${WIDGET}?p=${page}&i=${WIDGET_PAGE_SIZE}&l=&d=10&f=&s=${encodeURIComponent(search)}`;
}

export type WidgetRow = { id: string | null; name: string; address: string; subtitle: string };

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

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
    const name = text(row.name).trim();
    if (!name) throw new Error(`widget: row ${i} has no name`);
    const id = row.id === undefined || row.id === null ? null : String(row.id);
    return { id, name, address: text(row.address), subtitle: text(row.subtitle) };
  });
  return { total: count, rows };
}

/**
 * Every meet a search matches, a page at a time until the widget's count is
 * reached (or a page comes back short or empty). A search still short of its
 * count after `MAX_WIDGET_PAGES`, or that read fewer distinct meets than the
 * count, fails: a partial list would silently leave meets out.
 */
export async function readAllWidgetPages(fetchPage: (page: number) => Promise<unknown>): Promise<WidgetRow[]> {
  const rows: WidgetRow[] = [];
  let total = 0;
  for (let page = 0; page < MAX_WIDGET_PAGES; page++) {
    const result = readWidgetPage(await fetchPage(page));
    total = result.total;
    rows.push(...result.rows);
    if (rows.length >= total || result.rows.length < WIDGET_PAGE_SIZE) break;
  }
  const distinct = new Set(rows.map((row, i) => row.id ?? `#${i}`)).size;
  if (distinct < total) throw new Error(`widget: read ${distinct} distinct meets of ${total} (${MAX_WIDGET_PAGES} pages of ${WIDGET_PAGE_SIZE} at most)`);
  return rows;
}

export type ScrapedMeet = {
  name: string;
  venueName: string;
  venueStreet: string;
  venueCity: string;
  venueState: string;
  venueZip: string;
  /** Absent when the state is not a US state: reported, not guessed. */
  timeZone?: string;
  startDate: string;
  endDate: string;
  status: 'upcoming';
  federation: 'USAW';
};

type Address = { venueName: string; street: string; city: string; state: string; zip: string };

/** `parseAddress`: "Venue, Street, [Suite], City, State, Zip, United States of America". */
export function parseAddress(raw: string): Address {
  try {
    const address = raw.replace(/,\s*,/g, ',');
    const parts = address.split(', ');
    if (parts.length < 4) return { venueName: '', street: address, city: 'Unknown', state: 'Unknown', zip: 'Unknown' };
    const zip = parts[parts.length - 1];
    const stateIndex = parts.findIndex((part) => part === 'United States of America');
    const state = stateIndex > 0 ? parts[stateIndex - 1] : parts[parts.length - 2];
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

export type TransformedMeets = {
  meets: ScrapedMeet[];
  /** Meets left out because their dates could not be read, with the text. */
  rejected: string[];
  /** Meets synced without a time zone (the state is not a US state). */
  unknownZone: string[];
};

/**
 * `transformMeetsData`: widget rows to meets, dropping adaptive ones. A meet
 * whose dates cannot be read is left out and reported, never stored with
 * made-up dates. The zone comes from the state and, in a state that spans
 * two zones, the city (`lib/states.ts`).
 */
export function transformMeets(rows: { name: string; address: string; subtitle: string }[]): TransformedMeets {
  const result: TransformedMeets = { meets: [], rejected: [], unknownZone: [] };
  for (const row of rows) {
    if (row.name.toUpperCase().includes('ADAPTIVE')) continue;
    const dates = parseDateRange(row.subtitle);
    if (!dates) {
      result.rejected.push(`${row.name}: unreadable dates ${JSON.stringify(row.subtitle)}`);
      continue;
    }
    const { venueName, street, city, state, zip } = parseAddress(row.address);
    const timeZone = usTimeZone(state, city);
    if (timeZone === null) result.unknownZone.push(`${row.name}: state ${JSON.stringify(state)}`);
    result.meets.push({
      name: row.name,
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
