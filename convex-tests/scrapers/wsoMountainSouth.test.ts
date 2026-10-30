import type { PdfLine } from '../../convex/scrapers/lib/pdf';
import { mountainSouthPdfUrls, mountainSouthSection, parseMountainSouth } from '../../convex/scrapers/parse/wso/mountainSouth';

/** A line of positioned runs, `[x, text]` each, as the PDFs lay them out. */
function runs(...cells: [number, string][]): PdfLine {
  const list = cells.map(([x, text]) => ({ text, x, end: x + text.length * 5 }));
  return { text: list.map((r) => r.text).join(' '), runs: list };
}

// The headings are centred over their columns: a place's cells start at 339, an event's at 446.
const header = runs([44, 'CAT'], [88, 'LIFT'], [129, 'RECORD'], [207, 'ATHLETE'], [295, 'DATE'], [362, 'LOCATION'], [493, 'EVENT']);

/** A class line's runs, at the 17 October 2026 PDFs' positions. */
const line = (cls: string, lift: string, value: string, ...holder: string[]) =>
  runs([47, cls], [83, lift], [142, value], ...holder.map((text, i): [number, string] => [[177, 290, 339, 446][i], text]));

describe('Mountain South WSO PDFs (port of scraper_pdf_mountainsouth.py)', () => {
  it('reads section headers', () => {
    expect(mountainSouthSection('OPEN MEN')).toEqual(['Senior', 'Men']);
    expect(mountainSouthSection('JUNIOR WOMEN U20')).toEqual(['Junior', 'Women']);
    expect(mountainSouthSection('YOUTH MEN 16-17')).toEqual(['U17', 'Men']);
    expect(mountainSouthSection('YOUTH WOMEN 14-15')).toEqual(['U15', 'Women']);
    expect(mountainSouthSection('YOUTH MEN U13')).toEqual(['U13', 'Men']);
    // The under-11 sections are U11, as every other WSO stores them, not a "Youth" group.
    expect(mountainSouthSection('YOUTH WOMEN U11')).toEqual(['U11', 'Women']);
    expect(mountainSouthSection('MASTER WOMEN W35 (35-39)')).toEqual(['Masters 35', 'Women']);
    expect(mountainSouthSection('MASTER MEN M80 (80+)')).toEqual(['Masters 80', 'Men']);
    expect(mountainSouthSection('MOUNTAIN SOUTH WSO RECORDS')).toBeNull();
    expect(mountainSouthSection('CAT LIFT RECORD ATHLETE DATE LOCATION EVENT')).toBeNull();
  });

  it('reads a line per lift into its class, a 0 being vacant, the age group running on across pages', () => {
    const pages = [
      [
        'MOUNTAIN SOUTH WSO RECORDS',
        'Beginning 8/1/2026 through 10/17/2026',
        'CAT LIFT RECORD ATHLETE DATE LOCATION EVENT',
        'MASTER MEN M35 (35-39)',
        '60 Snatch 75 FUNG, Kisente 4/11/26 Salt Lake City, UT',
        '60 Clean & Jerk 100 FUNG, Kisente 4/11/26 Salt Lake City, UT',
        '60 Total 175 FUNG, Kisente 4/11/26 Salt Lake City, UT',
        '110+ Snatch 0 STANDARD 8/1/26',
        'Page 1 of 2',
      ],
      ['110+ Clean & Jerk 0 STANDARD 8/1/26', '110+ Total 0 STANDARD 8/1/26', 'OPEN MEN', '60 Total 178 MCALLISTER, Ashton 6/22/25 Colorado Springs, CO 2025 Youth Nationals'],
    ];
    const records = parseMountainSouth(pages, 'Mountain South');
    expect(records.map((r) => [r.age_category, r.gender, r.weight_class, r.snatch_record, r.cj_record, r.total_record])).toEqual([
      ['Masters 35', 'Men', '60', 75, 100, 175],
      ['Masters 35', 'Men', '110+', null, null, null],
      ['Senior', 'Men', '60', null, null, 178],
    ]);
    expect(records[0].snatch_by).toEqual({ name: 'FUNG, Kisente', date: '2026-04-11', location: 'Salt Lake City, UT' });
    expect(records[1]).not.toHaveProperty('snatch_by');
    // Text alone cannot tell the place from the event, so they stay together.
    expect(records[2].total_by).toEqual({ name: 'MCALLISTER, Ashton', date: '2025-06-22', location: 'Colorado Springs, CO 2025 Youth Nationals' });
  });

  it('fails on a value it cannot read, and on a line in the layout before October 2026', () => {
    expect(() => parseMountainSouth([['OPEN WOMEN', '60 Snatch 88* DOE, Jane 3/3/22 Mesa, AZ Meet']], 'Mountain South')).toThrow('unreadable lift value "88*"');
    expect(() => parseMountainSouth([['OPEN WOMEN - SNATCH', '60 Maria De La Cruz AZ 88 3/3/22 Meet']], 'Mountain South')).toThrow(
      'Mountain South: unreadable class line "60 Maria De La Cruz AZ 88 3/3/22 Meet" (layout changed?)',
    );
    // Lines before the first section (none in the PDFs) are not records.
    expect(parseMountainSouth([['60 Snatch 88 DOE, Jane 3/3/22']], 'Mountain South')).toEqual([]);
  });

  it('reads "Clean&Jerk" without its spaces, and skips page numbers, dates and notes', () => {
    const pages = [
      [
        'OPEN WOMEN',
        '60 Clean&Jerk 100 DOE, Jane 4/11/26 Mesa, AZ',
        '2',
        '10/17/2026',
        'Records for MEN and WOMEN must be set at OPEN sanctioned meets',
        '60 Total 180 DOE, Jane 4/11/26 Mesa, AZ',
      ],
    ];
    const [record, ...rest] = parseMountainSouth(pages, 'Mountain South');
    expect(rest).toEqual([]);
    expect(record).toMatchObject({ age_category: 'Senior', gender: 'Women', cj_record: 100, total_record: 180, cj_by: { name: 'DOE, Jane', date: '2026-04-11', location: 'Mesa, AZ' } });
    expect(record).not.toHaveProperty('undefined');
  });

  it('reads a class written plus first, and fails on an age group heading it cannot read', () => {
    expect(parseMountainSouth([['OPEN MEN', '+110 Snatch 180 WITTE, Keiser 6/28/26 Colorado Springs, CO']], 'Mountain South')).toMatchObject([{ weight_class: '110+', snatch_record: 180 }]);
    // A heading without its range would otherwise file its lines over the group before it.
    expect(() => parseMountainSouth([['JUNIOR WOMEN U20', '58 Snatch 80 A, B 1/1/26', 'MASTER WOMEN W35', '58 Snatch 60 C, D 1/1/26']], 'Mountain South')).toThrow(
      'Mountain South: unreadable age group heading "MASTER WOMEN W35" (layout changed?)',
    );
    // Headings are upper case; prose that starts the same way is not one.
    expect(parseMountainSouth([['OPEN WOMEN', "Open men's records must be set at sanctioned meets", '58 Snatch 80 A, B 1/1/26']], 'Mountain South')).toMatchObject([{ gender: 'Women' }]);
  });

  it('reads the holder from the text when the runs disagree with it on the record', () => {
    // The lift and the record drawn as one run.
    const glued = { ...runs([47, '60'], [83, 'Snatch77'], [177, 'MCALLISTER, Ashton'], [290, '6/22/25'], [339, 'Mesa, AZ']), text: '60 Snatch 77 MCALLISTER, Ashton 6/22/25 Mesa, AZ' };
    expect(parseMountainSouth([[header, runs([275, 'OPEN MEN']), glued]], 'Mountain South')[0].snatch_by).toEqual({ name: 'MCALLISTER, Ashton', date: '2025-06-22', location: 'Mesa, AZ' });
  });

  it('keeps the columns when a heading line lacks LOCATION and EVENT', () => {
    const pages = [[header, runs([275, 'OPEN MEN']), runs([44, 'CAT'], [88, 'LIFT'], [129, 'RECORD']), line('65', 'Snatch', '97', 'MCALLISTER, Ashton', '10/17/26', 'Mesa, AZ', '2026 AZ Championship')]];
    expect(parseMountainSouth(pages, 'Mountain South')[0].snatch_by).toMatchObject({ location: '2026 AZ Championship, Mesa, AZ' });
  });

  it('reads holders from positioned runs, the place and the event split by their columns', () => {
    const pages = [
      [
        header,
        runs([275, 'OPEN MEN']),
        line('65', 'Snatch', '97', 'MCALLISTER, Ashton', '10/17/26', 'Mesa, AZ', '2026 AZ Championship'),
        runs([47, '65'], [72, 'Clean & Jerk'], [139, '120'], [177, 'HO, Brandon'], [288, '10/18/25'], [339, 'Albuquerque, NM'], [446, '2025 WSO Championship']),
        // A lift with only a place.
        line('65', 'Total', '217', 'MCALLISTER, Ashton', '10/17/26', 'Salt Lake City, UT'),
        line('70', 'Snatch', '0', 'STANDARD', '8/1/26'),
      ],
      // The next page prints no headings: the section and its columns carry on.
      [
        // "Clean & Jerk" drawn in runs so tight the text reads "Clean&Jerk".
        { ...runs([47, '75'], [72, 'Clean'], [96, '&'], [102, 'Jerk'], [139, '152'], [177, 'PAK, Elijah'], [290, '9/12/26'], [339, 'Fort Worth, TX'], [446, '2026 VW Series 2']), text: '75 Clean&Jerk 152 PAK, Elijah 9/12/26 Fort Worth, TX 2026 VW Series 2' },
        // A blank event cell.
        line('75', 'Total', '272', 'PAK, Elijah', '9/12/26', 'Fort Worth, TX', '#N/A'),
      ],
    ];
    const records = parseMountainSouth(pages, 'Mountain South');
    expect(records.map((r) => [r.age_category, r.weight_class, r.snatch_record, r.cj_record, r.total_record])).toEqual([
      ['Senior', '65', 97, 120, 217],
      ['Senior', '70', null, null, null],
      ['Senior', '75', null, 152, 272],
    ]);
    expect(records[2]).toMatchObject({
      cj_by: { name: 'PAK, Elijah', date: '2026-09-12', location: '2026 VW Series 2, Fort Worth, TX' },
      total_by: { name: 'PAK, Elijah', date: '2026-09-12', location: 'Fort Worth, TX' },
    });
    expect(records[0]).toMatchObject({
      snatch_by: { name: 'MCALLISTER, Ashton', date: '2026-10-17', location: '2026 AZ Championship, Mesa, AZ' },
      cj_by: { name: 'HO, Brandon', date: '2025-10-18', location: '2025 WSO Championship, Albuquerque, NM' },
      total_by: { name: 'MCALLISTER, Ashton', date: '2026-10-17', location: 'Salt Lake City, UT' },
    });
    expect(records[1]).not.toHaveProperty('snatch_by');
  });

  it('finds the current PDFs, not the archived ones or certificates', () => {
    const html = [
      '<h2>MOUNTAIN SOUTH WSO RECORDS</h2>',
      '<a href="https://mountainsouth.org/wp-content/uploads/2026/07/Mountain-South-WSO-Records-Certificate.pdf">Certificate</a>',
      '<a href="https://mountainsouth.org/wp-content/uploads/2026/07/Mountain-South-WSO-Records-2026-08-01-MEN.pdf">Men</a>',
      '<a href="https://mountainsouth.org/wp-content/uploads/2026/07/Mountain-South-WSO-Records-2026-08-01-WOMEN.pdf">Women</a>',
      '<h2>ARCHIVED MOUNTAIN SOUTH WSO RECORDS</h2>',
      '<a href="https://mountainsouth.org/wp-content/uploads/2024/01/Mountain-South-WSO-Records-2024-MEN.pdf">Men</a>',
    ].join('');
    expect(mountainSouthPdfUrls(html)).toEqual([
      'https://mountainsouth.org/wp-content/uploads/2026/07/Mountain-South-WSO-Records-2026-08-01-MEN.pdf',
      'https://mountainsouth.org/wp-content/uploads/2026/07/Mountain-South-WSO-Records-2026-08-01-WOMEN.pdf',
    ]);
  });
});
