import { recordHolder } from '../holder';
import type { WsoRecord } from './common';

// Illinois (port of `manual_scrapers/scraper_pdf_illinois.py` and its auto
// wrapper): one PDF, one line per lift. Since October 2026 a line reads
// "JR F 61 Snatch 42 kg BAKER, Sophie Oct 3, 2026 2026 Mid American
// Championships": the record in kg, its holder or STANDARD, the date, and the
// meet as the place (blank for older records). The earlier PDFs read
// "U13 F 37 Snatch 10 STANDARD 2026-08-01", with no unit and no place; both
// are read. A holder's name can run into the date ("CarmenOct 3, 2026").
//
// The set is synced exactly (rows gone from the PDF are deleted), and the PDF
// decides which youth groups exist (the October 2026 one added U11 and
// dropped U13 and U15), so an age group gone from both genders is taken as
// the source's choice. What fails instead, as a parse that lost part of the
// PDF: too few classes or lifts, an adult group missing (Junior, Senior,
// Masters 35-90), a gap in the pages' footers ("4 of 15"), or an age group
// with a different number of classes for women than for men.

// Whole month words only, so a first name run into the date ("BINDER,
// MarkOct 4, 2026") isn't read as March.
const MONTH = String.raw`(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)`;
const MONTH_DATE = String.raw`${MONTH}\.?\s+\d{1,2},?\s+\d{4}`;
const ROW = new RegExp(
  String.raw`^(U\d+|JR|Open|[WM]\d{2})\s+([FM])\s+((?:>\s*)?\d+\+?)\s+(Snatch|Clean\s*&\s*Jerk|Total)\s+(\d+(?:\.\d+)?)(?:\s*kg)?\s+(.+?)\s*(\d{4}-\d{2}-\d{2}|${MONTH_DATE})(?!\d)(?:\s+(.+))?`,
  'i',
);
const RECORD_ROW_PREFIX = /^(?:U\d+|JR|Open|[WM]\d{2})\s+[FM]\s+/i;
// The October 2026 PDF has 256 classes (768 lifts), 128 a gender; the
// September one had 282. Low enough that Illinois can drop more youth groups;
// a partial parse is caught by the checks in `validate`, not by this floor.
const MIN_RECORD_ROWS = 150;
const MIN_LIFT_VALUES = 3 * MIN_RECORD_ROWS;
const ADULT_AGE_GROUPS = ['Junior', 'Senior', ...Array.from({ length: 12 }, (_, i) => `Masters ${35 + i * 5}`)];
// Each page's footer: "1 of 15 IL WSO Records 20261004.xlsx" since October
// 2026, "Page 1 of 27" before. The notes pages at the end have none.
const PAGE_FOOTER = /^(?:Page\s+)?(\d{1,3})\s+of\s+\d{1,3}(?:\s|$)/i;
const LIFT_FIELDS = { snatch: 'snatch_record', 'clean&jerk': 'cj_record', total: 'total_record' } as const;
type LiftField = (typeof LIFT_FIELDS)[keyof typeof LIFT_FIELDS];
const HOLDER_FIELDS = { snatch_record: 'snatch_by', cj_record: 'cj_by', total_record: 'total_by' } as const;
type Parsed = Omit<WsoRecord, LiftField> & Partial<Record<LiftField, number>>;

const VIEW_RECORDS_LINK = /<a[^>]+href="([^"]+\.pdf)"[^>]*>\s*View(?:\s+the)?\s+Records\s*<\/a>/gi;
const RECORDS_HEADING = /<h[1-6][^>]*>\s*Illinois State Records\s*<\/h[1-6]>/i;
const FILE_DATE = /(20\d{6})[^/]*\.pdf$/i;

/**
 * The records PDF: the "View (the) Records" button in the page section (the
 * `<section>`, or the rest of the page after the heading if there is none)
 * that holds the "Illinois State Records" heading; the newest by the date in
 * its file name if there are several. The same words open a banner in
 * another section ("Illinois State Records are updated!"), so the heading is
 * the heading element, or else the words' last mention. No button there
 * fails rather than guessing at the page's other PDFs.
 */
