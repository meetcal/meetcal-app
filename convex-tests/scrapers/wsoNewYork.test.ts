import { newYorkPdfUrls, newYorkSection, parseNewYork } from '../../convex/scrapers/parse/wso/newYork';
import { itemAt } from '../../convex/lib/json';

describe('New York WSO PDFs (port of scraper_pdf_newyork.py)', () => {
  it('reads section headings', () => {
    expect(newYorkSection('Youth Men')).toEqual(['Youth', 'Men']);
    expect(newYorkSection('Open Women')).toEqual(['Senior', 'Women']);
    expect(newYorkSection('Masters Women: 35-39')).toEqual(['Masters 35', 'Women']);
    expect(newYorkSection('New York State Records')).toBeNull();
  });

  it('reads three-line classes with the class on the middle line, 0 or no value as no record', () => {
    const page = [
      'New York State Records',
      'Masters Men: 80-84',
      'Wt. Class Lift Record Name Date Event',
      'Snatch 46 kg Record Standard - -',
      '55 Clean and Jerk 57 kg Record Standard - -',
      'Total 103 kg Record Standard - -',
      'Snatch 0 kg - - -',
      '110+ Clean and Jerk - - -',
      'Total 120.5 kg A Lifter 9/28/2025 Some Open',
    ];
    expect(parseNewYork([page, ['Youth Women', 'Snatch 33 kg x', '45 Clean and Jerk 39 kg x', 'Total 72 kg x']], 'New York').map((r) => [r.ageCategory, r.gender, r.weightClass, r.snatchRecord, r.cjRecord, r.totalRecord])).toEqual([
      ['Masters 80', 'Men', '55', 46, 57, 103],
      ['Masters 80', 'Men', '110+', null, null, 120],
      ['Youth', 'Women', '45', 33, 39, 72],
    ]);
  });

  it('reads who set each lift: the date separates name from event, "Record Standard" is Standard', () => {
    const page = [
      'Youth Men',
      'Snatch 77 kg Caden Vanderhoof 9/28/2025 NYS Championships',
      '65 Clean and Jerk 87 kg Aaron Li 5/2/2026 Hudson Valley Regional Open',
      'Total 163 kg Record Standard - -',
      'Snatch 0 kg - - -',
      '70 Clean and Jerk - - -',
      'Total 300 kg Jean Laguerre Jr. 8/31/2025 Virus Weightlifting Series II',
    ];
    const records = parseNewYork([page], 'New York');
    const [first, second] = [itemAt(records, 0), itemAt(records, 1)];
    expect(first).toMatchObject({
      weightClass: '65',
      snatchRecord: 77,
      snatchBy: { name: 'Caden Vanderhoof', date: '2025-09-28', location: 'NYS Championships' },
      cjBy: { name: 'Aaron Li', date: '2026-05-02', location: 'Hudson Valley Regional Open' },
    });
    expect(first.totalBy).toEqual({ name: 'Standard' });
    expect(second).toMatchObject({ weightClass: '70', snatchRecord: null, cjRecord: null, totalBy: { name: 'Jean Laguerre Jr.', date: '2025-08-31', location: 'Virus Weightlifting Series II' } });
    expect(second).not.toHaveProperty('snatchBy');
    expect(second).not.toHaveProperty('cjBy');
  });

  it('takes the Current Records PDFs, not the State Meet Records ones', () => {
    const pdf = (id: string) => `<a href="https://www.nywso.com/_files/ugd/aba8a0_${id}.pdf">x</a>`;
    const html = `<h2>Current Records</h2>Youth ${pdf('a')} Junior ${pdf('b')} Senior ${pdf('c')} Masters Men ${pdf('d')} Masters Women ${pdf('e')}<h2>State Meet Records</h2>${pdf('f')}`;
    expect(newYorkPdfUrls(html).map((u) => u.slice(-6))).toEqual(['_a.pdf', '_b.pdf', '_c.pdf', '_d.pdf', '_e.pdf']);
  });
});
