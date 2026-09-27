import { parseCsv } from '../../lib/csv';
import { intOrNull, type WsoRecord } from './common';

// New Jersey (port of `auto_scrapers/scraper_newjersey.py`): a tab per age
// group, one row per class, women in columns 1-6 and men in 8-13 (class,
// athlete, date, snatch, C&J, total). A blank class is the open class above
// the last one read.

const cell = (row: readonly string[], column: number) => (row.length > column ? row[column].trim() : '');

/** A lift, with 0 meaning no record. */
function lift(row: readonly string[], column: number): number | null {
  const text = cell(row, column);
  if (!text) return null;
  const value = intOrNull(text);
  return value === 0 ? null : value;
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
      records.push({
        wso,
        age_category: age,
        gender,
        weight_class: weightClass,
        snatch_record: lift(row, column + 3),
        cj_record: lift(row, column + 4),
        total_record: lift(row, column + 5),
      });
      if (!weightClass.endsWith('+')) lastClass[gender] = weightClass;
    }
  });
  return records;
}

/**
 * One record per (age, gender, class), a class listed on several rows (split
 * records, the rows under an open class) keeping each lift's best value.
 */
export function consolidateRecords(records: readonly WsoRecord[]): WsoRecord[] {
  const grouped = new Map<string, WsoRecord>();
  const best = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.max(a, b));
  for (const record of records) {
    const key = JSON.stringify([record.wso, record.age_category, record.gender, record.weight_class]);
    const seen = grouped.get(key);
    if (!seen) {
      grouped.set(key, { ...record });
      continue;
    }
    seen.snatch_record = best(seen.snatch_record, record.snatch_record);
    seen.cj_record = best(seen.cj_record, record.cj_record);
    seen.total_record = best(seen.total_record, record.total_record);
  }
  return [...grouped.values()];
}
