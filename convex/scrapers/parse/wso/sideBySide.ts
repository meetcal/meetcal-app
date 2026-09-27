import { parseCsv } from '../../lib/csv';
import { recordHolder } from '../holder';
import { intOrNull, type WsoRecord } from './common';

// Side-by-side sheets: men on the left, women on the right, each weight class
// three rows (Snatch, C&J, Total) with the class written in the Snatch row
// and left blank for the open class above the last one. Each lift row also
// names who set it (Florida: athlete, date; Carolina: athlete, club, date,
// location). Ports of
// `auto_scrapers/scraper_florida.py` (a tab per age group) and
// `scraper_carolinas.py` (Youth and Masters tabs stack several age groups).

export type SideBySide = {
  /** Column the women's side starts at (the men's starts at 0). */
  womenColumn: number;
  /** Florida writes 0 for a class without a record. */
  zeroIsEmpty: boolean;
  /**
   * The tab's age group for its nth section. With `sections`, each header
   * row after the first (blank class, "Lift" on both sides) starts the next.
   */
  ageFor: (section: number) => string;
  sections: boolean;
  /** Columns after a side's first holding the lift's athlete, date and place (none for Florida). */
  holder: { name: number; date: number; location?: number };
};

const cell = (row: readonly string[] | undefined, column: number) => (row && row.length > column ? row[column].trim() : '');

export function parseSideBySide(csv: string, wso: string, layout: SideBySide): WsoRecord[] {
  const rows = parseCsv(csv);
  const records: WsoRecord[] = [];
  const value = (row: readonly string[] | undefined, column: number) => {
    const text = cell(row, column);
    if (!text) return null;
    const parsed = intOrNull(text);
    return layout.zeroIsEmpty && parsed === 0 ? null : parsed;
  };
  const lastClass: Record<'Men' | 'Women', string | null> = { Men: null, Women: null };
  let section = 0;

  rows.forEach((row, i) => {
    if (row.length < 10) return;
    const womenLift = cell(row, layout.womenColumn + 1);
    if (layout.sections && cell(row, 1) === 'Lift' && womenLift === 'Lift' && !cell(row, 0) && i > 5) {
      section += 1;
      lastClass.Men = null;
      lastClass.Women = null;
      return;
    }
    if (cell(row, 1) !== 'Snatch' && womenLift !== 'Snatch') return;
    const age = layout.ageFor(section);
    for (const [gender, column] of [
      ['Men', 0],
      ['Women', layout.womenColumn],
    ] as const) {
      // Both sides are read whenever either holds a Snatch row, as the Python
      // did; a blank class is the open class above the last one read.
      let weightClass = cell(row, column);
      if (!weightClass) {
        if (!lastClass[gender]) continue;
        weightClass = `${lastClass[gender]}+`;
      }
      const [snatch, cj, total] = [row, rows[i + 1], rows[i + 2]].map((liftRow) => {
        const lift = value(liftRow, column + 2);
        const { name, date, location } = layout.holder;
        const place = location === undefined ? undefined : cell(liftRow, column + location);
        return { lift, by: recordHolder(lift, cell(liftRow, column + name), cell(liftRow, column + date), place) };
      });
      const record: WsoRecord = {
        wso,
        age_category: age,
        gender,
        weight_class: weightClass,
        snatch_record: snatch.lift,
        cj_record: cj.lift,
        total_record: total.lift,
      };
      if (snatch.by) record.snatch_by = snatch.by;
      if (cj.by) record.cj_by = cj.by;
      if (total.by) record.total_by = total.by;
      records.push(record);
      if (!weightClass.endsWith('+')) lastClass[gender] = weightClass;
    }
  });
  return records;
}

/** Florida: one tab per age group, the women's side from column 6, 0 meaning no record; athlete and date beside the value. */
export const floridaLayout = (age: string): SideBySide => ({ womenColumn: 6, zeroIsEmpty: true, ageFor: () => age, sections: false, holder: { name: 3, date: 4 } });

const CAROLINA_MASTERS = [35, 40, 45, 50, 55, 60, 65, 70, 75];

/**
 * Carolinas: the women's side from column 8, athlete, club, date and location
 * beside the value; Youth stacks U13, U15, U17 and Masters 35 up to 75.
 */
export const carolinaLayout = (tab: 'Youth' | 'Junior' | 'Senior' | 'Masters'): SideBySide => ({
  womenColumn: 8,
  zeroIsEmpty: false,
  sections: true,
  holder: { name: 3, date: 5, location: 6 },
  ageFor: (section) => {
    if (tab === 'Youth') return section === 0 ? 'U13' : section === 1 ? 'U15' : 'U17';
    if (tab === 'Masters') return `Masters ${CAROLINA_MASTERS[Math.min(section, CAROLINA_MASTERS.length - 1)]}`;
    return tab;
  },
});
