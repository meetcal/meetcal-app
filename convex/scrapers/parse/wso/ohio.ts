import { parseCsv } from '../../lib/csv';
import { recordHolder, type RecordHolder } from '../holder';
import { intOrNull, type WsoRecord } from './common';

// Ohio (port of `auto_scrapers/scraper_ohio.py`, its public-sheet path): a
// tab per age group and gender ("Masters Women"), read down column A:
// age subdivision rows ("35 - 39"), class rows ("49 kg"), then Snatch, C&J
// and Total rows with the weight in column D. The first row is a merged
// title that can carry the first subdivision and class. A lift row names
// its holder: Athlete (B, "WSO Standard" or blank for a standard), Date (E),
// Meet (F) and Location (G).

export const OHIO_TABS = ['Youth Women', 'Youth Men', 'Junior Women', 'Junior Men', 'Senior Women', 'Senior Men', 'Masters Women', 'Masters Men'] as const;

type OhioTab = (typeof OHIO_TABS)[number];

type Lift = { value: number | null; by?: RecordHolder };
const NO_LIFT: Lift = { value: null };

const HEADER_WORDS = new Set(['lift', 'athlete', 'team', 'weight', 'date', 'meet', 'location']);
const LIFTS = new Set(['snatch', 'clean & jerk', 'clean and jerk', 'c&j', 'total']);

/** "13 and Under" -> U13; "35 - 39" -> Masters 35 on Masters tabs, "14-15" -> U15 elsewhere. */
function ageSubdivision(raw: string, category: string): string {
  const text = raw.trim();
  if (text.toLowerCase().includes('and under')) return `U${text.split(/\s+/)[0]}`;
  for (const separator of ['-', ' - ']) {
    if (!text.includes(separator)) continue;
    const parts = text.split(separator);
    if (parts.length === 2) return category === 'Masters' ? `Masters ${parts[0].trim()}` : `U${parts[1].trim()}`;
  }
  if (text.toLowerCase() === 'total') return 'Total';
  return text;
}

export function parseOhioTab(csv: string, wso: string, tab: OhioTab): WsoRecord[] {
  const [category, gender] = tab.split(' ') as [string, 'Men' | 'Women'];
  const records: WsoRecord[] = [];
  const seen = new Set<string>();
  let age: string | null = category === 'Junior' || category === 'Senior' ? category : null;
  let weightClass: string | null = null;
  let lifts: { snatch: Lift; cj: Lift; total: Lift } = { snatch: NO_LIFT, cj: NO_LIFT, total: NO_LIFT };

  const save = () => {
    if (!weightClass || !age) return;
    const key = JSON.stringify([age, weightClass]);
    if (seen.has(key)) return;
    seen.add(key);
    const { snatch, cj, total } = lifts;
    records.push({
      wso,
      age_category: age,
      gender,
      weight_class: weightClass,
      snatch_record: snatch.value,
      cj_record: cj.value,
      total_record: total.value,
      ...(snatch.by && { snatch_by: snatch.by }),
      ...(cj.by && { cj_by: cj.by }),
      ...(total.by && { total_by: total.by }),
    });
  };

  parseCsv(csv).forEach((row, i) => {
    const first = (row[0] ?? '').trim();
    const second = (row[1] ?? '').trim();
    if (!first) return;
    const lower = first.toLowerCase();

    if (i === 0 && lower.includes('lift')) {
      if (lower.includes('and under')) {
        const digits = lower.split('and under')[0].trim().split(/\s+/).reverse().find((word) => /^\d+$/.test(word));
        if (digits) age = `U${digits}`;
      }
      const range = /(\d+)\s*-\s*(\d+)/.exec(first);
      if (range) age = Number(range[1]) >= 35 ? `Masters ${range[1]}` : `U${range[2]}`;
      const kg = /(\d+)\s*kg/.exec(lower);
      if (kg) weightClass = kg[1];
      return;
    }
    if (HEADER_WORDS.has(lower)) return;

    if (LIFTS.has(lower)) {
      const cell = row.length > 3 ? row[3].trim() : '';
      const value = cell ? intOrNull(cell) : null;
      const lift: Lift = { value, by: recordHolder(value, row[1], row[4], row[5], row[6]) };
      if (lower === 'snatch') lifts.snatch = lift;
      else if (lower === 'total') {
        lifts.total = lift;
        save();
        weightClass = null;
        lifts = { snatch: NO_LIFT, cj: NO_LIFT, total: NO_LIFT };
      } else lifts.cj = lift;
    } else if (lower.includes('kg')) {
      save();
      weightClass = first.replaceAll(' kg', '').replaceAll('kg', '').trim();
      lifts = { snatch: NO_LIFT, cj: NO_LIFT, total: NO_LIFT };
    } else if (!second) {
      const parsed = ageSubdivision(first, category);
      if (parsed && parsed !== first) {
        age = parsed;
        weightClass = null;
      }
    }
  });
  save();
  return records;
}
