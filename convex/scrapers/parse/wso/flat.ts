import { parseCsvDicts } from '../../lib/csv';
import { intOrNull, type WsoRecord } from './common';

// Flat-format sheets, one lift per row (port of `auto_scrapers/scraper_ga_pnw.py`;
// Georgia, Pacific Northwest, California North; and of
// `scraper_california_south_auto.py` and `scraper_dmv.py`, the same layout
// under other column names).
//
// The class is the body-weight upper bound (`0-30` is 30, `30-33` is 33, an
// open-ended `61-` is 61+). The California South Python scraper took the
// lower bound whenever it was above 0, which filed every class's records
// under the class below and overwrote the lightest class; that is not ported.

export const FLAT_SHEET_NAME = 'Current Records';

/** JR -> Junior, Open -> Senior, M35/W35 -> Masters 35, suffixes (" ADAP") kept. */
export function normalizeAgeGroup(raw: string): string {
  const ageGroup = raw.trim();
  const upper = ageGroup.toUpperCase();
  if (upper.startsWith('JR')) return ageGroup.replace('JR', 'Junior').replace('jr', 'Junior');
  if (upper.startsWith('OPEN')) {
    const match = /^(open)(.*)$/is.exec(ageGroup);
    if (match) return `Senior${match[2]}`;
  }
  const masters = /^[MW](\d+)(.*)$/is.exec(ageGroup);
  if (masters) return `Masters ${masters[1]}${masters[2]}`;
  return ageGroup;
}

/** Where a sheet keeps each field. */
export type FlatColumns = { age: string; gender: string; min: string; max: string; lift: string; record: string };

export const FLAT_COLUMNS: FlatColumns = { age: 'ageGroup', gender: 'gender', min: 'bodyWeightMin', max: 'bodyWeightMax', lift: 'lift', record: 'record' };

const CJ = new Set(['clean & jerk', 'clean and jerk', 'c&j', 'cleanjerk']);

/** Rows grouped by (age, gender, class), adaptive groups skipped, in first-seen order. */
export function parseFlatSheet(csv: string, wso: string, columns: FlatColumns = FLAT_COLUMNS): WsoRecord[] {
  const grouped = new Map<string, WsoRecord>();
  for (const row of parseCsvDicts(csv)) {
    const ageRaw = (row[columns.age] ?? '').trim();
    const genderRaw = (row[columns.gender] ?? '').trim();
    const weightMin = (row[columns.min] ?? '').trim();
    const weightMax = (row[columns.max] ?? '').trim();
    const lift = (row[columns.lift] ?? '').trim().toLowerCase();
    const value = (row[columns.record] ?? '').trim();
    if (!ageRaw || !genderRaw) continue;
    const gender = genderRaw === 'F' ? 'Women' : genderRaw === 'M' ? 'Men' : null;
    if (!gender) continue;
    const age = normalizeAgeGroup(ageRaw);
    if (age.includes('ADAP')) continue;
    let weightClass: string;
    if (!weightMax && weightMin) weightClass = `${weightMin}+`;
    else if (weightMax) weightClass = weightMax.includes('>') ? `${weightMax.replaceAll('>', '')}+` : weightMax;
    else continue;
    const field = lift === 'snatch' ? 'snatch_record' : CJ.has(lift) ? 'cj_record' : lift === 'total' ? 'total_record' : null;
    // A row with any other lift never creates its group (Python's defaultdict
    // is only touched in the three branches).
    if (!field) continue;
    const key = JSON.stringify([age, gender, weightClass]);
    const entry = grouped.get(key) ?? { wso, age_category: age, gender, weight_class: weightClass, snatch_record: null, cj_record: null, total_record: null };
    entry[field] = value ? intOrNull(value) : null;
    grouped.set(key, entry);
  }
  return [...grouped.values()];
}
