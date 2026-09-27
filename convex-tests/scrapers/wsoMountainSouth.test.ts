import type { PdfLine } from '../../convex/scrapers/lib/pdf';
import { mountainSouthPdfUrls, mountainSouthSection, parseMountainSouth } from '../../convex/scrapers/parse/wso/mountainSouth';

/** A line of positioned runs, `[x, text]` each, as the PDFs lay them out. */
function runs(...cells: [number, string][]): PdfLine {
  const list = cells.map(([x, text]) => ({ text, x, end: x + text.length * 5 }));
  return { text: list.map((r) => r.text).join(' '), runs: list };
}

const header = runs([26, 'CAT'], [57, 'ATHLETE'], [197, 'STATE'], [248, 'KG'], [289, 'DATE'], [332, 'EVENT'], [466, 'LOCATION']);

describe('Mountain South WSO PDFs (port of scraper_pdf_mountainsouth.py)', () => {
  it('reads section headers', () => {
    expect(mountainSouthSection('OPEN MEN - SNATCH')).toEqual(['Senior', 'Men']);
    expect(mountainSouthSection('JUNIOR WOMEN U20 - TOTAL')).toEqual(['Junior', 'Women']);
    expect(mountainSouthSection('YOUTH MEN U15 - CLEAN & JERK')).toEqual(['U15', 'Men']);
    expect(mountainSouthSection('YOUTH MEN - SNATCH')).toEqual(['Youth', 'Men']);
    expect(mountainSouthSection('MASTERS WOMEN 35-39 - SNATCH')).toEqual(['Masters 35', 'Women']);
  });

  it('takes the first positive number after the class, a bare class being vacant', () => {
    const pages = [
      [
        'MASTERS MEN 35-39 - SNATCH',
        'CAT ATHLETE STATE KG DATE EVENT LOCATION',
        '60 Jane Doe AZ 88 3/3/22 NAO Series 1 Columbus, OH',
        '65',
        '+110 A B NM 0 1/1/25 x',
        'MASTERS MEN 35-39 - TOTAL',
        '60 Jane Doe AZ 198 3/3/22 Meet',
      ],
      ['MASTERS MEN 35-39 - CLEAN & JERK', '60 Jane Doe AZ 110 3/3/22 Meet'],
    ];
    expect(parseMountainSouth(pages, 'Mountain South').map((r) => [r.age_category, r.weight_class, r.snatch_record, r.cj_record, r.total_record])).toEqual([
      ['Masters 35', '60', 88, 110, 198],
      ['Masters 35', '65', null, null, null],
      ['Masters 35', '110+', null, null, null],
    ]);
  });

  it('reads holders from positioned runs: name columns, event and place split by the LOCATION column', () => {
    const pages = [
      [
        header,
        runs([233, 'MASTERS MEN 45-49 - SNATCH']),
        // The first name runs into the last-name column, so the text reads "Jean-JacquesCabou".
        { ...runs([30, '65'], [57, 'Jean-Jacques'], [125, 'Cabou'], [207, 'AZ'], [249, '88'], [287, '3/3/22'], [332, 'NAO Series 1'], [466, 'Columbus, OH']), text: '65 Jean-JacquesCabou AZ 88 3/3/22 NAO Series 1 Columbus, OH' },
        runs([30, '70'], [57, '0'], [125, '0'], [207, '0'], [249, '0'], [287, '#N/A'], [332, '#N/A'], [466, '#N/A']),
        runs([30, '75']),
        runs([30, '85'], [57, 'STANDARD'], [207, 'AZ'], [249, '120'], [287, '-'], [332, '-'], [466, '-']),
        runs([233, 'MASTERS MEN 45-49 - TOTAL']),
        runs([30, '65'], [57, 'Jean-Jacques'], [125, 'Cabou'], [207, 'AZ'], [246, '198'], [280, '10/18/25 WSO Championship'], [466, 'Salt Lake City, UT']),
      ],
    ];
    const records = parseMountainSouth(pages, 'Mountain South');
    expect(records.map((r) => [r.weight_class, r.snatch_record, r.total_record])).toEqual([
      ['65', 88, 198],
      ['70', null, null],
      ['75', null, null],
      ['85', 120, null],
    ]);
    expect(records[0]).toMatchObject({
      snatch_by: { name: 'Jean-Jacques Cabou', date: '2022-03-03', location: 'NAO Series 1, Columbus, OH' },
      total_by: { name: 'Jean-Jacques Cabou', date: '2025-10-18', location: 'WSO Championship, Salt Lake City, UT' },
    });
    expect(records[0]).not.toHaveProperty('cj_by');
    expect(records[1]).not.toHaveProperty('snatch_by');
    expect(records[2]).not.toHaveProperty('snatch_by');
    expect(records[3].snatch_by).toEqual({ name: 'Standard' });
  });

  it('reads holders from text lines too, the place then carrying the event', () => {
    const [record] = parseMountainSouth([['OPEN MEN - SNATCH', '60 Ashton McAllister AZ 77 6/22/25 Youth Nationals Colorado Springs, CO']], 'Mountain South');
    expect(record).toMatchObject({ snatch_record: 77, snatch_by: { name: 'Ashton McAllister', date: '2025-06-22', location: 'Youth Nationals Colorado Springs, CO' } });
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
