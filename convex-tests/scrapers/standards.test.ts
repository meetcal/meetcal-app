import { JOBS } from '../../convex/cronJobs';
import { usawToday } from '../../convex/scrapers/standards';
import { currentStandards, findStandardsPdfUrl, normalizeWeightClass, parseStandards, standardsPeriod } from '../../convex/scrapers/parse/standards';

// Lines as `pdfLines` reads the 2026 A & B Standards PDF (trimmed): a title,
// then per section a header, a `Category` line and a `Total` line.
const PAGE_1 = [
  "Women's A & B Standards for IWF Bodyweight Categories through July 31, 2026",
  "Senior Women's A Standards",
  'Category 48 53 86+',
  'Total 181 199 263',
  "Senior Women's B Standards",
  'Category 48 53 86+',
  'Total 172 189 250',
  "U15 Women's Standards",
  'Category 44 48',
  'Total 113 127',
];
const PAGE_3 = [
  "Women's A & B Standards for IWF Bodyweight Categories that take effect August 1, 2026",
  "Senior Women's A Standards",
  'Category 49 53',
  'Total 185 200',
];

describe('standards parser (port of usaw/standards_scraper)', () => {
  it('pairs A and B totals per class, U15 as A only, each half with its period (#408)', () => {
    const until = { validUntil: '2026-07-31' };
    const from = { validFrom: '2026-08-01' };
    expect(parseStandards([PAGE_1, PAGE_3])).toEqual([
      { age_category: 'Senior', gender: 'Women', weight_class: '48kg', standard_a: 181, standard_b: 172, ...until },
      { age_category: 'Senior', gender: 'Women', weight_class: '53kg', standard_a: 199, standard_b: 189, ...until },
      { age_category: 'Senior', gender: 'Women', weight_class: '+86kg', standard_a: 263, standard_b: 250, ...until },
      { age_category: 'U15', gender: 'Women', weight_class: '44kg', standard_a: 113, standard_b: 0, ...until },
      { age_category: 'U15', gender: 'Women', weight_class: '48kg', standard_a: 127, standard_b: 0, ...until },
      { age_category: 'Senior', gender: 'Women', weight_class: '49kg', standard_a: 185, standard_b: 0, ...from },
      // 53kg is in both halves: each keeps its own value.
      { age_category: 'Senior', gender: 'Women', weight_class: '53kg', standard_a: 200, standard_b: 0, ...from },
    ]);
  });

  it('keeps only the half in force, so retired classes are never listed beside current ones (#408)', () => {
    const parsed = parseStandards([PAGE_1, PAGE_3]);
    const classes = (today: string) => currentStandards(parsed, today).map((s) => `${s.weight_class} ${s.standard_a}`);
    expect(classes('2026-10-12')).toEqual(['49kg 185', '53kg 200']);
    expect(classes('2026-07-31')).toEqual(['48kg 181', '53kg 199', '+86kg 263', '44kg 113', '48kg 127']);
    // A PDF that names no period is always in force.
    expect(currentStandards(parseStandards([PAGE_1.slice(1)]), '2030-01-01')).toHaveLength(5);
    // Two values for one class on one day is a PDF the parser misread.
    expect(() => currentStandards([...parsed, { ...parsed[5], standard_a: 1 }], '2026-10-12')).toThrow('two standards in force');
  });

  it("switches on USA Weightlifting's date, not UTC's", () => {
    // 03:15 UTC on Aug 1 (the cron's time) is still July 31 in Colorado Springs.
    expect(usawToday(new Date('2027-08-01T03:15:00Z'))).toBe('2027-07-31');
    expect(usawToday(new Date('2027-08-01T07:00:00Z'))).toBe('2027-08-01');
  });

  it('runs after midnight in Colorado Springs, so a set taking effect that day is stored the same day', () => {
    const [minute, hour] = JOBS.standards.schedule.split(' ').map(Number);
    const at = (day: string) => new Date(`${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`);
    // Daylight time (August) and standard time (January).
    expect(usawToday(at('2026-08-01'))).toBe('2026-08-01');
    expect(usawToday(at('2027-01-01'))).toBe('2027-01-01');
  });

  it('reads the period a half names', () => {
    expect(standardsPeriod("Men's A & B Standards for IWF Bodyweight Categories that take effect on August 1, 2026")).toEqual({ validFrom: '2026-08-01' });
    expect(standardsPeriod("Women's A & B Standards for IWF Bodyweight Categories through July 31, 2026")).toEqual({ validUntil: '2026-07-31' });
    expect(standardsPeriod("Senior Women's A Standards")).toBeNull();
  });

  it('ignores Total lines before any section and values past the class list', () => {
    expect(parseStandards([['Total 1 2 3', "Junior Men's A Standards", 'Category 60', 'Total 253 999']])).toEqual([
      { age_category: 'Junior', gender: 'Men', weight_class: '60kg', standard_a: 253, standard_b: 0 },
    ]);
  });

  it('normalizes weight classes like the Python scraper', () => {
    expect(normalizeWeightClass('58')).toBe('58kg');
    expect(normalizeWeightClass('86+')).toBe('+86kg');
    expect(normalizeWeightClass('+110kg')).toBe('+110kg');
    expect(normalizeWeightClass('63.5')).toBe('63.5kg');
    expect(normalizeWeightClass('Category')).toBeNull();
    expect(normalizeWeightClass('')).toBeNull();
  });

  it('prefers a PDF link mentioning standards over a page link', () => {
    const html =
      '<a href="/standards-page">Standards overview</a><a href="https://cdn.example/2026_A_&amp;_B_Standards.pdf">2026 A &amp; B Standards</a>';
    expect(findStandardsPdfUrl(html, 'https://www.usaweightlifting.org/x')).toBe(
      'https://cdn.example/2026_A_&_B_Standards.pdf',
    );
    expect(findStandardsPdfUrl('<a href="/standards">Standards</a>', 'https://www.usaweightlifting.org/x')).toBe(
      'https://www.usaweightlifting.org/standards',
    );
    expect(findStandardsPdfUrl('<a href="/other">Other</a>', 'https://www.usaweightlifting.org/x')).toBeNull();
  });
});
