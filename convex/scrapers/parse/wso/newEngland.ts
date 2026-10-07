import type { PdfLine } from '../../lib/pdf';
import { recordHolder } from '../holder';
import { intOrNull, type WsoRecord } from './common';

// New England (port of `manual_scrapers/scraper_pdf_newengland.py` and its
// auto wrapper): every records PDF linked from the records page, a table per
// page under a title ("16/17 Youth Men's Records"), columns Class, Lift,
// Name, Representing, Location/Meet, Weight, Date, three rows per class.
//
// The Python read pdfplumber's table cells. The Weight column sits between
// free-text columns, so here each text run (one per cell) goes to the column
// whose header it is centred under, the class printing on the middle row.
//
// The holder is the Name cell less the bodyweight it ends with ("Cian
// Whitney (29.70)"), the Date, and the Location/Meet cell (a meet name,
// "2025 Bay State Games"); Representing is the athlete's club, not a place.

/** Every records PDF the page links, in page order. */
export function newEnglandPdfUrls(html: string): string[] {
  return [...new Set([...html.matchAll(/href="(https:\/\/www\.newenglandweightlifting\.com\/_files\/ugd\/[a-zA-Z0-9_/]+\.pdf)"/g)].map((m) => m[1]))];
}

/** "16/17 Youth Men's Records" -> ["U17", "Men"], "35-39 Masters Women's Records" -> ["Masters 35", "Women"]. */
export function newEnglandSection(header: string): [age: string, gender: 'Men' | 'Women'] | null {
  const text = header.trim();
  const gender = text.includes('Men') ? 'Men' : text.includes('Women') ? 'Women' : null;
  if (!gender) return null;
  if (text.includes('Open')) return ['Senior', gender];
  if (text.includes('Junior')) return ['Junior', gender];
  if (text.includes('Youth') || text.includes('16-17') || text.includes('16/17')) {
    if (['16-17', '16/17', 'U17'].some((s) => text.includes(s))) return ['U17', gender];
    if (['14-15', '14/15', 'U15'].some((s) => text.includes(s))) return ['U15', gender];
    if (text.includes('13')) return ['U13', gender];
    if (text.includes('11U') || text.includes('U11')) return ['U11', gender];
    return null;
  }
  if (text.includes('Masters')) {
    const range = /(\d+)\s*-\s*\d+/.exec(text);
    if (range) return [`Masters ${range[1]}`, gender];
  }
  return null;
}

const COLUMNS = ['Class', 'Lift', 'Name', 'Representing', 'Location/Meet', 'Weight', 'Date'] as const;
type Column = (typeof COLUMNS)[number];

const centre = (run: { x: number; end: number }) => (run.x + run.end) / 2;

/** "Cian Whitney (29.70)" -> "Cian Whitney": a trailing parenthesised number is the lifter's bodyweight. */
const athlete = (name: string) => name.replace(/\s*\(\s*\d+(?:\.\d+)?\s*(?:kg)?\s*\)$/i, '');

const weightClass = (raw: string) => (raw.includes('+') && !raw.endsWith('+') ? `${raw.replaceAll('+', '')}+` : raw);

/** One PDF's records, page by page, in the order the Python wrote them. */
export function parseNewEngland(pages: readonly (readonly PdfLine[])[], wso: string): WsoRecord[] {
  const records: WsoRecord[] = [];
  for (const page of pages) {
    let section: [string, 'Men' | 'Women'] | null = null;
    let columns: { name: Column; centre: number }[] | null = null;
    let block: WsoRecord | null = null;
    const blocks: WsoRecord[] = [];
    for (const line of page) {
      if (line.text.includes('Records')) {
        section = newEnglandSection(line.text) ?? section;
        continue;
      }
      if (line.runs[0]?.text.trim() === 'Class') {
        columns = line.runs.flatMap((run) => (COLUMNS.includes(run.text.trim() as Column) ? [{ name: run.text.trim() as Column, centre: centre(run) }] : []));
        continue;
      }
      if (!columns?.length) continue;
      const cells: Partial<Record<Column, string>> = {};
      for (const run of line.runs) {
        const nearest = columns.reduce((best, column) => (Math.abs(column.centre - centre(run)) < Math.abs(best.centre - centre(run)) ? column : best));
        cells[nearest.name] = [cells[nearest.name], run.text.trim()].filter(Boolean).join(' ');
      }
      const lift = cells.Lift ?? '';
      const classCell = cells.Class && /^\d+$/.test(cells.Class.replaceAll('+', '').replaceAll(' ', '')) ? cells.Class : null;
      if (!/Snatch|C&J|Clean|Total/.test(lift) && !classCell) continue;
      if (!block || lift.includes('Snatch')) {
        block = { wso, age_category: section?.[0] ?? '', gender: section?.[1] ?? 'Men', weight_class: '', snatch_record: null, cj_record: null, total_record: null };
        blocks.push(block);
      }
      if (classCell) block.weight_class = weightClass(classCell);
      const name = cells.Name ?? '';
      const weight = cells.Weight ?? '';
      // "Open" is a class with no record yet; 0 or a non-number is none either.
      const parsed = name.toUpperCase() === 'OPEN' || !weight ? null : intOrNull(weight);
      const value = parsed ? parsed : null;
      const field = lift.includes('Snatch') ? 'snatch' : lift.includes('C&J') || lift.includes('Clean') ? 'cj' : lift.includes('Total') ? 'total' : null;
      if (field === 'snatch') block.snatch_record = value;
      else if (field === 'cj') block.cj_record = value;
      else if (field === 'total') block.total_record = value;
      if (field) {
        const by = recordHolder(value, athlete(name), cells.Date, cells['Location/Meet']);
        if (by) block[`${field}_by`] = by;
        else delete block[`${field}_by`];
      }
    }
    records.push(...blocks.filter((b) => b.weight_class && b.age_category));
  }
  return records;
}
