// Who holds a record, stored beside each lift (`snatchBy`, `cjBy`, `totalBy`
// in the tables). Every records scraper builds these the same way:
//
// - `name` is the athlete as the source writes them, or "Standard" when the
//   lift has a value nobody has claimed yet (the sources say "STANDARD",
//   "World Standard", "Record Standard", "WSO Standard", or leave it blank).
//   A lift with no value (vacant, TBD, open) has no holder at all.
// - `date` is ISO (YYYY-MM-DD) when the source's date can be read, the
//   source's text otherwise, and absent when there is none.
// - `location` is where it was set: the meet and the place, joined with a
//   comma when the source gives both, either one alone otherwise.

export type RecordHolder = { name: string; date?: string; location?: string };

const STANDARD = /^(?:(?:world|record|wso|state|american|national)\s+)?standard$/i;
const EMPTY = /^(?:-+|–|—|n\/?a|none|tbd|vacant|open)?$/i;

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const pad = (n: number) => String(n).padStart(2, '0');

function iso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** "2026-08-01", "8/1/2026", "3/3/22", "13 May 2026", "May 13, 2026" -> ISO; other text is kept as written; blank -> undefined. */
export function recordDate(raw: string | null | undefined): string | undefined {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (EMPTY.test(text)) return undefined;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3])) ?? text;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(text);
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return iso(year, Number(m[1]), Number(m[2])) ?? text;
  }
  m = /^(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})$/.exec(text);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return iso(Number(m[3]), MONTHS[m[2].slice(0, 3).toLowerCase()], Number(m[1])) ?? text;
  m = /^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(text);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return iso(Number(m[3]), MONTHS[m[1].slice(0, 3).toLowerCase()], Number(m[2])) ?? text;
  return text;
}

/** Meet and place as one location ("Asian Games, Nagoya, Japan"); blanks and dashes dropped. */
export function recordLocation(...parts: (string | null | undefined)[]): string | undefined {
  const kept = parts.map((part) => (part ?? '').replace(/\s+/g, ' ').trim()).filter((part) => !EMPTY.test(part));
  return kept.length ? [...new Set(kept)].join(', ') : undefined;
}

/**
 * The holder of a lift whose value is `value`: undefined when there is no
 * value, "Standard" when the name is blank or a standard marker.
 */
export function recordHolder(
  value: number | null | undefined,
  name: string | null | undefined,
  date?: string | null,
  ...location: (string | null | undefined)[]
): RecordHolder | undefined {
  if (value === null || value === undefined) return undefined;
  const cleaned = (name ?? '').replace(/\s+/g, ' ').trim();
  const holder: RecordHolder = { name: EMPTY.test(cleaned) || STANDARD.test(cleaned) ? 'Standard' : cleaned };
  const when = recordDate(date);
  if (when) holder.date = when;
  const where = recordLocation(...location);
  if (where) holder.location = where;
  return holder;
}
