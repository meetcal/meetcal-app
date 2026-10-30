import type { PdfLine } from '../../lib/pdf';
import { recordHolder, setHolder, type RecordHolder } from '../holder';
import { blankRecord, intOrNull, plusLast, type WsoRecord } from './common';

// Mountain South (port of `manual_scrapers/scraper_pdf_mountainsouth.py` and
// its auto wrapper): a men's and a women's PDF linked from the records page.
// Since the 17 October 2026 PDFs (the classes in force from 1 August 2026),
// each age group is a section headed "OPEN MEN" or "MASTER WOMEN W35
// (35-39)", and each class has a line per lift: "60 Snatch 77 MCALLISTER,
// Ashton 6/22/25 Colorado Springs, CO 2025 Youth Nationals", or "60 Snatch 0
// STANDARD 8/1/26" when vacant. The PDFs before then had a section per lift
// and a line per class; a line in that layout throws rather than parse to
// nothing.
//
// Lines come as text or as positioned runs. The lift values read the text
// alone; the holders read the runs where there are any, because the text
// cannot tell where the place ends and the event begins ("Mesa, AZ 2026 AZ
// Championship").

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

/** "OPEN MEN" -> ["Senior", "Men"], "YOUTH WOMEN 14-15" -> ["U15", "Women"], "YOUTH MEN U11" -> ["U11", "Men"], "MASTER WOMEN W35 (35-39)" -> ["Masters 35", "Women"]. */
export function mountainSouthSection(line: string): [age: string, gender: 'Men' | 'Women'] | null {
  const header = line.trim().toUpperCase();
  const gender = header.includes('MEN') && !header.includes('WOMEN') ? 'Men' : header.includes('WOMEN') ? 'Women' : null;
  if (!gender) return null;
  if (header.includes('OPEN')) return ['Senior', gender];
  if (header.includes('JUNIOR')) return ['Junior', gender];
  if (['YOUTH', 'U17', 'U15', 'U13', 'U11'].some((word) => header.includes(word))) {
    if (header.includes('17')) return ['U17', gender];
    if (header.includes('15')) return ['U15', gender];
    if (header.includes('13')) return ['U13', gender];
    // "YOUTH MEN U11", the age group every other WSO stores as U11.
    if (header.includes('11')) return ['U11', gender];
    return ['Youth', gender];
  }
  if (header.includes('MASTER')) {
    // "(35-39)", or "(80+)" for the oldest.
    const range = /(\d+)\s*(?:-\s*\d+|\+)/.exec(header);
    if (range) return [`Masters ${range[1]}`, gender];
  }
  return null;
}

/** A class line: its class, lift and record, then the holder's cells. */
const CLASS_LINE = /^(\+?\d+\+?)\s+(Snatch|Clean\s*&\s*Jerk|Total)\s+(\S+)/i;

/** A line in the class rows' shape (a class, then a word): one CLASS_LINE cannot read is a layout change. */
const CLASS_SHAPE = /^\+?\d+\+?\s+[A-Za-z]/;

/** An age group's heading: "OPEN MEN", "MASTER WOMEN W35 (35-39)". */
const SECTION = /^(?:OPEN|JUNIOR|YOUTH|MASTERS?)\s+(?:WO)?MEN\b/;

/** Lifts by their first letter: "Clean & Jerk" may print without its spaces. */
const FIELDS = { s: 'snatch_record', c: 'cj_record', t: 'total_record' } as const;
const HOLDER_FIELDS = { snatch_record: 'snatch_by', cj_record: 'cj_by', total_record: 'total_by' } as const;

/**
 * Where the EVENT column starts on this page: halfway between the LOCATION
 * and EVENT headings, which are centred over their columns, so a place's
 * cell starts left of it and an event's right of it.
 */
type Columns = { event?: number };

/** A word of a line, with where its run starts when the line has positions. */
type Word = { text: string; x?: number };

