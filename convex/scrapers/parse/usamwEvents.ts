import { parseHtml } from '../lib/html';
import { stateCode, usTimeZone } from '../lib/states';

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
  /** Absent when neither the state nor the location names a zone. */
  timeZone?: string;
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const ABROAD: Record<string, string> = {
  greece: 'Europe/Athens', japan: 'Asia/Tokyo', spain: 'Europe/Madrid', 'puerto rico': 'America/Puerto_Rico',
  'el salvador': 'America/El_Salvador', canada: 'America/Toronto', mexico: 'America/Mexico_City',
};

/**
 * The meet's time zone from its state and city (`lib/states.ts`), or a
 * country named in its location. Undefined when neither tells: the sync then
 * keeps the zone stored, and a new meet gets a blank one (the Python
 * defaulted to Eastern).
 */
export function timeZoneFor(state: string, city = '', locationText = state): string | undefined {
  const zone = usTimeZone(state, city);
  if (zone) return zone;
  const lower = locationText.toLowerCase();
  const country = Object.keys(ABROAD).find((name) => lower.includes(name));
  return country ? ABROAD[country] : undefined;
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
  return { venueCity: parts[0], venueState: stateCode(region) ?? region };
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
    const timeZone = timeZoneFor(venueState, venueCity, [place, ...location].join(' '));
    events.push({ name, ...dates, venueName: venueLine ?? 'TBD', venueCity, venueState, ...(timeZone === undefined ? {} : { timeZone }) });
  }
  return events;
}
