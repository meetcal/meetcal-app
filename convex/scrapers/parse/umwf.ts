import { parseCsv } from '../lib/csv';

// Pure parsing for `scrapers/umwf.ts` (port of `usaw/records_scraper/umwf_records.py`).

export const MEN_BASE_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vSwEmZokL7Cv1aL8fHYLymDHR6NeEDpWqpViZnaQC8MuoIKVhugHf4uusZIAzY6jwYG5x1knY4ALqwG/pub';
export const MEN_SHEETS: [string, number][] = [
  ['Masters 30', 1439699993],
  ['Masters 35', 13462089],
  ['Masters 40', 262732551],
  ['Masters 45', 2010721745],
  ['Masters 50', 1445013360],
  ['Masters 55', 847049674],
  ['Masters 60', 1331993330],
  ['Masters 65', 1717622796],
  ['Masters 70', 266239647],
  ['Masters 75', 1382156124],
  ['Masters 80', 191193548],
];

export const WOMEN_BASE_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vSSSAfhhZJEJzA9w9Fk6pbsBI2YOtBgcVpbO6mSj6SnY0RGumjsSzCRSrnHMS-yOhli4DSK5CHBPXol/pub';
export const WOMEN_SHEETS: [string, number][] = [
  ['Masters 30', 1439699993],
  ['Masters 35', 1137230161],
  ['Masters 40', 84830211],
  ['Masters 45', 675957304],
  ['Masters 50', 1735680617],
  ['Masters 55', 50753700],
  ['Masters 60', 75329579],
  ['Masters 65', 2072176452],
  ['Masters 70', 570426830],
  ['Masters 75', 809481028],
  ['Masters 80', 1803872396],
];

export const sheetCsvUrl = (baseUrl: string, gid: number) => `${baseUrl}?gid=${gid}&single=true&output=csv`;

export type UmwfRecord = {
  record_type: 'UMWF';
  age_category: string;
  gender: string;
  weight_class: string;
  snatch_record: number;
  cj_record: number;
  total_record: number;
};

/** "110+ kg Category" -> "110+kg". */
export function formatWeightClass(text: string): string | null {
  const match = /(\d+)(\+)?\s*kg/i.exec(text);
  return match ? `${match[1]}${match[2] ?? ''}kg` : null;
}

/** Python's `int(float(s))` for the lift cells; null where that would raise. */
function toInt(value: string): number | null {
  if (!/^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(value)) return null;
  return Math.trunc(Number(value));
}

/**
 * One tab: a `… kg Category` row opens a weight class, then `Snatch`,
 * `Clean & Jerk` and `Total` rows fill it (a `Standard` value leaves a lift
 * at 0).
 */
export function parseUmwfSheet(csv: string, ageCategory: string, gender: string): UmwfRecord[] {
  const records: UmwfRecord[] = [];
  let current: UmwfRecord | null = null;
  for (const row of parseCsv(csv)) {
    if (row.length < 3) continue;
    if (row[1].includes('kg Category')) {
      if (current) records.push(current);
      const weightClass = formatWeightClass(row[1]);
      current = weightClass
        ? { record_type: 'UMWF', age_category: ageCategory, gender, weight_class: weightClass, snatch_record: 0, cj_record: 0, total_record: 0 }
        : null;
      continue;
    }
    if (!current) continue;
    const lift = row[1].trim();
    const value = row[2].trim();
    if (!value || value.toUpperCase() === 'STANDARD') continue;
    const weight = toInt(value);
    if (weight === null) continue;
    if (lift === 'Snatch') current.snatch_record = weight;
    else if (lift === 'Clean & Jerk') current.cj_record = weight;
    else if (lift === 'Total') current.total_record = weight;
  }
  if (current) records.push(current);
  return records;
}
