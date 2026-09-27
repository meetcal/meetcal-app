import { recordHolder, type RecordHolder } from '../holder';
import { intOrNull, type WsoRecord } from './common';

// New York (port of `manual_scrapers/scraper_pdf_newyork.py` and its auto
// wrapper): five PDFs (Youth, Junior, Senior, Masters Men, Masters Women), a
// table per page under a heading ("Youth Men", "Masters Men: 35-39"), three
// rows per class (Snatch, Clean and Jerk, Total; the value as "46 kg").
//
// The Python read pdfplumber's table cells; this reads the same pages' text
// lines, where the class (a cell spanning its three rows) prints on the
// middle one: "Snatch 46 kg ...", "55 Clean and Jerk 57 kg ...", "Total ...".
// After the value come Name, Date and Event ("Aaron Li 5/2/2026 Hudson
// Valley Regional Open", "Record Standard - -"); the date (or the dash left
// where there is none) is what separates the name from the event.

/** The first five record PDFs in the page's Current Records section (before State Meet Records). */
export function newYorkPdfUrls(html: string): string[] {
  let start = html.indexOf('id="current-records"');
  if (start === -1) start = html.indexOf('Current Records');
  const end = html.indexOf('State Meet Records');
  const section = start === -1 ? html.slice(0, end === -1 ? undefined : end) : end > start ? html.slice(start, end) : html.slice(start, start + 10_000);
  const urls = [...new Set([...section.matchAll(/href="(https:\/\/www\.nywso\.com\/_files\/ugd\/[a-zA-Z0-9_/]+\.pdf)"/g)].map((m) => m[1]))];
  // The Python kept the ones it could label from nearby text, topping up from
  // the rest when that left fewer than five.
  const labelled = urls.filter((url) => {
    const at = section.indexOf(url);
    const near = section.slice(Math.max(0, at - 1500), at + 200);
    return /Masters\s*(?:<[^>]*>)*\s*(?:Wo)?men/i.test(near) || /\b(?:Youth|Junior|Senior)\b/i.test(near);
  });
  const picked = labelled.slice(0, 5);
  if (picked.length < 5 && urls.length >= 5) picked.push(...urls.slice(picked.length, 5));
  return picked;
}

/** "Youth Men" -> ["Youth", "Men"], "Masters Women: 35-39" -> ["Masters 35", "Women"]. */
export function newYorkSection(header: string): [age: string, gender: 'Men' | 'Women'] | null {
  const text = header.trim();
  const gender = text.includes('Men') ? 'Men' : text.includes('Women') ? 'Women' : null;
  if (!gender) return null;
  if (text.includes('Senior') || text.includes('Open')) return ['Senior', gender];
  if (text.includes('Junior')) return ['Junior', gender];
  if (text.includes('Youth')) return ['Youth', gender];
  if (text.includes('Masters')) {
    const range = /(\d+)\s*-\s*\d+/.exec(text);
    if (range) return [`Masters ${range[1]}`, gender];
  }
  return null;
}

const LIFT_LINE = /^(?:(\+?\d+\+?)\s+)?(Snatch|Clean and Jerk|Clean & Jerk|C&J|Total)\b\s*(.*)$/;

/** "46 kg ..." -> 46; no value, a dash or 0 -> null. */
function liftValue(rest: string): number | null {
  const value = /^(\S+?)\s*kg\b/.exec(rest)?.[1];
  if (!value) return null;
  const parsed = intOrNull(value);
  return parsed ? parsed : null;
}

const DATE = /^\d{1,2}\/\d{1,2}\/\d{2}(?:\d{2})?$/;
const DASH = /^[-–—]+$/;

/** Who set a lift of `value`, from the words after it: name, date, event (there is no place column). */
function liftHolder(value: number | null, rest: string): RecordHolder | undefined {
  if (value === null) return undefined;
  const words = rest.replace(/^\S+?\s*kg\b/, '').trim().split(/\s+/).filter(Boolean);
  let at = words.findIndex((word) => DATE.test(word));
  if (at === -1) at = words.findIndex((word) => DASH.test(word));
  if (at === -1) return recordHolder(value, words.join(' '));
  return recordHolder(value, words.slice(0, at).join(' '), words[at], words.slice(at + 1).join(' '));
}

const weightClass = (raw: string) => (raw.includes('+') && !raw.endsWith('+') ? `${raw.replaceAll('+', '')}+` : raw);

/** One PDF's records, page by page, in the order the Python wrote them (a class listed twice appears twice). */
export function parseNewYork(pages: readonly (readonly string[])[], wso: string): WsoRecord[] {
  const records: WsoRecord[] = [];
  for (const page of pages) {
    let section: [string, 'Men' | 'Women'] | null = null;
    // The class being read, from its Snatch row to the next class's.
    let block: WsoRecord | null = null;
    const blocks: WsoRecord[] = [];
    for (const raw of page) {
      const line = raw.trim();
      if (/Youth|Junior|Senior|Open|Masters/.test(line) && /Men|Women/.test(line) && !LIFT_LINE.test(line)) {
        section = newYorkSection(line) ?? section;
        continue;
      }
      const lift = LIFT_LINE.exec(line);
      const bareClass = /^\+?\d+\+?$/.exec(line)?.[0];
      if (!lift && !bareClass) continue;
      if (!block || lift?.[2] === 'Snatch') {
        block = { wso, age_category: section?.[0] ?? '', gender: section?.[1] ?? 'Men', weight_class: '', snatch_record: null, cj_record: null, total_record: null };
        blocks.push(block);
      }
      const label = lift?.[1] ?? bareClass;
      if (label) block.weight_class = weightClass(label);
      if (!lift) continue;
      const value = liftValue(lift[3]);
      if (lift[2] === 'Snatch') block.snatch_record = value;
      else if (lift[2] === 'Total') block.total_record = value;
      else block.cj_record = value;
      const field = lift[2] === 'Snatch' ? 'snatch_by' : lift[2] === 'Total' ? 'total_by' : 'cj_by';
      const by = liftHolder(value, lift[3]);
      if (by) block[field] = by;
      else delete block[field];
    }
    records.push(...blocks.filter((b) => b.weight_class && b.age_category));
  }
  return records;
}
