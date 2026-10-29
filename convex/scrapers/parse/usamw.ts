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

/** A line's table cells: its runs, those drawn next to each other joined (with a space as `pdfRunLines` puts one). */
function lineCells(line: PdfLine): string[] {
  const cells: string[] = [];
  let end = -Infinity;
  for (const run of line.runs) {
    const gap = run.x - end;
    if (cells.length && gap <= CELL_GAP) cells[cells.length - 1] += `${gap > PDF_OPTIONS.xTolerance ? ' ' : ''}${run.text}`;
    else cells.push(run.text);
    end = Math.max(end, run.end);
  }
  return cells.map((cell) => cell.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/**
 * Site and competition from what follows the date. In the line's cells the
 * site is the first one after the date (or the rest of the date's cell, which
 * the September 2026 PDFs draw as one run: "29-May-26 San Salvador, ES") and
 * the competition the rest, so a site abroad ("Athens, Greece") splits
 * right. From the text alone the site ends at its two-letter state or
 * country code; without one it is all kept as the location.
 */
function siteAndCompetition(tail: string, cells: string[] | undefined): [site: string | undefined, competition: string] {
  const at = cells?.findIndex((cell) => cell.split(' ').some((word) => DATE_WORD.test(word))) ?? -1;
  if (cells && at >= 0) {
    const words = cells[at].split(' ');
    const after = [words.slice(words.findIndex((word) => DATE_WORD.test(word)) + 1).join(' '), ...cells.slice(at + 1)].filter(Boolean);
    // Only a first cell that reads as a whole site ("City, Region"), and cells that say what the text says.
    if (after.length >= 2 && /,\s*\S/.test(after[0]) && after.join(' ') === tail) return [after[0], after.slice(1).join(' ')];
  }
  const site = /^(.+?,\s*[A-Z]{2})\s+(.+)$/.exec(tail);
  return site ? [site[1], site[2]] : [undefined, tail];
}

/**
 * Who set a line's lift, from what follows its value: `Family Given Date Site
 * Competition` ("MURRAY George 12-Sep-25 Las Vegas, NV World Masters"). The
 * name is kept as the PDF lays it out, except a family name the PDF runs
 * into the given name ("TAN CASTELLANOSYicay") is spaced from it.
 */
function lineHolder(value: number, rest: string, cells: string[] | undefined): RecordHolder | undefined {
  const words = rest.trim().split(/\s+/).filter(Boolean);
  const at = words.findIndex((word) => DATE_WORD.test(word));
  const name = words
    .slice(0, at < 0 ? words.length : at)
    .join(' ')
    .replace(/\b([A-Z][A-Z'-]*[A-Z])([A-Z][a-z])/g, '$1 $2');
  if (at < 0) return recordHolder(value, name);
  const [site, competition] = siteAndCompetition(words.slice(at + 1).join(' '), cells);
  return recordHolder(value, name, recordsDate(words[at]), competition, site);
}

/**
 * A lift the PDF printed with its last digit doubled, put right. The
 * September 27, 2026 women's PDF prints W40-44 86kg's total as "1744" (snatch
 * 79, C&J 95) and W55-59 69kg's snatch as "488" (C&J 65, total 113). Only a
 * class whose three lifts one lifter set on one day is checked, where
 * snatch + C&J must equal the total, and a value is changed only when it is
 * the one lift whose doubled last digit, dropped, makes them add up.
 * Returns what it changed, for the sync to log.
 */
function repairDoubledDigit(record: UsamwRecord): string | undefined {
  const { snatchRecord: snatch, cjRecord: cj, totalRecord: total, snatchBy, cjBy, totalBy } = record;
  if (snatch === null || cj === null || total === null || !snatchBy || !cjBy || !totalBy) return undefined;
  const sameDay = (a: RecordHolder, b: RecordHolder) => a.name === b.name && a.date !== undefined && a.date === b.date;
  if (!sameDay(snatchBy, cjBy) || !sameDay(snatchBy, totalBy) || snatch + cj === total) return undefined;
  const undoubled = (value: number) => (/^\d*(\d)\1$/.test(String(value)) ? Math.trunc(value / 10) : null);
  const fixes = [
    ['snatchRecord', undoubled(snatch), (v: number) => v + cj === total],
    ['cjRecord', undoubled(cj), (v: number) => snatch + v === total],
    ['totalRecord', undoubled(total), (v: number) => snatch + cj === v],
  ] as const;
  const fixed = fixes.filter(([, value, adds]) => value !== null && adds(value));
  if (fixed.length !== 1) return undefined;
  const [field, value] = fixed[0];
  const printed = record[field];
  record[field] = value!;
  return `${record.gender} ${record.ageCategory} ${record.weightClass} ${field}: printed ${printed}, stored ${value}`;
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
export function parseRecordPages(pages: (string | PdfLine)[][], gender: string, repairs: string[] = []): UsamwRecord[] {
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
  for (const record of byKey.values()) {
    const repair = repairDoubledDigit(record);
    if (repair) repairs.push(repair);
  }
  const ageNumber = (r: UsamwRecord) => Number(/\d+/.exec(r.ageCategory)![0]);
  return [...byKey.values()].sort(
    (a, b) =>
      (a.gender < b.gender ? -1 : a.gender > b.gender ? 1 : 0) ||
      ageNumber(a) - ageNumber(b) ||
      weightOrder(a.weightClass) - weightOrder(b.weightClass),
  );
}
