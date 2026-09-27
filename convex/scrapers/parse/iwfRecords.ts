// IWF world records (replaces `iwf/world-records/scraper.py`). iwf.sport now
// answers every request, from the VPS and from Convex alike, with a
// Cloudflare bot challenge, and publishes the records nowhere else. The
// "Current records" tables of Wikipedia's three world-record lists (senior,
// junior, youth) carry the same 48 classes, kept current (they already had
// the 2026 Asian Games records before IWF's own page), and the MediaWiki API
// serves them without a challenge.
//
// Wikipedia marks records awaiting ratification (row colour #CEF6F5) and ones
// not ratified or rescinded (pink); like IWF's page, only the ratified row of
// a lift counts. The page is community-edited, so a table that does not have
// exactly eight classes per gender, each with all three lifts, fails the run
// instead of replacing the stored records.
//
// Each lift's holder is read from that same ratified row: Athlete, Date, Meet
// and Place, following cells that span rows ("rowspan=3|[[He Yueji]]").

import { recordHolder, type RecordHolder } from './holder';
import { unescapeHtml } from '../lib/html';

export const IWF_PAGES = {
  Senior: 'List_of_world_records_in_Olympic_weightlifting',
  Junior: 'List_of_junior_world_records_in_Olympic_weightlifting',
  Youth: 'List_of_youth_world_records_in_Olympic_weightlifting',
} as const;

export type IwfAge = keyof typeof IWF_PAGES;

/** The "Current records" section's wikitext, through the MediaWiki API. */
export const wikitextUrl = (page: string) =>
  `https://en.wikipedia.org/w/api.php?action=parse&page=${page}&prop=wikitext&section=1&format=json&formatversion=2`;

export type IwfRecord = {
  ageCategory: IwfAge;
  gender: 'Men' | 'Women';
  weightClass: string;
  snatchRecord: number;
  cjRecord: number;
  totalRecord: number;
  snatchBy?: RecordHolder;
  cjBy?: RecordHolder;
  totalBy?: RecordHolder;
};

type Lift = 'snatchRecord' | 'cjRecord' | 'totalRecord';

const LIFTS: Record<string, Lift> = {
  snatch: 'snatchRecord',
  'clean & jerk': 'cjRecord',
  'clean and jerk': 'cjRecord',
  total: 'totalRecord',
};

