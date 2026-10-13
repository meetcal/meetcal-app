import { recordHolder, setHolder, type RecordHolder } from './holder';
import { pyInt } from '../lib/numbers';
import { parseHtml, type HTMLElement } from '../lib/html';
import { absoluteUrl } from '../lib/http';

// Pure parsing for `scrapers/records.ts` (port of `usaw/records_scraper`).

export type UsawRecord = {
  record_type: 'USAW';
  age_category: string;
  gender: string;
  weight_class: string;
  snatch_record: number;
  cj_record: number;
  total_record: number;
  snatch_by?: RecordHolder;
  cj_by?: RecordHolder;
  total_by?: RecordHolder;
};

function isCurrentRecordsText(text: string): boolean {
  return text.includes('American Records') && !text.includes('Former') && !text.includes('Prior');
}

/**
 * The current American Records PDF: a "View…" link under a heading that says
 * "American Records" but not "Former"/"Prior" (checked up five ancestors, then
 * three previous siblings), else any PDF link with such text around it.
 */
export function findRecordsPdfUrl(html: string, pageUrl: string): string | null {
  const root = parseHtml(html);
  const links = root.querySelectorAll('a[href]');
  for (const link of links) {
    if (!link.text.trim().toLowerCase().startsWith('view')) continue;
    let found = false;
    let parent: HTMLElement | null = link.parentNode;
    for (let level = 0; level < 5 && parent; level++) {
      if (parent.text.includes('American Records')) {
        if (isCurrentRecordsText(parent.text)) found = true;
        if (found) break;
      }
      parent = parent.parentNode;
    }
    if (!found) {
      let sibling = link.previousElementSibling;
      for (let i = 0; i < 3 && sibling; i++) {
        if (sibling.text.includes('American Records') && isCurrentRecordsText(sibling.text)) {
          found = true;
          break;
        }
        sibling = sibling.previousElementSibling;
      }
    }
    if (found) return absoluteUrl(link.getAttribute('href') ?? '', pageUrl);
  }
  for (const link of links) {
    const href = link.getAttribute('href') ?? '';
    if (!href.toLowerCase().includes('.pdf')) continue;
    let text = '';
    let parent: HTMLElement | null = link.parentNode;
    for (let i = 0; i < 3 && parent; i++) {
      text += ` ${parent.text}`;
      parent = parent.parentNode;
    }
    if (isCurrentRecordsText(text)) return absoluteUrl(href, pageUrl);
  }
  return null;
}

/** `format_weight_class`: '48' -> '48kg'; '>86', '109+', '+109kg' -> '86+kg' style. */
export function formatWeightClass(raw: string): string | null {
  let value = raw.replaceAll('$', '').trim();
  if (!value) return null;
  if (value.includes('>') || value.includes('+')) {
    const digits = /(\d+)/.exec(value.replace('kg', ''));
    if (digits) return `${digits[1]}+kg`;
  }
  value = value.replace('kg', '').trim();
  return /^\d+$/.test(value) ? `${value}kg` : null;
}

/**
 * The PDF's age group to the label the sync sends (`normalizeAgeCategory`
 * then capitalizes it). Since the August 2026 class change the PDF writes
 * the youth groups by age (`11 & Under`, `12-13yo`, `14-15yo`, `16-17yo`)
 * and spells out `University`; before, it wrote `U13`, `U15`, `U17`, `UNI`.
 * Anything else is null: an age group this does not know.
 */
export function ageCategory(code: string): string | null {
  const upper = code.trim().replace(/\s+/g, ' ').toUpperCase();
  const fixed: Record<string, string> = {
    UNI: 'university',
    UNIVERSITY: 'university',
    OPEN: 'senior',
    JUNIOR: 'junior',
    JR: 'junior',
    U11: 'u11',
    '11 & UNDER': 'u11',
    U13: 'u13',
    '12-13YO': 'u13',
    U15: 'u15',
    '14-15YO': 'u15',
    U17: 'u17',
    '16-17YO': 'u17',
  };
  if (fixed[upper]) return fixed[upper];
  if (/^[MW]\d+$/.test(upper)) return `Masters ${upper.slice(1)}`;
  return null;
}

