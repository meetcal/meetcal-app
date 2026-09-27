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

export function parseUsawTemplate(csv: string, wso: string): WsoRecord[] {
  const grouped = new Map<string, WsoRecord>();
  const [, ...rows] = parseCsv(csv);
  for (const row of rows) {
    const cell = (index: number) => (row[index] ?? '').trim();
    const gender = cell(COLUMN.gender) === 'F' ? 'Women' : cell(COLUMN.gender) === 'M' ? 'Men' : null;
    const lift = LIFTS[cell(COLUMN.lift).toLowerCase()];
    if (!cell(COLUMN.age) || !gender || !lift) continue;
    const age = normalizeAgeGroup(cell(COLUMN.age));
    if (age.includes('ADAP')) continue;
    const min = cell(COLUMN.min);
    const max = cell(COLUMN.max);
    const weightClass = max ? (max.includes('>') ? `${max.replaceAll('>', '')}+` : max) : min ? `${min}+` : null;
    if (!weightClass) continue;
    const parsed = intOrNull(cell(COLUMN.record));
    const value = parsed ? parsed : null;
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
  return [...grouped.values()];
}
