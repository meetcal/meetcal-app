// Who holds a record, stored beside each lift (`snatchBy`, `cjBy`, `totalBy`
// in the tables). Every records scraper builds these the same way:
//
// - `name` is the athlete as the source writes them, or "Standard" when the
//   lift has a value nobody has claimed yet (the sources say "STANDARD",
//   "World Standard", "Record Standard", "WSO Standard", or leave it blank).
//   A lift with no value (vacant, TBD, open, or 0 kg) has no holder at all.
// - `date` is ISO (YYYY-MM-DD) when the source's date can be read, the
//   source's text otherwise, and absent when there is none. Dates the
//   sources plainly got wrong are corrected (`correctRecordDate`).
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

/**
 * Dates the sources wrote wrong, for the holder they belong to: as written
 * (or as read, when they can be read) and what they mean. Each was checked
 * against the record's other lifts or the athlete's results.
 */
const DATE_CORRECTIONS: readonly { name: string; written: string; date: string }[] = [
  // UMWF, the June 2026 Masters Worlds in Adelaide, where the record's other
  // lifts were set: "0206" for 2026, and 2016 for 2026.
  { name: 'KULYK, Tamara', written: '11-June-0206', date: '2026-06-11' },
  { name: 'CASSIDY, Wes', written: '10-June-0206', date: '2026-06-10' },
  { name: 'SHNEIDMAN, Yakov', written: '2016-06-09', date: '2026-06-09' },
  // Tennessee-Kentucky: the 2025 Virus Finals (his results), written
  // "12//5/26", the sheet's usual year slip (see `FUTURE_SLACK_DAYS`).
  { name: 'Asher Hayhoe', written: '12//5/26', date: '2025-12-05' },
];

/**
 * How far past today a record date may be before it is taken for a slip of
 * the year: a record set today in a time zone ahead of UTC is not one.
 */
const FUTURE_SLACK_DAYS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `date` (as `recordDate` read it) with the sources' mistakes corrected: the
 * ones in `DATE_CORRECTIONS`, and a date that has not happened yet, which no
 * record can have. Those are the year before's, written with the new year
 * (Tennessee-Kentucky and Carolina dated the December 2025 Virus Finals
 * 2026), so they move back one year.
 */
export function correctRecordDate(name: string, date: string | undefined, today: Date): string | undefined {
  if (date === undefined) return undefined;
  const known = DATE_CORRECTIONS.find((c) => c.name === name && c.written === date);
  if (known) return known.date;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const latest = new Date(today.getTime() + FUTURE_SLACK_DAYS * DAY_MS).toISOString().slice(0, 10);
  if (date <= latest) return date;
  // The year before has no 29 February.
  const day = m[2] === '02' && m[3] === '29' ? '28' : m[3];
  return `${Number(m[1]) - 1}-${m[2]}-${day}`;
}

/** Meet and place as one location ("Asian Games, Nagoya, Japan"); blanks and dashes dropped. */
export function recordLocation(...parts: (string | null | undefined)[]): string | undefined {
  const kept = parts.map((part) => (part ?? '').replace(/\s+/g, ' ').trim()).filter((part) => !EMPTY.test(part));
  return kept.length ? [...new Set(kept)].join(', ') : undefined;
}

/**
 * The holder of a lift whose value is `value`: undefined when there is no
 * value (or 0 kg), "Standard" when the name is blank or a standard marker.
 */
export function recordHolder(
  value: number | null | undefined,
  name: string | null | undefined,
  date?: string | null,
  ...location: (string | null | undefined)[]
): RecordHolder | undefined {
  // 0 kg is how several sources list a class nobody has a record in.
  if (value === null || value === undefined || value <= 0) return undefined;
  const cleaned = (name ?? '').replace(/\s+/g, ' ').trim();
  const holder: RecordHolder = { name: EMPTY.test(cleaned) || STANDARD.test(cleaned) ? 'Standard' : cleaned };
  const when = correctRecordDate(holder.name, recordDate(date), new Date());
  if (when) holder.date = when;
  const where = recordLocation(...location);
  if (where) holder.location = where;
  return holder;
}