function genderOf(code: string): string | null {
  const upper = code.trim().toUpperCase();
  return upper === 'M' ? 'men' : upper === 'F' ? 'women' : null;
}

const DATE = /^(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{2,4})$/;

/**
 * Who set a row's lift, from the words after its value: `Name Date Place
 * Event` ("HOWARD, Rayya 2026-06-20 Colorado Springs, CO 2026 National Youth
 * Championships"). The event starts at its year, so the place is what comes
 * before; without a year the two stay together, as written.
 */
function rowHolder(value: number, words: string[]): RecordHolder | undefined {
  const at = words.findIndex((word) => DATE.test(word));
  if (at < 0) return recordHolder(value, words.join(' '));
  const rest = words.slice(at + 1).join(' ');
  const split = /^(.+?)\s+((?:19|20)\d{2}\s.*)$/.exec(rest);
  return split
    ? recordHolder(value, words.slice(0, at).join(' '), words[at], split[2], split[1])
    : recordHolder(value, words.slice(0, at).join(' '), words[at], rest);
}

/**
 * A record row: `age gender bodyweight lift record [name date place event]`,
 * found by its gender and lift columns, so an age group of any wording
 * (`11 & Under`, `12-13 yo`, one this does not know) is still a record row
 * and is reported when unknown rather than skipped unseen. Adaptive rows
 * (`ADAP - Physical - OPEN F 49 …`) are another table's.
 */
const RECORD_ROW = /^(.+?) ([MF]) (\S+) (\S*(?:SNATCH|CLEAN|JERK|TOTAL)\S*) (\S+)(?: (.*))?$/i;
const ADAPTIVE = /^ADAP\b/i;

export type ParsedRecords = {
  records: UsawRecord[];
  /** Age groups of rows that look like records but that `ageCategory` does not know: those rows are not read. */
  unknownAgeGroups: string[];
};

/**
 * Records from the PDF's text lines, and the age groups it skipped. Each
 * lift's holder comes from the row that set its value.
 */
export function parseRecordsReport(pages: string[][]): ParsedRecords {
  const byKey = new Map<string, UsawRecord>();
  const unknown = new Set<string>();
  for (const lines of pages) {
    for (const line of lines) {
      const text = line.replace(/\s+/g, ' ').trim();
      const row = ADAPTIVE.test(text) ? null : RECORD_ROW.exec(text);
      if (!row) continue;
      const [, code, genderCode, bodyweight, lift, value, rest] = row;
      const gender = genderOf(genderCode);
      if (!gender) continue;
      const age = ageCategory(code);
      if (!age) {
        unknown.add(code);
        continue;
      }
      const weightClass = formatWeightClass(bodyweight);
      if (!weightClass) continue;
      if (!value || value.toUpperCase() === 'STANDARD') continue;
      const weight = pyInt(value);
      if (weight === null) continue;
      const key = `${age}|${gender}|${weightClass}`;
      const record = byKey.get(key) ?? {
        record_type: 'USAW' as const,
        age_category: age,
        gender,
        weight_class: weightClass,
        snatch_record: 0,
        cj_record: 0,
        total_record: 0,
      };
      const liftUpper = lift.toUpperCase();
      // A 0 kg standard ("W80 F 49 SNATCH 0 Standard") is no lift to hold.
      const holder = weight === 0 ? undefined : rowHolder(weight, rest ? rest.split(' ') : []);
      if (liftUpper.includes('SNATCH')) {
        record.snatch_record = weight;
        setHolder(record, 'snatch_by', holder);
      } else if (liftUpper.includes('CLEAN') && liftUpper.includes('JERK')) {
        record.cj_record = weight;
        setHolder(record, 'cj_by', holder);
      } else if (liftUpper.includes('TOTAL')) {
        record.total_record = weight;
        setHolder(record, 'total_by', holder);
      }
      byKey.set(key, record);
    }
  }
  return { records: [...byKey.values()], unknownAgeGroups: [...unknown].sort() };
}

/** The records in the PDF's text lines (`parseRecordsReport` without the skipped age groups). */
export function parseRecords(pages: string[][]): UsawRecord[] {
  return parseRecordsReport(pages).records;
}
