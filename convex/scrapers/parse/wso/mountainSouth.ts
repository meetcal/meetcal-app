import type { PdfLine } from '../../lib/pdf';
import { recordHolder, type RecordHolder } from '../holder';
import { intOrNull, type WsoRecord } from './common';

// Mountain South (port of `manual_scrapers/scraper_pdf_mountainsouth.py` and
// its auto wrapper): a men's and a women's PDF linked from the records page,
// sections headed "MASTERS MEN 35-39 - SNATCH", one line per class ("60 Name
// STATE 120 date event location", or just "60" when vacant).
//
// Lines come as text or as positioned runs. The lift values read the text
// alone; the holders read the runs where there are any, because the text
// cannot tell where the event ends and the place begins ("WSO Championship
// Salt Lake City, UT"), and a first name wide enough to touch the last-name
// column prints without a space ("Jean-JacquesCabou").

/** The current men's and women's PDFs in the page's "MOUNTAIN SOUTH WSO RECORDS" section. */
export function mountainSouthPdfUrls(html: string): string[] {
  const start = html.indexOf('MOUNTAIN SOUTH WSO RECORDS');
  if (start === -1) return [];
  const archived = html.indexOf('ARCHIVED MOUNTAIN SOUTH WSO RECORDS', start);
  const section = archived === -1 ? html.slice(start, start + 5000) : html.slice(start, archived);
  const genderOf = (text: string) => {
    const upper = text.toUpperCase();
    return upper.includes('WOMEN') ? 'Women' : upper.includes('MEN') ? 'Men' : null;
  };
  const urls: string[] = [];
  for (const [, url, text] of section.matchAll(/href="(https:\/\/mountainsouth\.org\/[^"]+\/Mountain-South-WSO-Records[^"]*\.pdf)"[^>]*>([^<]+)/gi)) {
    if (urls.includes(url) || url.toLowerCase().includes('certificate') || text.toLowerCase().includes('certificate')) continue;
    if (!genderOf(url) && !genderOf(text)) continue;
    urls.push(url);
    if (urls.length >= 2) return urls;
  }
  // Without link text to go by, any two record PDFs in the section.
  const loose: string[] = [];
  for (const [url] of section.matchAll(/https:\/\/mountainsouth\.org\/[^"'>\s]+Mountain-South-WSO-Records[^"'>\s]+\.pdf/gi)) {
    if (loose.includes(url) || url.toLowerCase().includes('certificate')) continue;
    loose.push(url);
    if (loose.length >= 2) break;
  }
  return loose;
}

/** "YOUTH MEN U17 - SNATCH" -> ["U17", "Men"], "MASTERS WOMEN 35-39 - TOTAL" -> ["Masters 35", "Women"]. */
export function mountainSouthSection(line: string): [age: string, gender: 'Men' | 'Women'] | null {
  const header = line.trim().toUpperCase();
  const gender = header.includes('MEN') && !header.includes('WOMEN') ? 'Men' : header.includes('WOMEN') ? 'Women' : null;
  if (!gender) return null;
  if (header.includes('OPEN')) return ['Senior', gender];
  if (header.includes('JUNIOR')) return ['Junior', gender];
  if (['YOUTH', 'U17', 'U15', 'U13'].some((word) => header.includes(word))) {
    if (header.includes('17')) return ['U17', gender];
    if (header.includes('15')) return ['U15', gender];
    if (header.includes('13')) return ['U13', gender];
    return ['Youth', gender];
  }
  if (header.includes('MASTERS')) {
    const range = /(\d+)\s*-\s*\d+/.exec(header);
    if (range) return [`Masters ${range[1]}`, gender];
  }
  return null;
}

/** A positive whole lift, or null (0 means vacant). */
function lift(text: string): number | null {
  const value = intOrNull(text);
  return value ? value : null;
}

const FIELDS = { SNATCH: 'snatch_record', CLEAN_JERK: 'cj_record', TOTAL: 'total_record' } as const;
const HOLDER_FIELDS = { snatch_record: 'snatch_by', cj_record: 'cj_by', total_record: 'total_by' } as const;

/** Where the STATE and LOCATION columns start on this page (from the "CAT ATHLETE ..." header's runs). */
type Columns = { state?: number; location?: number };

/** A word of a line, with where its run starts when the line has positions. */
type Word = { text: string; x?: number };

const words = (text: string, x?: number): Word[] =>
  text
    .split(/\s+/)
    // Blank cells print as "#N/A" or a dash.
    .filter((word) => word && word !== '#N/A' && !/^[-–—]+$/.test(word))
    .map((word) => ({ text: word, x }));

const DATE = /^\d{1,2}\/\d{1,2}\/\d{2}(?:\d{2})?$/;
const STATE = /^[A-Z]{2}$/;

/**
 * Who set `value` on a class line: the words before it are the athlete and
 * their state, then the date, the event and the place. The state column is
 * the athlete's home, not where the lift was made, so it is left out.
 */
function lineHolder(value: number | null, line: string | PdfLine, columns: Columns): RecordHolder | undefined {
  if (value === null) return undefined;
  const runs = typeof line === 'string' ? [] : line.runs.flatMap((run) => words(run.text, run.x));
  // The runs split words the text joins ("Jean-JacquesCabou"); should they
  // disagree about the value, the text's words are the ones it came from.
  const first = runs.slice(1).find((word) => lift(word.text) !== null);
  const all = first && lift(first.text) === value ? runs : words(typeof line === 'string' ? line : line.text);
  const at = all.findIndex((word, i) => i > 0 && lift(word.text) === value);
  if (at === -1) return recordHolder(value, null);
  const before = all.slice(1, at);
  const after = all.slice(at + 1);
  const positioned = columns.state !== undefined && before.every((word) => word.x !== undefined);
  const name = positioned ? before.filter((word) => word.x! < columns.state! - 5) : before.length > 1 && STATE.test(before[before.length - 1].text) ? before.slice(0, -1) : before;
  const date = after[0] && DATE.test(after[0].text) ? after.shift()!.text : null;
  const atPlace = columns.location !== undefined && after.every((word) => word.x !== undefined);
  const event = atPlace ? after.filter((word) => word.x! < columns.location! - 5) : [];
  const place = atPlace ? after.filter((word) => word.x! >= columns.location! - 5) : after;
  const join = (list: Word[]) => list.map((word) => word.text).join(' ');
  return recordHolder(value, join(name), date, join(event), join(place));
}

/** One PDF's records, from its lines (text, or runs with positions) page by page. */
export function parseMountainSouth(pages: readonly (readonly (string | PdfLine)[])[], wso: string): WsoRecord[] {
  const records = new Map<string, WsoRecord>();
  for (const page of pages) {
    let section: [string, 'Men' | 'Women'] | null = null;
    let field: (typeof FIELDS)[keyof typeof FIELDS] | null = null;
    let columns: Columns = {};
    for (const source of page) {
      const line = (typeof source === 'string' ? source : source.text).trim();
      if (line.includes(' - SNATCH') || line.includes(' - CLEAN & JERK') || line.includes(' - TOTAL')) {
        const parsed = mountainSouthSection(line);
        if (parsed) {
          section = parsed;
          field = line.includes('SNATCH') ? FIELDS.SNATCH : line.includes('CLEAN') ? FIELDS.CLEAN_JERK : FIELDS.TOTAL;
        }
        continue;
      }
      if ((line.includes('CAT') && line.includes('ATHLETE')) || line.includes('Beginning 6/1/2025')) {
        if (typeof source !== 'string') {
          const at = (name: string) => source.runs.find((run) => run.text.trim() === name)?.x;
          columns = { state: at('STATE'), location: at('LOCATION') };
        }
        continue;
      }
      const parts = line.split(/\s+/).filter(Boolean);
      if (!parts.length || !section || !field || !/^\d+$/.test(parts[0].replaceAll('+', ''))) continue;
      const weightClass = parts[0].includes('+') && !parts[0].endsWith('+') ? `${parts[0].replaceAll('+', '')}+` : parts[0];
      const key = JSON.stringify([section[0], section[1], weightClass]);
      const record = records.get(key) ?? { wso, age_category: section[0], gender: section[1], weight_class: weightClass, snatch_record: null, cj_record: null, total_record: null };
      records.set(key, record);
      // The record is the first positive number after the class among the
      // next five words (the athlete's name and state come before it).
      let value: number | null = null;
      if (parts.length >= 4) {
        for (let i = 1; i < Math.min(parts.length, 6) && value === null; i++) value = lift(parts[i]);
      }
      record[field] = value;
      const by = lineHolder(value, source, columns);
      if (by) record[HOLDER_FIELDS[field]] = by;
      else delete record[HOLDER_FIELDS[field]];
    }
  }
  return [...records.values()];
}
