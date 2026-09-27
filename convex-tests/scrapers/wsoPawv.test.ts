import { parsePawvTab, pawvSection, pawvWeightClass } from '../../convex/scrapers/parse/wso/pawv';

const row = (...cells: string[]) => cells.concat(['', '', '', '']).slice(0, Math.max(cells.length, 5)).join(',');

describe('Pennsylvania-West Virginia WSO sheet (port of scraper_pawv.py)', () => {
  it('reads section headers and classes', () => {
    expect(pawvSection("Men's 13 Under Age Group", 'Youth')).toBe('U13');
    expect(pawvSection("Women's 16-17 Age Group", 'Youth')).toBe('U17');
    expect(pawvSection("Women's Masters (40-44)", 'Masters')).toBe('Masters 40');
    expect(pawvSection("Junior Men's", 'Junior')).toBe('Junior');
    expect(pawvSection('Something else', 'Youth')).toBeNull();
    expect(pawvWeightClass('+65kg')).toBe('65+');
    expect(pawvWeightClass('40kg')).toBe('40');
  });

  it("saves each section's last class before the next section starts", () => {
    const csv = [
      row("Men's 13 Under Age Group"),
      row('40kg'),
      row('Snatch', 'A', 'x', '30'),
      row('Total', 'A', 'x', 'STANDARD'),
      row('+40kg'),
      row('Total', 'B', 'x', '90'),
      row("Men's 14-15 Age Group"),
      row('44kg'),
      row('Clean & Jerk', 'C', 'x', '70.5'),
    ].join('\n');
    expect(parsePawvTab(csv, 'PA-WV', { gid: '1', gender: 'Men', base: 'Youth' }).map((r) => [r.age_category, r.weight_class, r.snatch_record, r.cj_record, r.total_record])).toEqual([
      ['U13', '40', 30, null, null],
      ['U13', '40+', null, null, 90],
      ['U15', '44', null, 70, null],
    ]);
  });

  it('names who holds each lift from the Name, Date, Meet and Location columns, STANDARD as Standard', () => {
    const csv = [
      'Lift,Name,Team,Weight,Date,Meet,Location',
      'Open Men\'s,,,,,,',
      '65kg,,,,,,',
      'Snatch,Luke Sterns,,106,2026-06-23,2026 Junior National Championships,"Colorado Springs, CO"',
      'Clean & Jerk,STANDARD,,125,2025-06-01,,',
      'Total,,,STANDARD,,,',
    ].join('\n');
    const [record] = parsePawvTab(csv, 'PA-WV', { gid: '1', gender: 'Men', base: 'Senior' });
    expect(record).toEqual({
      wso: 'PA-WV',
      age_category: 'Senior',
      gender: 'Men',
      weight_class: '65',
      snatch_record: 106,
      cj_record: 125,
      total_record: null,
      snatch_by: { name: 'Luke Sterns', date: '2026-06-23', location: '2026 Junior National Championships, Colorado Springs, CO' },
      cj_by: { name: 'Standard', date: '2025-06-01' },
    });
  });
});
