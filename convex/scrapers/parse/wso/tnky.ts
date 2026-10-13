import { parseCsv } from '../../lib/csv';
import { recordHolder } from '../holder';
import { blankRecord, intOrNull, plusLast, setLift, type LiftName, type SheetTab, type WsoRecord } from './common';

// Tennessee-Kentucky: a tab per age group and gender, titled for it
// ("6/1/25-8/1/26 Youth Men <13", "Copy of Masters Women 50-55"). Each lists
// its classes in turn: a class row (",40KG"; "77KG*" is footnoted
// unsubmitted, kept as written), then a row per lift laid out as the header
// says: Lift, Name, Weight, Date, Meet.
//
// The single tab of horizontal sections the Python scraper read
// (`scraper_tnky.py`, gid 867133960) is hidden and has not been updated
// since October 2025; the group tabs replaced it.

export const TNKY_SHEET_ID = '11uUA0t05sEvHRjvDksC0VP1Yr2p_rC0JjHgVPEuYzhU';

type Group = [age: string, gender: 'Men' | 'Women'];

/**
 * The groups the sheet has a tab for (October 2026). A tab for one of them
 * going missing fails the source rather than deleting its records.
 */
export const TNKY_GROUPS: readonly Group[] = [
  ...(['U13', 'U17', 'Junior', 'Senior', 'Masters 35', 'Masters 40', 'Masters 45', 'Masters 50', 'Masters 55', 'Masters 60'] as const).flatMap(
    (age): Group[] => [
      [age, 'Men'],
      [age, 'Women'],
    ],
  ),
  ['Masters 65', 'Men'],
];

/**
 * A tab's age group and gender from its title: "Youth Women <13" -> U13,
 * "Youth Men 14-17" -> U17, "Juniors Men 15-20", "Seniors Women >15",
 * "Masters Men 35-39" -> Masters 35. Null for any other tab (the archived
 * "TN-KY WSO Records through May 31, 2025").
 */
export function tnkyTabGroup(title: string): Group | null {
  const text = title.replace(/\s+/g, ' ').trim().toLowerCase();
  const gender = /\bwomen\b/.test(text) ? 'Women' : /\bmen\b/.test(text) ? 'Men' : null;
  if (!gender) return null;
  if (/\byouth\b/.test(text)) {
    if (/<\s*13\b|\b13\s*(?:&|and)?\s*under\b|\bu13\b/.test(text)) return ['U13', gender];
    if (/\b14\s*-\s*17\b/.test(text)) return ['U17', gender];
    return null;
  }
  if (/\bjuniors?\b/.test(text)) return ['Junior', gender];
  if (/\bseniors?\b/.test(text)) return ['Senior', gender];
  const masters = /\bmasters?\s+(?:wo)?men\s+(\d{2})\s*-\s*\d{2}\b/.exec(text);
  if (masters) return [`Masters ${masters[1]}`, gender];
  return null;
}

export type TnkyTab = SheetTab & { age: string; gender: 'Men' | 'Women' };

/**
 * The sheet's group tabs, from its visible tabs (`sheetTabList`). Two tabs
 * for one group (an old period's beside the new) or a group in
 * `TNKY_GROUPS` with none throws: which is current is for a person to say.
 */
export function tnkyTabs(list: readonly SheetTab[]): TnkyTab[] {
  const tabs: TnkyTab[] = [];
  const problems: string[] = [];
  for (const tab of list) {
    const group = tnkyTabGroup(tab.name);
    if (!group) continue;
    const twin = tabs.find((t) => t.age === group[0] && t.gender === group[1]);
    if (twin) problems.push(`tabs ${JSON.stringify(twin.name)} and ${JSON.stringify(tab.name)} are both ${group.join(' ')}`);
    else tabs.push({ ...tab, age: group[0], gender: group[1] });
  }
  for (const [age, gender] of TNKY_GROUPS) {
    if (!tabs.some((t) => t.age === age && t.gender === gender)) problems.push(`no visible tab for ${age} ${gender} (renamed or hidden?)`);
  }
  if (problems.length) throw new Error(problems.join('; '));
  return tabs;
}

const LIFTS: Record<string, LiftName> = { snatch: 'snatch', 'c&j': 'cj', cleanandjerk: 'cj', 'clean&jerk': 'cj', total: 'total' };

/** "40KG", "65+KG", "77KG*" -> the class ("65+"); null for any other cell. */
const classOf = (cell: string) => {
  const match = /^(\+?\d+\+?)\s*kg\b/i.exec(cell.trim());
  return match ? plusLast(match[1]) : null;
};

/**
 * One group tab's records, a class per class row, its lifts from the rows
 * below it. A class listed twice keeps the later listing.
 */
export function parseTnkyTab(csv: string, wso: string, age: string, gender: 'Men' | 'Women'): WsoRecord[] {
  const byClass = new Map<string, WsoRecord>();
  let current: WsoRecord | null = null;
  for (const row of parseCsv(csv)) {
    const cell = (column: number) => (row[column] ?? '').trim();
    const weightClass = cell(0) ? null : classOf(cell(1));
    if (weightClass) {
      current = blankRecord(wso, age, gender, weightClass);
      byClass.set(weightClass, current);
      continue;
    }
    const lift = LIFTS[cell(0).toLowerCase().replace(/\s+/g, '')];
    if (!lift) continue;
    if (!current) throw new Error(`${wso} ${age} ${gender}: a ${cell(0)} row before any class`);
    const value = intOrNull(cell(2));
    setLift(current, lift, value, recordHolder(value, cell(1), cell(3), cell(4)));
  }
  return [...byClass.values()];
}