const words = (text: string, x?: number): Word[] =>
  text
    .split(/\s+/)
    // Blank cells print as "#N/A" or a dash.
    .filter((word) => word && word !== '#N/A' && !/^[-–—]+$/.test(word))
    .map((word) => ({ text: word, x }));

const DATE = /^\d{1,2}\/\d{1,2}\/\d{2}(?:\d{2})?$/;

/** Where the record is among a line's words: the first after the class to start with a digit (the lift's words never do). */
const recordAt = (list: readonly Word[]) => list.findIndex((word, i) => i > 0 && /^\d/.test(word.text));

/**
 * Who set `value`, from the words after the record: the athlete, the date,
 * then the place and the event. The runs are read when they agree with the
 * text on the record, the text's words otherwise.
 */
function lineHolder(value: number | null, line: string | PdfLine, columns: Columns): RecordHolder | undefined {
  if (value === null) return undefined;
  const text = words(typeof line === 'string' ? line : line.text);
  const runs = typeof line === 'string' ? [] : line.runs.flatMap((run) => words(run.text, run.x));
  const all = recordAt(runs) !== -1 && Math.trunc(Number(runs[recordAt(runs)].text)) === value ? runs : text;
  const rest = all.slice(recordAt(all) + 1);
  const at = rest.findIndex((word) => DATE.test(word.text));
  const name = at === -1 ? rest : rest.slice(0, at);
  const after = at === -1 ? [] : rest.slice(at + 1);
  const split = columns.event !== undefined && after.every((word) => word.x !== undefined);
  const place = split ? after.filter((word) => word.x! < columns.event!) : after;
  const event = split ? after.filter((word) => word.x! >= columns.event!) : [];
  const join = (list: Word[]) => list.map((word) => word.text).join(' ');
  return recordHolder(value, join(name), at === -1 ? null : rest[at].text, join(event), join(place));
}

/** One PDF's records, from its lines (text, or runs with positions) page by page. */
export function parseMountainSouth(pages: readonly (readonly (string | PdfLine)[])[], wso: string): WsoRecord[] {
  const records = new Map<string, WsoRecord>();
  // An age group, and the column headings, may run on to the next page without being printed again.
  let section: [string, 'Men' | 'Women'] | null = null;
  let columns: Columns = {};
  for (const page of pages) {
    for (const source of page) {
      const line = (typeof source === 'string' ? source : source.text).trim();
      if (line.includes('CAT') && line.includes('LIFT') && line.includes('RECORD')) {
        if (typeof source !== 'string') {
          const at = (name: string) => source.runs.find((run) => run.text.trim() === name)?.x;
          const [location, event] = [at('LOCATION'), at('EVENT')];
          if (location !== undefined && event !== undefined) columns = { event: (location + event) / 2 };
        }
        continue;
      }
      if (SECTION.test(line)) {
        section = mountainSouthSection(line);
        // Keeping the previous group would file this one's lines over it.
        if (!section) throw new Error(`${wso}: unreadable age group heading ${JSON.stringify(line)} (layout changed?)`);
        continue;
      }
      // Page numbers, dates and notes are not classes.
      if (!section || !CLASS_SHAPE.test(line)) continue;
      const match = CLASS_LINE.exec(line);
      if (!match) throw new Error(`${wso}: unreadable class line ${JSON.stringify(line)} (layout changed?)`);
      const weightClass = plusLast(match[1]);
      const field = FIELDS[match[2][0].toLowerCase() as keyof typeof FIELDS];
      const key = JSON.stringify([section[0], section[1], weightClass]);
      const record = records.get(key) ?? blankRecord(wso, section[0], section[1], weightClass);
      records.set(key, record);
      // 0 is how the PDFs list a vacant class.
      const value = intOrNull(match[3]) || null;
      record[field] = value;
      setHolder(record, HOLDER_FIELDS[field], lineHolder(value, source, columns));
    }
  }
  return [...records.values()];
}
