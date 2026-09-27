import { recordHolder, type RecordHolder } from './holder';
import { unescapeHtml } from '../lib/html';

// Pure parsing for `scrapers/usamw.ts` (port of `usamw/records/national_records.py`).

export const PAGE_URL = 'https://usamasters.net/masters-records-grand-slam';

export type UsamwRecord = {
  recordType: 'USAMW';
  ageCategory: string;
  gender: string;
  weightClass: string;
  snatchRecord: number | null;
  cjRecord: number | null;
  totalRecord: number | null;
  snatchBy?: RecordHolder;
  cjBy?: RecordHolder;
  totalBy?: RecordHolder;
};

/**
 * The current national records PDFs ("NM<date>-MEN.pdf" / "-WOMEN.pdf" on
 * Google Storage), keyed Men/Women; the last match on the page wins, as
 * before. A trailing copy number ("NM20260713-MEN 1.pdf", the July 2026
 * upload) is accepted; the Python pattern rejected it and the job failed.
 */
export function discoverRecordPdfs(page: string): { Men: string; Women: string } {
  const html = unescapeHtml(page);
  const urls: { Men?: string; Women?: string } = {};
  for (const match of html.matchAll(/href="([^"]+)"/gi)) {
    const url = unescapeHtml(match[1]);
    const lower = url.toLowerCase();
    if (!lower.includes('storage.googleapis.com') || !lower.includes('filename=nm') || !lower.includes('.pdf')) continue;
    if (/[-_ ]women(?:[ _-]*\d+)?\.pdf\b/.test(lower)) urls.Women = url;
    else if (/[-_ ]men(?:[ _-]*\d+)?\.pdf\b/.test(lower)) urls.Men = url;
  }
  const missing = (['Men', 'Women'] as const).filter((g) => !urls[g]);
  if (missing.length) throw new Error(`Could not find national records PDFs for: ${missing.join(', ')}`);
  return urls as { Men: string; Women: string };
}

export function ageCategory(text: string): string | null {
  const range = /\b[MW]\s*(\d+)\s*-\s*\d+\b/.exec(text);
  if (range) return `Masters ${range[1]}`;
  const open = /\b[MW]\s*(\d+)\+/.exec(text);
  return open ? `Masters ${open[1]}` : null;
}

const LINE = /^(\d+\+?)\s+(SNA|SNATCH|CNJ|C&J|CLEAN|TOT|TOTAL)\s+(\d+(?:\.\d+)?)\b/i;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "12-Sep-25" -> "2025-09-12" (two-digit years up to 50 are 20xx); any other date as written. */
function recordsDate(text: string): string {
  const match = /^(\d{1,2})-([A-Za-z]{3})[a-z]*-(\d{2}|\d{4})$/.exec(text);
  const month = match ? MONTHS.indexOf(match[2].toLowerCase()) + 1 : 0;
  if (!match || !month) return text;
  const year = match[3].length === 4 ? Number(match[3]) : Number(match[3]) + (Number(match[3]) <= 50 ? 2000 : 1900);
  return `${year}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

/**
 * Who set a line's lift, from what follows its value: `Family Given Date Site
 * Competition` ("MURRAY George 12-Sep-25 Las Vegas, NV World Masters"). The
 * site ends at its two-letter state or country code; the name is kept as the
 * PDF lays it out.
 */
function lineHolder(value: number, rest: string): RecordHolder | undefined {
  const words = rest.trim().split(/\s+/).filter(Boolean);
  const at = words.findIndex((word) => /^\d{1,2}-[A-Za-z]{3,}-\d{2,4}$/.test(word) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(word));
  if (at < 0) return recordHolder(value, words.join(' '));
  const tail = words.slice(at + 1).join(' ');
  const site = /^(.+?,\s*[A-Z]{2})\s+(.+)$/.exec(tail);
  return site
    ? recordHolder(value, words.slice(0, at).join(' '), recordsDate(words[at]), site[2], site[1])
    : recordHolder(value, words.slice(0, at).join(' '), recordsDate(words[at]), tail);
}

/** Sets a lift's holder, or clears it when the lift has none. */
function setHolder(record: UsamwRecord, key: 'snatchBy' | 'cjBy' | 'totalBy', holder: RecordHolder | undefined) {
  if (holder) record[key] = holder;
  else delete record[key];
}

function weightOrder(weightClass: string): number {
  return Number(weightClass.replace('+kg', '.5').replace('kg', ''));
}

/**
 * Records from one PDF (one gender): each page names its age group in its
 * first eight lines ("M35-39"), then `class lift record` lines, each naming
 * who set it, when and where. Sorted by gender, age, then class, as before.
 */
export function parseRecordPages(pages: string[][], gender: string): UsamwRecord[] {
  const byKey = new Map<string, UsamwRecord>();
  for (const lines of pages) {
    const nonEmpty = lines.map((l) => l.trim()).filter(Boolean);
    let age: string | null = null;
    for (const line of nonEmpty.slice(0, 8)) {
      age = ageCategory(line);
      if (age) break;
    }
    if (!age) continue;
    for (const line of nonEmpty) {
      const match = LINE.exec(line);
      if (!match) continue;
      const weightClass = `${match[1]}kg`;
      const key = `${age}|${gender}|${weightClass}`;
      const record = byKey.get(key) ?? {
        recordType: 'USAMW' as const,
        ageCategory: age,
        gender,
        weightClass,
        snatchRecord: null,
        cjRecord: null,
        totalRecord: null,
      };
      const value = Math.trunc(Number(match[3]));
      const lift = match[2].toUpperCase();
      const holder = lineHolder(value, line.slice(match[0].length));
      if (lift.startsWith('SNA')) {
        record.snatchRecord = value;
        setHolder(record, 'snatchBy', holder);
      } else if (lift === 'CNJ' || lift === 'C&J' || lift.startsWith('CLEAN')) {
        record.cjRecord = value;
        setHolder(record, 'cjBy', holder);
      } else if (lift.startsWith('TOT')) {
        record.totalRecord = value;
        setHolder(record, 'totalBy', holder);
      }
      byKey.set(key, record);
    }
  }
  const ageNumber = (r: UsamwRecord) => Number(/\d+/.exec(r.ageCategory)![0]);
  return [...byKey.values()].sort(
    (a, b) =>
      (a.gender < b.gender ? -1 : a.gender > b.gender ? 1 : 0) ||
      ageNumber(a) - ageNumber(b) ||
      weightOrder(a.weightClass) - weightOrder(b.weightClass),
  );
}