/** A table cell's text: the line without its leading pipe and any `attr=…|` prefix. */
function cellText(line: string): string {
  return line.replace(/^\|(?:[^|[{]*\|)?/, '').trim();
}

/** How many rows a cell spans (its `rowspan=…` attribute), 1 when it has none. */
function rowSpan(line: string): number {
  const attributes = /^\|([^|[{]*)\|/.exec(line)?.[1] ?? '';
  return Number(/rowspan\s*=\s*"?(\d+)/i.exec(attributes)?.[1] ?? 1);
}

/**
 * Wiki markup as the reader sees it: link labels (`[[Førde (town)|Førde]]` ->
 * "Førde"), no references, templates (`{{flagu|Norway}}`), italics or tags.
 */
export function wikiText(markup: string): string {
  let text = markup.replace(/<ref[^>]*\/>/gi, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
  for (let previous = ''; previous !== text; ) {
    previous = text;
    text = text.replace(/\{\{\s*(?:nowrap|nobr)\s*\|([^{}]*)\}\}/gi, '$1').replace(/\{\{[^{}]*\}\}/g, '');
  }
  text = text
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/<[^>]+>/g, '')
    .replaceAll('&nbsp;', ' ');
  return unescapeHtml(text).replace(/\s+/g, ' ').trim();
}

const HOLDER_KEYS: Record<Lift, 'snatchBy' | 'cjBy' | 'totalBy'> = { snatchRecord: 'snatchBy', cjRecord: 'cjBy', totalRecord: 'totalBy' };

/** Where the holder cells sit, from the table's header ("Event, Record, Athlete, Nation, Date, Meet, Place, …"). */
type HolderColumns = { athlete: number; date: number; meet: number; place: number };
const DEFAULT_COLUMNS: HolderColumns = { athlete: 2, date: 4, meet: 5, place: 6 };

function holderColumns(headers: string[]): HolderColumns {
  const at = (label: keyof HolderColumns) => {
    const index = headers.findIndex((header) => header.toLowerCase() === label);
    return index < 0 ? DEFAULT_COLUMNS[label] : index;
  };
  return { athlete: at('athlete'), date: at('date'), meet: at('meet'), place: at('place') };
}

export function parseIwfWikitext(wikitext: string, ageCategory: IwfAge): IwfRecord[] {
  if (!/^==\s*Current records\s*==\s*$/m.test(wikitext)) throw new Error(`${ageCategory}: no "Current records" section`);
  const records: IwfRecord[] = [];
  for (const section of wikitext.split(/^===\s*/m).slice(1)) {
    const gender = /^(Men|Women)\s*===/.exec(section)?.[1] as 'Men' | 'Women' | undefined;
    if (!gender) continue;
    type ClassRow = { weightClass: string; lifts: Partial<Record<Lift, number>>; holders: Partial<Record<Lift, RecordHolder>> };
    const classes: ClassRow[] = [];
    let current: ClassRow | null = null;
    let lift: Lift | null = null;
    let rowStatus = '';
    let cells: string[] = [];
    const headers: string[] = [];
    // Cells still covering rows below them, by column.
    let spans: { cell: string; rows: number }[] = [];
    /** The row's cells by column, cells spanning down from rows above filled in. */
    const columns = (): string[] => {
      const row: string[] = [];
      const queue = [...cells];
      for (let column = 0; queue.length > 0 || column < spans.length; column++) {
        const span = spans[column];
        if (span && span.rows > 0) {
          row[column] = span.cell;
          span.rows -= 1;
          continue;
        }
        const cell = queue.shift();
        row[column] = cell ?? '';
        if (cell !== undefined) spans[column] = { cell, rows: rowSpan(cell) - 1 };
      }
      return row;
    };
    const endRow = () => {
      if (!current || cells.length === 0) return;
      const row = columns();
      const first = LIFTS[cellText(cells[0]).toLowerCase()];
      if (first) {
        lift = first;
        cells = cells.slice(1);
      }
      const value = /(\d+(?:\.\d+)?)\s*(?:&nbsp;)?\s*kg/.exec(cells[0] ?? '');
      // Only a ratified row sets the record (the first one, if a lift somehow lists two).
      if (lift && value && rowStatus === 'ratified' && current.lifts[lift] === undefined) {
        current.lifts[lift] = Math.trunc(Number(value[1]));
        const at = holderColumns(headers);
        const text = (column: number) => wikiText(cellText(row[column] ?? ''));
        const holder = recordHolder(current.lifts[lift], text(at.athlete), text(at.date), text(at.meet), text(at.place));
        if (holder) current.holders[lift] = holder;
      }
      cells = [];
    };
    for (const line of section.split('\n')) {
      if (line.startsWith('|-') || line.startsWith('|}')) {
        endRow();
        const colour = /bgcolor\s*=\s*"?([#\w]+)/i.exec(line)?.[1]?.toUpperCase() ?? '';
        rowStatus = colour === '#CEF6F5' ? 'pending' : colour === 'PINK' ? 'rejected' : 'ratified';
        continue;
      }
      const header = /^!\s*colspan\s*=\s*"?\d+"?\s*\|(.*)$/.exec(line);
      if (header) {
        endRow();
        current = { weightClass: header[1].replaceAll('&nbsp;', '').replace(/\s+/g, ''), lifts: {}, holders: {} };
        classes.push(current);
        lift = null;
        spans = [];
        continue;
      }
      if (line.startsWith('!')) {
        for (const heading of line.slice(1).split('!!')) headers.push(wikiText(heading.replace(/^[^|[{]*\|/, '')));
        continue;
      }
      if (line.startsWith('|')) cells.push(line);
    }
    endRow();
    if (classes.length !== 8) throw new Error(`${ageCategory} ${gender}: ${classes.length} weight classes, expected 8`);
    for (const { weightClass, lifts, holders } of classes) {
      if (!/^\+?\d+kg$/.test(weightClass)) throw new Error(`${ageCategory} ${gender}: unexpected class "${weightClass}"`);
      const { snatchRecord, cjRecord, totalRecord } = lifts;
      if (snatchRecord === undefined || cjRecord === undefined || totalRecord === undefined) throw new Error(`${ageCategory} ${gender} ${weightClass}: missing a lift`);
      const record: IwfRecord = { ageCategory, gender, weightClass, snatchRecord, cjRecord, totalRecord };
      for (const key of Object.keys(HOLDER_KEYS) as Lift[]) {
        const holder = holders[key];
        if (holder) record[HOLDER_KEYS[key]] = holder;
      }
      records.push(record);
    }
  }
  const genders = new Set(records.map((r) => r.gender));
  if (!genders.has('Men') || !genders.has('Women')) throw new Error(`${ageCategory}: expected men's and women's tables`);
  return records;
}
