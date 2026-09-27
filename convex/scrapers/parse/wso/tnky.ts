import { parseCsv } from '../../lib/csv';
import { recordHolder, type RecordHolder } from '../holder';
import { intOrNull, type WsoRecord } from './common';

// Tennessee-Kentucky (port of `auto_scrapers/scraper_tnky.py`): one tab of
// horizontal sections. Each starts with a header ("MASTERS: MEN" in column 0,
// "35-39 years old" in column 2) on or just above a row of classes ("44 KG"),
// then three rows (value, name, date) for each of snatch, C&J and total.
// A class marked "77 KG*" is footnoted "*Unsubmitted"; its record and holder
// are kept as written.

/** "YOUTH: WOMEN 14-17 YO" -> ["U17", "Women"]; null when it is no section header. */
export function tnkySection(header: string): [age: string, gender: 'Men' | 'Women'] | null {
  const text = header.trim().toUpperCase();
  const gender = text.includes('WOMEN') ? 'Women' : text.includes('MEN') ? 'Men' : null;
  if (!gender) return null;
  if (text.includes('13') && text.includes('UNDER')) return ['U13', gender];
  if (text.includes('14-17') || text.includes('14 - 17')) return ['U17', gender];
  if (text.includes('SENIOR')) return ['Senior', gender];
  if (text.includes('JUNIOR')) return ['Junior', gender];
  if (text.includes('MASTER')) {
    const range = /(\d+)\s*-\s*(\d+)/.exec(text);
    if (range) return [`Masters ${range[1]}`, gender];
  }
  return null;
}

/** The class in each column after the first ("65+ KG" -> "65+"), null where there is none. */
function weightClasses(row: readonly string[]): (string | null)[] {
  return row.slice(1).map((raw) => {
    const text = raw.trim();
    if (!text.toUpperCase().includes('KG')) return null;
    return /(\d+\+?)\s*KG/i.exec(text)?.[1] ?? null;
  });
}

/**
 * Each class's value in a lift's value row and who set it, from the name and
 * date rows below it (a later column wins for a repeated class).
 */
function liftValues(
  [row, names, dates]: readonly (readonly string[])[],
  classes: readonly (string | null)[],
): Map<string, { value: number; by: RecordHolder | undefined }> {
  const values = new Map<string, { value: number; by: RecordHolder | undefined }>();
  classes.forEach((weightClass, index) => {
    if (!weightClass || index + 1 >= row.length) return;
    const text = row[index + 1].trim();
    const value = text ? intOrNull(text) : null;
    if (value !== null) values.set(weightClass, { value, by: recordHolder(value, names[index + 1], dates[index + 1]) });
  });
  return values;
}

export function parseTnky(csv: string, wso: string): WsoRecord[] {
  const rows = parseCsv(csv);
  const records: WsoRecord[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.length || !row[0]) continue;
    const section = tnkySection(`${row[0].trim()} ${row.length > 2 ? row[2].trim() : ''}`);
    if (!section) continue;
    let classes: (string | null)[] = [];
    if (row.slice(1, 9).some((cell) => cell.toUpperCase().includes('KG'))) {
      classes = weightClasses(row);
    } else if (i + 1 < rows.length) {
      i += 1;
      classes = weightClasses(rows[i]);
    }
    if (i + 9 >= rows.length) continue;
    const [snatch, cj, total] = [i + 1, i + 4, i + 7].map((at) => liftValues(rows.slice(at, at + 3), classes));
    for (const weightClass of classes) {
      if (!weightClass) continue;
      const [snatchLift, cjLift, totalLift] = [snatch, cj, total].map((lift) => lift.get(weightClass));
      const record: WsoRecord = {
        wso,
        age_category: section[0],
        gender: section[1],
        weight_class: weightClass,
        snatch_record: snatchLift?.value ?? null,
        cj_record: cjLift?.value ?? null,
        total_record: totalLift?.value ?? null,
      };
      if (snatchLift?.by) record.snatch_by = snatchLift.by;
      if (cjLift?.by) record.cj_by = cjLift.by;
      if (totalLift?.by) record.total_by = totalLift.by;
      records.push(record);
    }
    i += 9;
  }
  return records;
}
