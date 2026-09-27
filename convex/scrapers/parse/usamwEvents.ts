import { parseHtml } from '../lib/html';

// USA Masters events (replaces `usamw/meets/scrape_events.py`, whose site,
// usamastersweightlifting.com, is gone). The events page on usamasters.net
// lists each event as a `.kv-ee-event` block: a venue paragraph with the
// name and dates ("2026 Howard Cohen<br>American Masters<br><br>Dec 2-6,
// 2026") and a location paragraph ("Valley Forge, PA<br>Valley Forge Resort
// & Casino"). The Python read the page's text line by line and, on this
// page, split names, took one event's dates for another and read no
// location for most, so this reads the blocks instead.

export const EVENTS_URL = 'https://usamasters.net/events';

export type UsamwEvent = {
  name: string;
  startDate: string;
  endDate: string;
  venueName: string;
  venueCity: string;
  venueState: string;
  timeZone: string;
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const STATES: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE',
  Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY',
  Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO',
  Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI',
  'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA',
  Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY', 'District of Columbia': 'DC',
};

const CENTRAL = ['AL', 'AR', 'IL', 'IA', 'KS', 'LA', 'MN', 'MS', 'MO', 'NE', 'ND', 'OK', 'SD', 'TN', 'TX', 'WI'];
const MOUNTAIN = ['CO', 'ID', 'MT', 'NM', 'UT', 'WY'];
const PACIFIC = ['CA', 'NV', 'OR', 'WA'];
const ABROAD: Record<string, string> = {
  greece: 'Europe/Athens', japan: 'Asia/Tokyo', spain: 'Europe/Madrid', 'puerto rico': 'America/Puerto_Rico',
  'el salvador': 'America/El_Salvador', canada: 'America/Toronto', mexico: 'America/Mexico_City',
};

/** The meet's time zone from its state, or a country named in its location; Eastern when unknown, as the Python defaulted. */
export function timeZoneFor(state: string, locationText = state): string {
  if (state === 'AZ') return 'America/Phoenix';
  if (state === 'AK') return 'America/Anchorage';
  if (state === 'HI') return 'Pacific/Honolulu';
  if (CENTRAL.includes(state)) return 'America/Chicago';
  if (MOUNTAIN.includes(state)) return 'America/Denver';
  if (PACIFIC.includes(state)) return 'America/Los_Angeles';
  const lower = locationText.toLowerCase();
  const country = Object.keys(ABROAD).find((name) => lower.includes(name));
  return country ? ABROAD[country] : 'America/New_York';
}

const pad = (n: number) => String(n).padStart(2, '0');

const DATE = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:\s*-\s*(?:([A-Za-z]{3,9})\.?\s+)?(\d{1,2}))?(?:,\s*(\d{4}))?$/;

/**
 * "Sep 17-26, 2026", "July 31-Aug 08, 2028", "Dec 2, 2026", or "August 18-22"
 * with the year taken from the event's name ("2027 Elite Masters").
 */
export function parseDates(text: string, fallbackYear: number | null): { startDate: string; endDate: string } | null {
  const match = DATE.exec(text.trim());
  if (!match) return null;
  const [, startMonthName, startDay, endMonthName, endDay, yearText] = match;
  const startMonth = MONTHS[startMonthName.slice(0, 3).toLowerCase()];
  const endMonth = endMonthName ? MONTHS[endMonthName.slice(0, 3).toLowerCase()] : startMonth;
  const year = yearText ? Number(yearText) : fallbackYear;
  if (!startMonth || !endMonth || !year) return null;
  // A range that runs into January ends the next year.
  const endYear = endMonth < startMonth ? year + 1 : year;
  return {
    startDate: `${year}-${pad(startMonth)}-${pad(Number(startDay))}`,
    endDate: `${endYear}-${pad(endMonth)}-${pad(Number(endDay ?? startDay))}`,
  };
}

/** "Valley Forge, PA" -> city and state code; "Kansai, Japan" or "Corbera de Llobregat" keeps the country or place as the state, as the Python did. */
export function parseLocation(text: string): { venueCity: string; venueState: string } {
  const parts = text.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return { venueCity: text.trim(), venueState: text.trim() };
  const region = parts[1];
  return { venueCity: parts[0], venueState: STATES[region] ?? region };
}

/** A paragraph's lines, split at its line breaks, blank ones dropped. */
function lines(paragraph: string | undefined): string[] {
  return (paragraph ?? '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

const LOCATION = /^[A-Z][\p{L}.' -]+,\s*[A-Z][\p{L}.' -]+$/u;

/** Competition events on the page (training camps and cruises skipped, as the Python did). */
export function parseUsamwEvents(html: string): UsamwEvent[] {
  const root = parseHtml(html.replace(/<br\s*\/?>/gi, '\n'));
  const events: UsamwEvent[] = [];
  for (const block of root.querySelectorAll('.kv-ee-event')) {
    const venue = lines(block.querySelector('.kv-ee-venue p')?.text);
    const location = lines(block.querySelector('.kv-ee-location p')?.text);
    const dateAt = venue.findIndex((line) => DATE.test(line));
    if (dateAt <= 0) continue;
    const head = venue.slice(0, dateAt);
    // A "City, Country" line between the name and the dates is the location.
    const placeAt = head.findIndex((line, i) => i > 0 && LOCATION.test(line));
    const name = (placeAt === -1 ? head : head.slice(0, placeAt)).join(' ');
    if (/training camp|cruise/i.test(name)) continue;
    const dates = parseDates(venue[dateAt], Number(/^(\d{4})\b/.exec(name)?.[1]) || null);
    if (!dates) continue;
    const place = placeAt === -1 ? location[0] : head[placeAt];
    let rest = placeAt === -1 ? location.slice(1) : location;
    // Long lines in the location paragraph are notes (entry rules, fees), not a place.
    let { venueCity, venueState } = place && place.length <= 60 ? parseLocation(place) : { venueCity: 'TBD', venueState: 'TBD' };
    // "Corbera de Llobregat" then "Barcelona - SPAIN": the second line names the country.
    const country = placeAt === -1 && venueCity === venueState ? /^[^,]+\s-\s+([A-Za-z ]+)$/.exec(rest[0] ?? '')?.[1] : undefined;
    if (country) {
      venueState = country.trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
      rest = rest.slice(1);
    }
    const venueLine = rest.find((line) => line.length <= 60 && !/[$:]|\d{4}/.test(line));
    events.push({ name, ...dates, venueName: venueLine ?? 'TBD', venueCity, venueState, timeZone: timeZoneFor(venueState, [place, ...location].join(' ')) });
  }
  return events;
}
