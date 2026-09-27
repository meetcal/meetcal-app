import { recordHolder } from '../holder';
import type { WsoRecord } from './common';

// Illinois (port of `manual_scrapers/scraper_pdf_illinois.py` and its auto
// wrapper): one PDF, one line per lift ("U13 F 37 Snatch 10 STANDARD
// 2026-08-01": the record, its holder or STANDARD, and the date; the PDF
// gives no meet or place). The set is synced exactly (rows gone from the PDF
// are deleted), so a parse that looks incomplete fails rather than writing.

const ROW = /^(U\d+|JR|Open|[WM]\d{2})\s+([FM])\s+((?:>\s*)?\d+\+?)\s+(Snatch|Clean\s*&\s*Jerk|Total)\s+(\d+(?:\.\d+)?)\s+(.+?)\s*\b(\d{4}-\d{2}-\d{2})(?!\d)/i;
const RECORD_ROW_PREFIX = /^(?:U\d+|JR|Open|[WM]\d{2})\s+[FM]\s+/i;
const MIN_RECORD_ROWS = 250;
const MIN_LIFT_VALUES = 750;
const LIFT_FIELDS = { snatch: 'snatch_record', 'clean&jerk': 'cj_record', total: 'total_record' } as const;
type LiftField = (typeof LIFT_FIELDS)[keyof typeof LIFT_FIELDS];
const HOLDER_FIELDS = { snatch_record: 'snatch_by', cj_record: 'cj_by', total_record: 'total_by' } as const;
type Parsed = Omit<WsoRecord, LiftField> & Partial<Record<LiftField, number>>;

/** The page's "View Records" link in its Illinois State Records section. */
export function illinoisPdfHref(pageHtml: string): string {
  const start = pageHtml.indexOf('Illinois State Records');
  const section = start === -1 ? pageHtml : pageHtml.slice(start, start + 25_000);
  for (const pattern of [/<a[^>]+href="([^"]+\.pdf)"[^>]*>\s*View(?:\s+the)?\s+Records\s*<\/a>/i, /href="([^"]*Illinois_State_Records[^"]+\.pdf)"/i]) {
    const match = pattern.exec(section);
    if (match) return match[1];
  }
  throw new Error('Could not find the Illinois records PDF URL on the page');
}

function weightClass(raw: string): string {
  const text = raw.trim().toLowerCase().replaceAll('kg', '').replaceAll(' ', '');
  if (text.startsWith('>')) return `${text.slice(1).replace(/\++$/, '')}+`;
  return text;
}

function ageCategory(rawAge: string, rawGender: string): string {
  const age = rawAge.trim().toUpperCase();
  if (age.startsWith('U')) return age;
  if (age === 'JR') return 'Junior';
  if (age === 'OPEN') return 'Senior';
  const masters = /^([WM])(\d{2})$/.exec(age);
  if (!masters) throw new Error(`Unsupported Illinois age group: ${rawAge}`);
  if (masters[1] !== (rawGender.trim().toUpperCase() === 'F' ? 'W' : 'M')) throw new Error(`Illinois age/gender mismatch: age=${rawAge}, gender=${rawGender}`);
  return `Masters ${masters[2]}`;
}

/** Records from the PDF's lines, and warnings about rows that look wrong in the source. */
export function parseIllinois(lines: readonly string[], wso: string): { records: WsoRecord[]; warnings: string[] } {
  const warnings: string[] = [];
  const grouped = new Map<string, Parsed>();
  const unparsed: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    const match = ROW.exec(line);
    if (!match) {
      if (RECORD_ROW_PREFIX.test(line)) unparsed.push(line);
      continue;
    }
    const [, age, rawGender, weight, lift, value, holder, date] = match;
    const gender = rawGender.toUpperCase() === 'F' ? 'Women' : 'Men';
    const record: Parsed = { wso, age_category: ageCategory(age, rawGender.toUpperCase()), gender, weight_class: weightClass(weight) };
    const key = JSON.stringify([record.age_category, gender, record.weight_class]);
    const entry = grouped.get(key) ?? record;
    grouped.set(key, entry);
    const field = LIFT_FIELDS[lift.toLowerCase().replace(/\s+/g, '') as keyof typeof LIFT_FIELDS];
    const parsed = Number(value);
    const existing = entry[field];
    // A lift listed twice must agree, except that a real value beats a 0.
    if (existing === undefined || (existing === 0 && parsed > 0)) {
      if (existing === 0) warnings.push(`Preferred non-zero duplicate (${parsed}) over zero: ${line}`);
      entry[field] = parsed;
      entry[HOLDER_FIELDS[field]] = recordHolder(parsed, holder, date);
    } else if (existing !== parsed) {
      if (parsed === 0) warnings.push(`Ignored zero duplicate in favor of ${existing}: ${line}`);
      else throw new Error(`Conflicting Illinois values for ${field}: ${existing} and ${parsed}: ${line}`);
    }
  }
  if (unparsed.length) throw new Error(`Could not parse ${unparsed.length} Illinois record rows:\n${unparsed.slice(0, 5).join('\n')}`);

  const parsedRecords = [...grouped.values()];
  validate(parsedRecords, warnings);
  const records = parsedRecords.map((r) => ({ ...r, snatch_record: r.snatch_record ?? null, cj_record: r.cj_record ?? null, total_record: r.total_record ?? null }));
  return { records, warnings };
}

function validate(records: readonly Parsed[], warnings: string[]) {
  if (records.length < MIN_RECORD_ROWS) throw new Error(`Illinois PDF yielded only ${records.length} record rows; expected at least ${MIN_RECORD_ROWS}`);
  const fields = Object.values(LIFT_FIELDS);
  const liftValues = records.reduce((count, r) => count + fields.filter((f) => r[f] !== undefined).length, 0);
  if (liftValues < MIN_LIFT_VALUES) throw new Error(`Illinois PDF yielded only ${liftValues} lift values; expected at least ${MIN_LIFT_VALUES}`);
  const expected = ['U13', 'U15', 'U17', 'Junior', 'Senior', ...Array.from({ length: 12 }, (_, i) => `Masters ${35 + i * 5}`)];
  for (const gender of ['Men', 'Women']) {
    const actual = new Set(records.filter((r) => r.gender === gender).map((r) => r.age_category));
    const missing = expected.filter((age) => !actual.has(age)).sort();
    if (missing.length) throw new Error(`Illinois PDF is missing ${gender} age groups: ${missing.join(', ')}`);
  }
  const labels: [LiftField, string][] = [
    ['snatch_record', 'snatch'],
    ['cj_record', 'clean & jerk'],
    ['total_record', 'total'],
  ];
  for (const r of records) {
    const identity = `${r.age_category} ${r.gender} ${r.weight_class}`;
    const missing = labels.filter(([field]) => r[field] === undefined).map(([, label]) => label);
    if (missing.length) warnings.push(`Source row is missing ${missing.join(', ')}: ${identity}`);
    const lifts = [r.snatch_record, r.cj_record].filter((x): x is number => x !== undefined);
    if (r.total_record && lifts.length && r.total_record < Math.max(...lifts)) {
      warnings.push(`Source total (${r.total_record}) is below an individual lift (${Math.max(...lifts)}): ${identity}`);
    }
  }
}
