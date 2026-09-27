import { findStandardsPdfUrl, normalizeWeightClass, parseStandards } from '../../convex/scrapers/parse/standards';

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
  it('pairs A and B totals per class, U15 as A only, later pages overriding', () => {
    expect(parseStandards([PAGE_1, PAGE_3])).toEqual([
      { age_category: 'Senior', gender: 'Women', weight_class: '48kg', standard_a: 181, standard_b: 172 },
      { age_category: 'Senior', gender: 'Women', weight_class: '53kg', standard_a: 200, standard_b: 189 },
      { age_category: 'Senior', gender: 'Women', weight_class: '+86kg', standard_a: 263, standard_b: 250 },
      { age_category: 'U15', gender: 'Women', weight_class: '44kg', standard_a: 113, standard_b: 0 },
      { age_category: 'U15', gender: 'Women', weight_class: '48kg', standard_a: 127, standard_b: 0 },
      { age_category: 'Senior', gender: 'Women', weight_class: '49kg', standard_a: 185, standard_b: 0 },
    ]);
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
