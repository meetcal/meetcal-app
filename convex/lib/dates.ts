/** Date arithmetic shared by the queries, the write path and the scrapers. */

/** A day, in milliseconds. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Two digits: `7` -> `"07"`. */
export const pad2 = (n: number) => String(n).padStart(2, '0');

/** A month's number (1-12) by the first three letters of its English name, lowercased. */
export const MONTH_NUMBERS: Readonly<Record<string, number>> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** A `YYYY-MM-DD` date plus `years`, as a string to compare against (Feb 29 compares as itself). */
export const plusYears = (date: string, years: number) => `${String(Number(date.slice(0, 4)) + years).padStart(4, '0')}${date.slice(4)}`;