export function illinoisPdfHref(pageHtml: string): string {
  const heading = RECORDS_HEADING.exec(pageHtml)?.index ?? pageHtml.lastIndexOf('Illinois State Records');
  if (heading === -1) throw new Error('Could not find the Illinois State Records section on the page');
  const open = pageHtml.lastIndexOf('<section', heading);
  const close = pageHtml.indexOf('</section>', heading);
  const section = pageHtml.slice(open === -1 ? heading : open, close === -1 ? undefined : close);
  const hrefs = [...section.matchAll(VIEW_RECORDS_LINK)].map((m) => m[1]);
  if (!hrefs.length) throw new Error('Could not find the Illinois records PDF URL on the page');
  const dateOf = (href: string) => FILE_DATE.exec(href)?.[1] ?? '';
  return hrefs.reduce((newest, href) => (dateOf(href) > dateOf(newest) ? href : newest));
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
  const pages: number[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    const footer = PAGE_FOOTER.exec(line);
    if (footer) {
      pages.push(Number(footer[1]));
      continue;
    }
    const match = ROW.exec(line);
    if (!match) {
      if (RECORD_ROW_PREFIX.test(line)) unparsed.push(line);
      continue;
    }
    const [, age, rawGender, weight, lift, value, holder, date, place] = match;
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
      entry[HOLDER_FIELDS[field]] = recordHolder(parsed, holder, date, place);
    } else if (existing !== parsed) {
      if (parsed === 0) warnings.push(`Ignored zero duplicate in favor of ${existing}: ${line}`);
      else throw new Error(`Conflicting Illinois values for ${field}: ${existing} and ${parsed}: ${line}`);
    }
  }
  if (unparsed.length) throw new Error(`Could not parse ${unparsed.length} Illinois record rows:\n${unparsed.slice(0, 5).join('\n')}`);

  const parsedRecords = [...grouped.values()];
  validate(parsedRecords, pages, warnings);
  const records = parsedRecords.map((r) => ({ ...r, snatch_record: r.snatch_record ?? null, cj_record: r.cj_record ?? null, total_record: r.total_record ?? null }));
  return { records, warnings };
}

function validate(records: Parsed[], pages: readonly number[], warnings: string[]) {
  // A page the extraction lost leaves a gap in the footers' page numbers.
  const seen = new Set(pages);
  const gaps = Array.from({ length: Math.max(0, ...pages) }, (_, i) => i + 1).filter((page) => !seen.has(page));
  if (gaps.length) throw new Error(`Illinois PDF is missing pages ${gaps.join(', ')} (by its page footers)`);
  if (records.length < MIN_RECORD_ROWS) throw new Error(`Illinois PDF yielded only ${records.length} record rows; expected at least ${MIN_RECORD_ROWS}`);
  const fields = Object.values(LIFT_FIELDS);
  const liftValues = records.reduce((count, r) => count + fields.filter((f) => r[f] !== undefined).length, 0);
  if (liftValues < MIN_LIFT_VALUES) throw new Error(`Illinois PDF yielded only ${liftValues} lift values; expected at least ${MIN_LIFT_VALUES}`);
  for (const gender of ['Men', 'Women']) {
    const actual = new Set(records.filter((r) => r.gender === gender).map((r) => r.age_category));
    const missing = ADULT_AGE_GROUPS.filter((age) => !actual.has(age));
    if (missing.length) throw new Error(`Illinois PDF is missing ${gender} age groups: ${missing.join(', ')}`);
  }
  // Illinois lists as many classes for women as for men in every age group
  // (both PDFs so far), so a group short for one gender lost rows.
  const classes = new Map<string, { Women: number; Men: number }>();
  for (const r of records) {
    const counts = classes.get(r.age_category) ?? { Women: 0, Men: 0 };
    counts[r.gender as 'Women' | 'Men'] += 1;
    classes.set(r.age_category, counts);
  }
  for (const [age, { Women, Men }] of classes) {
    if (Women !== Men) throw new Error(`Illinois PDF has ${Women} Women and ${Men} Men ${age} classes (part of the PDF not read?)`);
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
    checkTotal(r, identity, warnings);
  }
}

/**
 * Totals the PDF has wrong, each checked against the athlete's meet results.
 * One applies only while the PDF still says what it was checked against, so
 * a corrected (or changed) PDF wins.
 */
const TOTAL_CORRECTIONS: readonly { age_category: string; gender: string; weight_class: string; written: number; total: number }[] = [
  // Stephanie Rosario, 2026 Mid American Championships: 66 + 84 = 150.
  { age_category: 'Masters 40', gender: 'Women', weight_class: '69', written: 1580, total: 150 },
];

/**
 * A total above snatch + clean & jerk can't be right, but the three numbers
 * don't say which one is wrong: William Lund's M50 >110 total of 147
 * (October 2026) is his meet total, and the 84 kg clean & jerk beside it is
 * the slip (he made 85). A rule that guessed would overwrite a right total
 * whenever a lift was the typo, so such a total is kept as written and
 * logged, and corrected only once checked (`TOTAL_CORRECTIONS`). Standards
 * over their lifts' sum are not logged: the conversion rules set a standard
 * total apart from its lifts (see the PDF's last page).
 */
function checkTotal(r: Parsed, identity: string, warnings: string[]) {
  const correction = TOTAL_CORRECTIONS.find(
    (c) => c.age_category === r.age_category && c.gender === r.gender && c.weight_class === r.weight_class && c.written === r.total_record,
  );
  if (correction) {
    warnings.push(`Corrected source total ${correction.written} to ${correction.total} (checked against results): ${identity}`);
    r.total_record = correction.total;
    return;
  }
  const { snatch_record: snatch, cj_record: cj, total_record: total } = r;
  if (!snatch || !cj || !total || total <= snatch + cj || r.total_by?.name === 'Standard') return;
  warnings.push(`Source total (${total}) is above snatch + clean & jerk (${snatch + cj}); kept as written: ${identity}`);
}
