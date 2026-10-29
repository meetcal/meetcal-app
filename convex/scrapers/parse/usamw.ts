import { recordHolder, setHolder, type RecordHolder } from './holder';
import { unescapeHtml } from '../lib/html';
import type { PdfLine, PdfLineOptions } from '../lib/pdf';

// Pure parsing for `scrapers/usamw.ts` (port of `usamw/records/national_records.py`).

export const PAGE_URL = 'https://usamasters.net/masters-records-grand-slam';

/** How the sync reads the PDFs (`pdfRunLines`): pages as displayed, since the September 2026 PDFs rotate them. */
export const PDF_OPTIONS = { xTolerance: 2, yTolerance: 2, asDisplayed: true } as const satisfies PdfLineOptions;

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

const DATE_WORD = /^(?:\d{1,2}-[A-Za-z]{3,}-\d{2,4}|\d{1,2}\/\d{1,2}\/\d{2,4})$/;

/** Runs closer than this (points) are one table cell; a cell's own words are drawn closer. */
const CELL_GAP = 6;

const letters = (text: string) => text.replace(/\s/g, '');

/** A date drawn in two runs far enough apart to get a space ("12-Sep- 25"), made one word again. */
const joinDate = (text: string) => text.replace(/\b(\d{1,2}-[A-Za-z]{3,}-)\s+(\d{2,4})\b/, '$1$2');

/**
 * A line's table cells: its runs, those drawn next to each other joined, cut
 * from the line's own text (so touching runs read as `pdfRunLines` joined
 * them: "12-Sep-" and "25" are one date). Undefined when the runs do not
 * spell the text.
 */
function lineCells(line: PdfLine): string[] | undefined {
  const sizes: number[] = [];
  let end = -Infinity;
  for (const run of line.runs) {
    const size = letters(run.text).length;
    if (sizes.length && run.x - end <= CELL_GAP) sizes[sizes.length - 1] += size;
    else sizes.push(size);
    end = Math.max(end, run.end);
  }
  if (sizes.reduce((a, b) => a + b, 0) !== letters(line.text).length) return undefined;
  const cells: string[] = [];
  let at = 0;
  for (const size of sizes) {
    const from = at;
    for (let seen = 0; seen < size; at++) if (!/\s/.test(line.text[at])) seen++;
    cells.push(joinDate(line.text.slice(from, at).trim()));
  }
  return cells.filter(Boolean);
}

const hasDate = (cell: string) => cell.split(' ').some((word) => DATE_WORD.test(word));

/**
 * Site and competition from what follows the date. The line's cells say
 * where the site ends: it is the first cell after the date (or the rest of
 * the date's cell, which the September 2026 PDFs draw as one run: "29-May-26
 * San Salvador, ES"), and the competition the cells after it, so a site
 * abroad ("Athens, Greece") splits right. From the text alone the site ends
 * at its two-letter state or country code; without one it is all kept as the
 * location.
 */
function siteAndCompetition(tail: string, cells: string[] | undefined): [site: string | undefined, competition: string] {
  const at = cells?.findIndex(hasDate) ?? -1;
  if (cells && at >= 0) {
    const words = cells[at].split(' ');
    const after = [words.slice(words.findIndex((word) => DATE_WORD.test(word)) + 1).join(' '), ...cells.slice(at + 1)].filter(Boolean);
    // Only a first cell that reads as a whole site ("City, Region", as every site in the PDFs is), not one
    // that runs on past a state code ("Las Vegas, NV World"), and cells that say what the text says.
    const site = after[0] ?? '';
    if (after.length >= 2 && /,\s*\S/.test(site) && !/,\s*[A-Z]{2}\s+\S/.test(site) && letters(after.join('')) === letters(tail)) {
      return [site, after.slice(1).join(' ')];
    }
  }
  const site = /^(.+?,\s*[A-Z]{2})\s+(.+)$/.exec(tail);
  return site ? [site[1], site[2]] : [undefined, tail];
}

/**
 * Names the PDFs run together, family name into given name, and how they are
 * spaced. Where one run ends and the next begins cannot be told from the
 * letters ("SMITHDEAnne"), so each is listed once it is seen.
 */
const NAME_CORRECTIONS: Readonly<Record<string, string>> = {
  // The September 27, 2026 men's PDF, M40-44 75kg.
  'TAN CASTELLANOSYicay': 'TAN CASTELLANOS Yicay',
};

/**
 * Who set a line's lift, from what follows its value: `Family Given Date Site
 * Competition` ("MURRAY George 12-Sep-25 Las Vegas, NV World Masters"). The
 * name is kept as the PDF lays it out, except the ones it runs together
 * (`NAME_CORRECTIONS`).
 */
