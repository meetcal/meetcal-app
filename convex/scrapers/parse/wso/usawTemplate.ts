import { parseCsv } from '../../lib/csv';
import { recordDate, recordHolder } from '../holder';
import { intOrNull, type WsoRecord } from './common';
import { normalizeAgeGroup } from './flat';

// WSO record sheets kept in USA Weightlifting's record template, one lift per
// row: WSO, record name, age group, gender, age min/max, body weight min/max,
// lift, record, name, then the holder's details. Minnesota-Dakotas and
// Texas-Oklahoma ("Detailed" tab) use it.
//
// Columns are read by position: Texas-Oklahoma's age-group header carries a
// "Current as of" note, and Minnesota-Dakotas' headers stop at "name, date,
// place, event" while a claimed record's row goes on name, born, club, date,
// place, group, event (only a standard's row fits the headers). So a row
// whose 14th cell is a date is the long form; otherwise date, place and event
// follow the name. A record of 0 is no record: the sheets list classes
// without a standard that way.
//
// A class is named by its body-weight maximum, or "<min>+" for the open top
// class, which the sheets write with ">" (">86"), a blank, or Texas-Oklahoma's
// 999. The rows of a class (one per lift) share its minimum, and a class's
// maximum is the next class's minimum, so where a class's rows disagree on
// the maximum, or name one at or below the minimum, that ladder decides:
// Minnesota-Dakotas lists Junior Women 69-77's snatch as 69-65 and its
// total as 69-140.

const COLUMN = { age: 2, gender: 3, min: 6, max: 7, lift: 8, record: 9, name: 10 } as const;

const LIFTS: Record<string, 'snatch' | 'cj' | 'total'> = {
  snatch: 'snatch',
  'clean & jerk': 'cj',
  'clean and jerk': 'cj',
  cleanjerk: 'cj',
  'c&j': 'cj',
  total: 'total',
};

const isDate = (text: string | undefined) => /^\d{4}-\d{2}-\d{2}$/.test(recordDate(text) ?? '');

/** A maximum no body weight reaches: the sheet's way of writing an open class (Texas-Oklahoma writes 999). */
const NO_LIMIT_KG = 300;

/** The class a row's body-weight minimum and maximum name, as written. */
function writtenClass(min: string, max: string): string | null {
  if (max.includes('>')) return `${max.replaceAll('>', '')}+`;
  if (max && !(/^\d+$/.test(max) && Number(max) >= NO_LIMIT_KG)) return max;
  return min ? `${min}+` : null;
}

/** Whether a class fits its minimum: a maximum above it, or the open class from it. */
function fits(weightClass: string, min: string): boolean {
  if (weightClass.endsWith('+')) return weightClass === `${min}+`;
  return !/^\d+(?:\.\d+)?$/.test(min) || Number(weightClass) > Number(min);
}

type Row = { age: string; gender: string; min: string; written: string; cell: (index: number) => string; lift: 'snatch' | 'cj' | 'total' };

/**
 * Each class's name by its age group, gender and minimum: what its rows
 * write when they agree and it fits, else the ladder's (the next minimum up,
 * or "<min>+" at the top), with a warning.
 */
function classNames(rows: readonly Row[], wso: string, warnings: string[]): Map<string, string> {
  const written = new Map<string, Set<string>>();
  const ladders = new Map<string, number[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.age, row.gender, row.min]);
    written.set(key, (written.get(key) ?? new Set()).add(row.written));
    const ladder = JSON.stringify([row.age, row.gender]);
    if (/^\d+(?:\.\d+)?$/.test(row.min)) ladders.set(ladder, [...(ladders.get(ladder) ?? []), Number(row.min)]);
  }
  const names = new Map<string, string>();
  for (const [key, classes] of written) {
    const [age, gender, min] = JSON.parse(key) as [string, string, string];
    const [only] = classes;
    if (classes.size === 1 && fits(only, min)) {
      names.set(key, only);
      continue;
    }
    const next = (ladders.get(JSON.stringify([age, gender])) ?? []).filter((m) => m > Number(min)).sort((a, b) => a - b)[0];
    const name = next === undefined ? `${min}+` : String(next);
    warnings.push(`${wso} ${age} ${gender} from ${min} kg: the sheet names it ${[...classes].join(', ')}; stored as ${name}`);
    names.set(key, name);
  }
  return names;
}

/** The sheet's records, and warnings about rows it had to correct. */
export function parseUsawTemplate(csv: string, wso: string): { records: WsoRecord[]; warnings: string[] } {
  const parsed: Row[] = [];
  const [, ...lines] = parseCsv(csv);
  for (const line of lines) {
    const cell = (index: number) => (line[index] ?? '').trim();
    const gender = cell(COLUMN.gender) === 'F' ? 'Women' : cell(COLUMN.gender) === 'M' ? 'Men' : null;
    const lift = LIFTS[cell(COLUMN.lift).toLowerCase()];
    if (!cell(COLUMN.age) || !gender || !lift) continue;
    const age = normalizeAgeGroup(cell(COLUMN.age));
    if (age.includes('ADAP')) continue;
    const min = cell(COLUMN.min);
    const written = writtenClass(min, cell(COLUMN.max));
    if (!written) continue;
    parsed.push({ age, gender, min, written, cell, lift });
  }
  const warnings: string[] = [];
  const names = classNames(parsed, wso, warnings);
  const grouped = new Map<string, WsoRecord>();
  for (const { age, gender, min, cell, lift } of parsed) {
    const weightClass = names.get(JSON.stringify([age, gender, min]))!;
    const recordValue = intOrNull(cell(COLUMN.record));
    const value = recordValue ? recordValue : null;
    const long = isDate(cell(13));
    const [date, place, event] = long ? [cell(13), cell(14), cell(16)] : [cell(11), cell(12), cell(13)];
    const key = JSON.stringify([age, gender, weightClass]);
    const entry = grouped.get(key) ?? { wso, age_category: age, gender, weight_class: weightClass, snatch_record: null, cj_record: null, total_record: null };
    grouped.set(key, entry);
    entry[`${lift}_record`] = value;
    const by = recordHolder(value, cell(COLUMN.name), date, event, place);
    if (by) entry[`${lift}_by`] = by;
    else delete entry[`${lift}_by`];
  }
  return { records: [...grouped.values()], warnings };
}
