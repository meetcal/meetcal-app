import { recordHolder, recordLift, setHolder } from './holder';
import { sortRecords, type UsamwRecord } from './usamw';
import { unescapeHtml } from '../lib/html';

// Pure parsing for `scrapers/hcamRecords.ts`: the Howard Cohen American
// Masters meet records, from the same USA Masters page as the national
// records (`PAGE_URL` in `parse/usamw.ts`).

export type HcamRecord = Omit<UsamwRecord, 'recordType'> & { recordType: 'USAMW_HCAM' };

/** Every HCAM record was set at the meet; the PDFs give only its site. */
const MEET = 'Howard Cohen American Masters';

/**
 * The current HCAM records PDFs ("AM<yyyymmdd>-men….pdf" / "-women….pdf" on
 * Google Storage), keyed Men/Women. The page also links the records the
 * January 2026 class change retired ("AM20251215-men.pdf", beside the current
 * "AM20260101-men-30 and up.pdf"), so the latest date per gender wins. Two
 * different files sharing that date fail rather than one being guessed.
 */
export function discoverHcamPdfs(page: string): { Men: string; Women: string } {
  const html = unescapeHtml(page);
  const latest: { Men?: { date: string; url: string }; Women?: { date: string; url: string } } = {};
  for (const match of html.matchAll(/href="([^"]+)"/gi)) {
    const url = unescapeHtml(match[1]);
    const lower = decoded(url).toLowerCase();
    if (!lower.includes('storage.googleapis.com') || !lower.includes('.pdf')) continue;
    const file = /filename=am(\d{8})[-_ ]*(women|men)\b/.exec(lower);
    if (!file) continue;
    const gender = file[2] === 'women' ? 'Women' : 'Men';
    const current = latest[gender];
    if (current && current.date === file[1] && current.url !== url) {
      throw new Error(`Two HCAM ${gender.toLowerCase()} records PDFs dated ${file[1]}: ${current.url} and ${url}`);
    }
    if (!current || file[1] > current.date) latest[gender] = { date: file[1], url };
  }
  const missing = (['Men', 'Women'] as const).filter((g) => !latest[g]);
  if (missing.length) throw new Error(`Could not find HCAM records PDFs for: ${missing.join(', ')}`);
  return { Men: latest.Men!.url, Women: latest.Women!.url };
}

/** A link with its percent-escapes ("AM20270101%20men.pdf") read, or as written when they are malformed. */
function decoded(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

const TITLE = /AMERICAN MASTERS RECORDS\s*-\s*(MEN|WOMEN)\b/i;
const AGE_GROUP = /^AGE GROUP:\s*(\d+)\s*(?:-\s*\d+|\+)$/i;
const LIFTS: Record<string, 'snatch' | 'cj' | 'total'> = { SNATCH: 'snatch', 'CLEAN & JERK': 'cj', TOTAL: 'total' };
const CLASS_LINE = /^(\+?\d{2,3}\+?)(?:\s+(.*))?$/;
/** What follows a held class: `Given FAMILY kg m/d/yy City, ST` ("Nathaniel GRESBACH 77.0 12/14/25 Louisville, KY"). */
const HELD = /^(.+?)\s+(\d+(?:\.\d+)?)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(.+)$/;

/**
 * Records from one PDF (one gender): each page is an age group ("AGE GROUP:
 * 30 - 34"), then SNATCH, CLEAN & JERK and TOTAL sections listing every
 * class, bare when nobody holds it yet. A class becomes a record once any of
 * its lifts is held, in the USAMW row format (`parse/usamw.ts`). A PDF not
 * titled for this gender, a class outside an age group or lift section,
 * a lift listed twice, or a held row it cannot read throws: read wrong, it
 * would clear or misfile stored records.
 */
export function parseHcamPages(pages: string[][], gender: 'Men' | 'Women'): HcamRecord[] {
  const byKey = new Map<string, HcamRecord>();
  const seen = new Set<string>();
  // An age group that runs onto the next page carries over.
  let age: string | null = null;
  let lift: 'snatch' | 'cj' | 'total' | null = null;
  // A file with no title naming its gender could be either one's.
  let titled = false;
  for (const [index, lines] of pages.entries()) {
    const where = `HCAM ${gender} page ${index + 1}`;
    for (const raw of lines) {
      const line = raw.replace(/\s+/g, ' ').trim();
      const title = TITLE.exec(line);
      if (title && title[1].toUpperCase() !== gender.toUpperCase()) {
        throw new Error(`${where} is titled ${JSON.stringify(line)}: the ${gender.toLowerCase()} PDF holds the other records`);
      }
      if (title) titled = true;
      const group = AGE_GROUP.exec(line);
      if (group) {
        age = `Masters ${group[1]}`;
        lift = null;
        continue;
      }
      if (line.toUpperCase() in LIFTS) {
        lift = LIFTS[line.toUpperCase()];
        continue;
      }
      const row = CLASS_LINE.exec(line);
      if (!row) continue;
      if (!age || !lift) throw new Error(`${where}: class line ${JSON.stringify(line)} outside an age group and lift`);
      const number = row[1].replace(/\+/g, '');
      const weightClass = row[1].includes('+') ? `${number}+kg` : `${number}kg`;
      const key = `${age}|${weightClass}`;
      if (seen.has(`${key}|${lift}`)) throw new Error(`${where}: ${age} ${weightClass} ${lift} listed twice`);
      seen.add(`${key}|${lift}`);
      if (!row[2]) continue;
      const held = HELD.exec(row[2]);
      if (!held) throw new Error(`${where}: unreadable record row ${JSON.stringify(line)}`);
      const value = recordLift(held[2]);
      const record = byKey.get(key) ?? {
        recordType: 'USAMW_HCAM' as const,
        ageCategory: age,
        gender,
        weightClass,
        snatchRecord: null,
        cjRecord: null,
        totalRecord: null,
      };
      const holder = recordHolder(value, held[1], held[3], MEET, held[4]);
      if (lift === 'snatch') {
        record.snatchRecord = value;
        setHolder(record, 'snatchBy', holder);
      } else if (lift === 'cj') {
        record.cjRecord = value;
        setHolder(record, 'cjBy', holder);
      } else {
        record.totalRecord = value;
        setHolder(record, 'totalBy', holder);
      }
      byKey.set(key, record);
    }
  }
  if (byKey.size && !titled) throw new Error(`HCAM ${gender} PDF has no "American Masters Records - ${gender.toUpperCase()}" title, so its gender cannot be checked`);
  return sortRecords([...byKey.values()]);
}