function lineHolder(value: number, rest: string, cells: string[] | undefined): RecordHolder | undefined {
  const words = joinDate(rest.trim()).split(/\s+/).filter(Boolean);
  const at = words.findIndex((word) => DATE_WORD.test(word));
  const written = words.slice(0, at < 0 ? words.length : at).join(' ');
  const name = NAME_CORRECTIONS[written] ?? written;
  if (at < 0) return recordHolder(value, name);
  const [site, competition] = siteAndCompetition(words.slice(at + 1).join(' '), cells);
  return recordHolder(value, name, recordsDate(words[at]), competition, site);
}

type Lift = 'snatchRecord' | 'cjRecord' | 'totalRecord';

/**
 * Lifts the PDFs print wrong, and what they are, applied only while the PDF
 * still prints the wrong value beside the same holder and date. Each was
 * checked against the class's other lifts, which the same lifter set the
 * same day: snatch + C&J = total only with the correction. Any other value
 * is stored as printed.
 */
const LIFT_CORRECTIONS: readonly {
  gender: string;
  ageCategory: string;
  weightClass: string;
  lift: Lift;
  holder: RecordHolder;
  printed: number;
  value: number;
}[] = [
  // The September 27, 2026 women's PDF: "1744" beside snatch 79 and C&J 95.
  { gender: 'Women', ageCategory: 'Masters 40', weightClass: '86kg', lift: 'totalRecord', holder: { name: 'ONG Jaquelin', date: '2026-09-24' }, printed: 1744, value: 174 },
  // The same PDF: "488" beside C&J 65 and total 113.
  { gender: 'Women', ageCategory: 'Masters 55', weightClass: '69kg', lift: 'snatchRecord', holder: { name: 'NICHOLS Stacy', date: '2026-09-19' }, printed: 488, value: 48 },
];

const HOLDER_OF: Record<Lift, 'snatchBy' | 'cjBy' | 'totalBy'> = { snatchRecord: 'snatchBy', cjRecord: 'cjBy', totalRecord: 'totalBy' };

/** Puts right a record's lifts listed in `LIFT_CORRECTIONS`; returns what it changed, for the sync to log. */
function correctLifts(record: UsamwRecord): string[] {
  return LIFT_CORRECTIONS.filter(
    (c) =>
      c.gender === record.gender &&
      c.ageCategory === record.ageCategory &&
      c.weightClass === record.weightClass &&
      record[c.lift] === c.printed &&
      record[HOLDER_OF[c.lift]]?.name === c.holder.name &&
      record[HOLDER_OF[c.lift]]?.date === c.holder.date,
  ).map((c) => {
    record[c.lift] = c.value;
    return `${record.gender} ${record.ageCategory} ${record.weightClass} ${c.lift}: printed ${c.printed}, stored ${c.value}`;
  });
}

function weightOrder(weightClass: string): number {
  return Number(weightClass.replace('+kg', '.5').replace('kg', ''));
}

/**
 * Records from one PDF (one gender): each page names its age group in its
 * first eight lines ("M35-39"), then `class lift record` lines, each naming
 * who set it, when and where. Lines are text, or text with its runs
 * (`pdfRunLines`), which tell a site abroad from the competition after it.
 * Sorted by gender, age, then class, as before.
 */
export function parseRecordPages(pages: (string | PdfLine)[][], gender: string, corrections: string[] = []): UsamwRecord[] {
  const byKey = new Map<string, UsamwRecord>();
  for (const page of pages) {
    const nonEmpty = page
      .map((l) => (typeof l === 'string' ? { text: l.trim(), cells: undefined } : { text: l.text.trim(), cells: lineCells(l) }))
      .filter((l) => l.text);
    let age: string | null = null;
    for (const { text } of nonEmpty.slice(0, 8)) {
      age = ageCategory(text);
      if (age) break;
    }
    if (!age) continue;
    for (const { text: line, cells } of nonEmpty) {
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
      const holder = lineHolder(value, line.slice(match[0].length), cells);
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
  for (const record of byKey.values()) corrections.push(...correctLifts(record));
  const ageNumber = (r: UsamwRecord) => Number(/\d+/.exec(r.ageCategory)![0]);
  return [...byKey.values()].sort(
    (a, b) =>
      (a.gender < b.gender ? -1 : a.gender > b.gender ? 1 : 0) ||
      ageNumber(a) - ageNumber(b) ||
      weightOrder(a.weightClass) - weightOrder(b.weightClass),
  );
}
