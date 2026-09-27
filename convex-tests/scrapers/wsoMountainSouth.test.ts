import { mountainSouthPdfUrls, mountainSouthSection, parseMountainSouth } from '../../convex/scrapers/parse/wso/mountainSouth';

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
