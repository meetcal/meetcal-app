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
};

const LIFTS: Record<string, 'snatchRecord' | 'cjRecord' | 'totalRecord'> = {
  snatch: 'snatchRecord',
  'clean & jerk': 'cjRecord',
  'clean and jerk': 'cjRecord',
  total: 'totalRecord',
};

/** A table cell's text: the line without its leading pipe and any `attr=…|` prefix. */
function cellText(line: string): string {
  return line.replace(/^\|(?:[^|[{]*\|)?/, '').trim();
}

export function parseIwfWikitext(wikitext: string, ageCategory: IwfAge): IwfRecord[] {
  if (!/^==\s*Current records\s*==\s*$/m.test(wikitext)) throw new Error(`${ageCategory}: no "Current records" section`);
  const records: IwfRecord[] = [];
  for (const section of wikitext.split(/^===\s*/m).slice(1)) {
    const gender = /^(Men|Women)\s*===/.exec(section)?.[1] as 'Men' | 'Women' | undefined;
    if (!gender) continue;
    type ClassRow = { weightClass: string; lifts: Partial<Record<'snatchRecord' | 'cjRecord' | 'totalRecord', number>> };
    const classes: ClassRow[] = [];
    let current: ClassRow | null = null;
    let lift: 'snatchRecord' | 'cjRecord' | 'totalRecord' | null = null;
    let rowStatus = '';
    let cells: string[] = [];
    const endRow = () => {
      if (!current || cells.length === 0) return;
      const first = LIFTS[cellText(cells[0]).toLowerCase()];
      if (first) {
        lift = first;
        cells = cells.slice(1);
      }
      const value = /(\d+(?:\.\d+)?)\s*(?:&nbsp;)?\s*kg/.exec(cells[0] ?? '');
      // Only a ratified row sets the record (the first one, if a lift somehow lists two).
      if (lift && value && rowStatus === 'ratified' && current.lifts[lift] === undefined) current.lifts[lift] = Math.trunc(Number(value[1]));
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
        current = { weightClass: header[1].replaceAll('&nbsp;', '').replace(/\s+/g, ''), lifts: {} };
        classes.push(current);
        lift = null;
        continue;
      }
      if (line.startsWith('|')) cells.push(line);
    }
    endRow();
    if (classes.length !== 8) throw new Error(`${ageCategory} ${gender}: ${classes.length} weight classes, expected 8`);
    for (const { weightClass, lifts } of classes) {
      if (!/^\+?\d+kg$/.test(weightClass)) throw new Error(`${ageCategory} ${gender}: unexpected class "${weightClass}"`);
      const { snatchRecord, cjRecord, totalRecord } = lifts;
      if (snatchRecord === undefined || cjRecord === undefined || totalRecord === undefined) throw new Error(`${ageCategory} ${gender} ${weightClass}: missing a lift`);
      records.push({ ageCategory, gender, weightClass, snatchRecord, cjRecord, totalRecord });
    }
  }
  const genders = new Set(records.map((r) => r.gender));
  if (!genders.has('Men') || !genders.has('Women')) throw new Error(`${ageCategory}: expected men's and women's tables`);
  return records;
}
