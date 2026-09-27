import { parseCsv } from '../../lib/csv';
import { recordHolder } from '../holder';
import { intOrNull, type WsoRecord } from './common';

// New Jersey (port of `auto_scrapers/scraper_newjersey.py`): a tab per age
// group, one row per class, women in columns 1-6 and men in 8-13 (class,
// athlete, date and meet, snatch, C&J, total). A blank class is the open
// class above the last one read. The row's athlete and date hold whichever
// of its lifts have a value ("Vacant" rows have none).

const cell = (row: readonly string[], column: number) => (row.length > column ? row[column].trim() : '');

/** A lift, with 0 meaning no record. */
function lift(row: readonly string[], column: number): number | null {
  const text = cell(row, column);
  if (!text) return null;
  const value = intOrNull(text);
  return value === 0 ? null : value;
}

const NUMERIC_DATE = /\d{1,2}\/\d{1,2}\/\d{2,4}/;
const WORDY_DATE = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}/i;

/**
 * The "Date/ Location" cell split into its date and the meet around it:
 * "10/25/2025 NJ WSO Championships", "Dog Days Open, August 17, 2025",
 * "Virus Weightlifting Series 2, Dallas, TX 8/28/2025". No date found: all
 * of it is the location.
 */
export function splitDateLocation(raw: string): { date?: string; location?: string } {
  const text = raw.replace(/\s+/g, ' ').trim();
  const match = NUMERIC_DATE.exec(text) ?? WORDY_DATE.exec(text);
  if (!match) return text ? { location: text } : {};
  const rest = `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`.replace(/\s+/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '');
  return rest ? { date: match[0], location: rest } : { date: match[0] };
}

export function parseNewJerseyTab(csv: string, wso: string, age: string): WsoRecord[] {
  const sides = [
    ['Women', 1],
    ['Men', 8],
  ] as const;
  const lastClass: Record<'Men' | 'Women', string | null> = { Men: null, Women: null };
  const records: WsoRecord[] = [];
  parseCsv(csv).forEach((row, i) => {
    if (row.length < 14 || i === 0) return;
    for (const [gender, column] of sides) {
      let weightClass = cell(row, column);
      if (!weightClass) {
        if (!lastClass[gender]) continue;
        weightClass = `${lastClass[gender]}+`;
      }
      const record: WsoRecord = {
        wso,
        age_category: age,
        gender,
        weight_class: weightClass,
        snatch_record: lift(row, column + 3),
        cj_record: lift(row, column + 4),
        total_record: lift(row, column + 5),
      };
      const athlete = cell(row, column + 1);
      const { date, location } = splitDateLocation(cell(row, column + 2));
      const snatchBy = recordHolder(record.snatch_record, athlete, date, location);
      const cjBy = recordHolder(record.cj_record, athlete, date, location);
      const totalBy = recordHolder(record.total_record, athlete, date, location);
      if (snatchBy) record.snatch_by = snatchBy;
      if (cjBy) record.cj_by = cjBy;
      if (totalBy) record.total_by = totalBy;
      records.push(record);
      if (!weightClass.endsWith('+')) lastClass[gender] = weightClass;
    }
  });
  return records;
}

const LIFTS = [
  ['snatch_record', 'snatch_by'],
  ['cj_record', 'cj_by'],
  ['total_record', 'total_by'],
] as const;

/**
 * One record per (age, gender, class), a class listed on several rows (split
 * records, the rows under an open class) keeping each lift's best value and
 * whoever set it (the first listed on a tie).
 */
export function consolidateRecords(records: readonly WsoRecord[]): WsoRecord[] {
  const grouped = new Map<string, WsoRecord>();
  for (const record of records) {
    const key = JSON.stringify([record.wso, record.age_category, record.gender, record.weight_class]);
    const seen = grouped.get(key);
    if (!seen) {
      grouped.set(key, { ...record });
      continue;
    }
    for (const [value, by] of LIFTS) {
      const incoming = record[value];
      const current = seen[value];
      if (incoming === null || (current !== null && incoming <= current)) continue;
      seen[value] = incoming;
      const holder = record[by];
      if (holder) seen[by] = holder;
      else delete seen[by];
    }
  }
  return [...grouped.values()];
}
