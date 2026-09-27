import { parseCsv } from '../../lib/csv';
import { intOrNull, type WsoRecord } from './common';

// Tennessee-Kentucky (port of `auto_scrapers/scraper_tnky.py`): one tab of
// horizontal sections. Each starts with a header ("MASTERS: MEN" in column 0,
// "35-39 years old" in column 2) on or just above a row of classes ("44 KG"),
// then three rows (value, name, date) for each of snatch, C&J and total.

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

/** Each class's value in a lift's value row (a later column wins for a repeated class). */
function liftValues(row: readonly string[], classes: readonly (string | null)[]): Map<string, number> {
  const values = new Map<string, number>();
  classes.forEach((weightClass, index) => {
    if (!weightClass || index + 1 >= row.length) return;
    const text = row[index + 1].trim();
    const value = text ? intOrNull(text) : null;
    if (value !== null) values.set(weightClass, value);
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
    const [snatch, cj, total] = [rows[i + 1], rows[i + 4], rows[i + 7]].map((valueRow) => liftValues(valueRow, classes));
    for (const weightClass of classes) {
      if (!weightClass) continue;
      records.push({
        wso,
        age_category: section[0],
        gender: section[1],
        weight_class: weightClass,
        snatch_record: snatch.get(weightClass) ?? null,
        cj_record: cj.get(weightClass) ?? null,
        total_record: total.get(weightClass) ?? null,
      });
    }
    i += 9;
  }
  return records;
}
