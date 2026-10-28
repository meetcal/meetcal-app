// IWF world records from IWF's own page, iwf.sport/results/world-records/,
// one page per age group and gender. iwf.sport answers plain requests with a
// Cloudflare bot challenge, so the page is loaded through Browserless
// (`lib/browserless.ts`); Wikipedia's lists (`iwfRecords.ts`) are the
// fallback.
//
// Each weight class is a `.results__title` heading ("60 kg", "+110 kg")
// followed by a `.cards` list: a legend card, then one card per lift with
// the lift, the record, the athlete ("World Standard" for an unclaimed
// standard), born, nation, and "Sep 23, 2026 - Aichi-Nagoya" (the date and
// the place). The page lists ratified records only. Like the Wikipedia
// parser, a page without exactly eight classes, each with all three lifts,
// fails instead of replacing the stored records.

import { parseHtml } from '../lib/html';
import { recordHolder } from './holder';
import type { IwfAge, IwfRecord } from './iwfRecords';

export type IwfGender = IwfRecord['gender'];

export const iwfSiteUrl = (age: IwfAge, gender: IwfGender) =>
  `https://iwf.sport/results/world-records/?ranking_curprog=current&ranking_agegroup=${age}&ranking_gender=${gender === 'Men' ? 'm' : 'w'}`;

type Lift = 'snatch' | 'cj' | 'total';

const LIFTS: Record<string, Lift> = { snatch: 'snatch', 'c&j': 'cj', 'clean & jerk': 'cj', total: 'total' };

const clean = (text: string) => text.replace(/\s+/g, ' ').trim();

export function parseIwfSiteHtml(html: string, ageCategory: IwfAge, gender: IwfGender): IwfRecord[] {
  const where = `iwf.sport ${ageCategory} ${gender}`;
  const list = parseHtml(html).querySelector('#ranking_list');
  if (!list) throw new Error(`${where}: no records list (still behind the bot challenge?)`);
  type ClassRow = { weightClass: string; lifts: Partial<Record<Lift, { value: number; by: IwfRecord['snatchBy'] }>> };
  const classes: ClassRow[] = [];
  for (const element of list.querySelectorAll('.results__title h2, .cards > .card')) {
    if (element.tagName === 'H2') {
      classes.push({ weightClass: clean(element.text).replace(/\s+/g, ''), lifts: {} });
      continue;
    }
    if (element.classList.contains('card__legend')) continue;
    const current = classes.at(-1);
    if (!current) throw new Error(`${where}: a record before any weight class`);
    // "Record: ", "Born: " and the like are labels for narrow screens.
    for (const label of element.querySelectorAll('.only__mobile')) label.remove();
    const cells = element.querySelectorAll('p').map((p) => clean(p.text));
    if (cells.length !== 6) throw new Error(`${where} ${current.weightClass}: a record with ${cells.length} cells, expected 6`);
    const [liftName, value, athlete, , , event] = cells;
    const lift = LIFTS[liftName.toLowerCase()];
    const kg = /^(\d+) kg$/.exec(value);
    if (!lift || !kg) throw new Error(`${where} ${current.weightClass}: unreadable record "${liftName}: ${value}"`);
    if (current.lifts[lift]) throw new Error(`${where} ${current.weightClass}: ${liftName} listed twice`);
    const [date, ...place] = event.split(' - ');
    // A standard's date and place are when IWF set it ("Jun 01, 2025 - World
    // Standard"), not a lift, and are not read (a standard dated ahead must
    // not fail the page); Wikipedia's lists give a standard neither.
    const standard = recordHolder(Number(kg[1]), athlete)?.name === 'Standard';
    const by = standard ? { name: 'Standard' } : recordHolder(Number(kg[1]), athlete, date, place.join(' - '));
    current.lifts[lift] = { value: Number(kg[1]), by };
  }
  if (classes.length !== 8) throw new Error(`${where}: ${classes.length} weight classes, expected 8`);
  return classes.map(({ weightClass, lifts: { snatch, cj, total } }) => {
    if (!/^\+?\d+kg$/.test(weightClass)) throw new Error(`${where}: unexpected class "${weightClass}"`);
    if (!snatch || !cj || !total) throw new Error(`${where} ${weightClass}: missing a lift`);
    const record: IwfRecord = { ageCategory, gender, weightClass, snatchRecord: snatch.value, cjRecord: cj.value, totalRecord: total.value };
    if (snatch.by) record.snatchBy = snatch.by;
    if (cj.by) record.cjBy = cj.by;
    if (total.by) record.totalBy = total.by;
    return record;
  });
}
