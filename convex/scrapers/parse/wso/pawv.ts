import { parseCsv } from '../../lib/csv';
import { intOrNull, type WsoRecord } from './common';

// Pennsylvania-West Virginia (port of `auto_scrapers/scraper_pawv.py`): a
// published sheet with a tab per age group and gender, read down column A:
// section headers ("Men's 14-15 Age Group", "Women's Masters (35-39)"), class
// rows ("40kg", "+65kg"), then Snatch, Clean & Jerk and Total rows with the
// weight in column D.
//
// The Python reset the class at each section header without saving it, so
// the heaviest class of every section but a tab's last was never written
// (Postgres still holds values an older version wrote for them). Here a
// section header saves the class before it, like a class row does.

export type PawvTab = { gid: string; gender: 'Men' | 'Women'; base: 'Youth' | 'Junior' | 'Senior' | 'Masters' };

export const PAWV_TABS: PawvTab[] = [
  { gid: '908123897', gender: 'Men', base: 'Youth' },
  { gid: '1470799505', gender: 'Women', base: 'Youth' },
  { gid: '1650165633', gender: 'Men', base: 'Junior' },
  { gid: '80509707', gender: 'Women', base: 'Junior' },
  { gid: '1381991871', gender: 'Men', base: 'Senior' },
  { gid: '1545069771', gender: 'Women', base: 'Senior' },
  { gid: '14757518', gender: 'Men', base: 'Masters' },
  { gid: '846901037', gender: 'Women', base: 'Masters' },
];

export const pawvCsvUrl = (publishedId: string, gid: string) =>
  `https://docs.google.com/spreadsheets/d/e/${publishedId}/pub?gid=${gid}&single=true&output=csv`;

/** "Men's 13 Under Age Group" -> U13, "Women's Masters (40-44)" -> Masters 40; Junior and Senior tabs have one section. */
export function pawvSection(header: string, base: PawvTab['base']): string | null {
  const text = header.trim();
  if (text.includes('13') && text.includes('Under')) return 'U13';
  if (text.includes('14-15') || text.includes('14 - 15')) return 'U15';
  if (text.includes('16-17') || text.includes('16 - 17')) return 'U17';
  if (text.includes('Masters')) {
    const range = /\((\d+)-\d+\)/.exec(text);
    if (range) return `Masters ${range[1]}`;
  }
  return base === 'Junior' || base === 'Senior' ? base : null;
}

/** "40kg" -> 40, "+65kg" -> 65+. */
export function pawvWeightClass(raw: string): string | null {
  const text = raw.trim();
  if (text.startsWith('+')) {
    const open = /\+(\d+)/.exec(text);
    if (open) return `${open[1]}+`;
  }
  return /(\d+)/.exec(text)?.[1] ?? null;
}

function lift(raw: string): number | null {
  const text = raw.trim();
  if (!text || text.toUpperCase() === 'STANDARD') return null;
  return intOrNull(text);
}

export function parsePawvTab(csv: string, wso: string, { gender, base }: PawvTab): WsoRecord[] {
  const records: WsoRecord[] = [];
  let age: string | null = base === 'Junior' || base === 'Senior' ? base : null;
  let weightClass: string | null = null;
  let lifts: { snatch: number | null; cj: number | null; total: number | null } = { snatch: null, cj: null, total: null };
  const save = () => {
    if (weightClass && age) {
      records.push({ wso, age_category: age, gender, weight_class: weightClass, snatch_record: lifts.snatch, cj_record: lifts.cj, total_record: lifts.total });
    }
  };

  for (const row of parseCsv(csv.trim())) {
    if (row.length < 4) continue;
    const first = row[0].trim();
    if ((first.includes('Age Group') || first.includes('Masters')) && (first.includes(gender) || first.includes("Men's") || first.includes("Women's"))) {
      const section = pawvSection(first, base);
      if (section) {
        save();
        age = section;
        weightClass = null;
        lifts = { snatch: null, cj: null, total: null };
      }
      continue;
    }
    if ((base === 'Junior' || base === 'Senior') && (first.includes(`${base} ${gender}`) || first.includes(`Open ${gender}`) || first.includes(`${gender}'s`))) continue;
    if (first.endsWith('kg') || (first.startsWith('+') && first.includes('kg'))) {
      save();
      const parsed = pawvWeightClass(first);
      if (parsed) {
        weightClass = parsed;
        lifts = { snatch: null, cj: null, total: null };
      }
      continue;
    }
    if (first === 'Snatch') lifts.snatch = lift(row[3]);
    else if (first === 'Clean & Jerk') lifts.cj = lift(row[3]);
    else if (first === 'Total') lifts.total = lift(row[3]);
  }
  save();
  return records;
}
