import { carolinaLayout, floridaLayout, parseSideBySide } from '../../convex/scrapers/parse/wso/sideBySide';

const row = (...cells: string[]) => cells.concat(Array(12).fill('')).slice(0, 12).join(',');

describe('side-by-side WSO sheets (ports of scraper_florida.py and scraper_carolinas.py)', () => {
  it('reads three-row classes on both sides, a blank class being the open one, 0 as no record in Florida', () => {
    const csv = [
      row('Men', '', '', '', '', '', 'Women'),
      row('60', 'Snatch', '100', '', '', '', '48', 'Snatch', '70'),
      row('', 'C&J', '120', '', '', '', '', 'C&J', '0'),
      row('', 'Total', '220', '', '', '', '', 'Total', '150'),
      row('', 'Snatch', '130', '', '', '', '', 'Snatch', ''),
      row('', 'C&J', '160'),
      row('', 'Total', '290'),
    ].join('\n');
    // No athlete written: every lift with a value is a standard.
    const standard = { name: 'Standard' };
    const tab = { wso: 'Florida', age_category: 'Masters 35' };
    expect(parseSideBySide(csv, 'Florida', floridaLayout('Masters 35'))).toEqual([
      { ...tab, gender: 'Men', weight_class: '60', snatch_record: 100, cj_record: 120, total_record: 220, snatch_by: standard, cj_by: standard, total_by: standard },
      { ...tab, gender: 'Women', weight_class: '48', snatch_record: 70, cj_record: null, total_record: 150, snatch_by: standard, total_by: standard },
      { ...tab, gender: 'Men', weight_class: '60+', snatch_record: 130, cj_record: 160, total_record: 290, snatch_by: standard, cj_by: standard, total_by: standard },
      { ...tab, gender: 'Women', weight_class: '48+', snatch_record: null, cj_record: null, total_record: null },
    ]);
  });

  it('reads who set each Florida lift from the athlete and date beside it', () => {
    const csv = [
      row('U13 Youth State Records'),
      row('44', 'Snatch', '42', 'STANDARD', '6/1/25', '', '40', 'Snatch', '52', 'Annalee Seek', '6/28/26'),
      row('', 'Clean and Jerk', '0', 'STANDARD', '6/1/25', '', '', 'Clean & Jerk', '60', 'Annalee Seek', '6/28/26'),
      row('', 'Total', '97', 'STANDARD', '6/1/25', '', '', 'Total', '112', 'Annalee Seek', ''),
    ].join('\n');
    const [men, women] = parseSideBySide(csv, 'Florida', floridaLayout('U13'));
    expect(men.snatch_by).toEqual({ name: 'Standard', date: '2025-06-01' });
    expect(men).not.toHaveProperty('cj_by');
    expect(women).toMatchObject({
      snatch_record: 52,
      snatch_by: { name: 'Annalee Seek', date: '2026-06-28' },
      cj_by: { name: 'Annalee Seek', date: '2026-06-28' },
      total_by: { name: 'Annalee Seek' },
    });
  });

  it('reads who set each Carolina lift from athlete, date and location, skipping the club', () => {
    const wide = (...cells: string[]) => cells.concat(Array(16).fill('')).slice(0, 16).join(',');
    const csv = [
      wide('Men', 'Lift', 'Weight', 'Athlete', 'Club', 'Date', 'Location', '', 'Women', 'Lift', 'Weight', 'Athlete', 'Club', 'Date', 'Location'),
      wide('48', 'Snatch', '42', 'WSO Standard', '', '', '', '', '44', 'Snatch', '38', 'Isla Dominguez', 'Shoofly Barbell', '9/24/25', '"Cary, NC"'),
      wide('', 'C & J', '', '', '', '', '', '', '', 'C & J', '50', 'Isla Dominguez', 'Shoofly Barbell', '9/24/25', '"Cary, NC"'),
      wide('', 'Total', '90', '', '', '', '', '', '', 'Total', '88', 'Isla Dominguez', 'Shoofly Barbell', '9/24/25', '"Cary, NC"'),
    ].join('\n');
    const [men, women] = parseSideBySide(csv, 'Carolina', carolinaLayout('Youth'));
    expect(men).toEqual({
      wso: 'Carolina',
      age_category: 'U13',
      gender: 'Men',
      weight_class: '48',
      snatch_record: 42,
      cj_record: null,
      total_record: 90,
      snatch_by: { name: 'Standard' },
      total_by: { name: 'Standard' },
    });
    const isla = { name: 'Isla Dominguez', date: '2025-09-24', location: 'Cary, NC' };
    expect(women).toMatchObject({ snatch_record: 38, cj_record: 50, total_record: 88, snatch_by: isla, cj_by: isla, total_by: isla });
  });

  it('moves to the next Carolina age group at each repeated header row', () => {
    const header = row('', 'Lift', '', '', '', '', '', '', '', 'Lift');
    const snatch = (men: string, women: string) => row(men, 'Snatch', '1', '', '', '', '', '', women, 'Snatch', '2');
    const csv = [header, '', '', '', '', '', snatch('36', '30'), header, snatch('40', '33')].join('\n');
    const ages = parseSideBySide(csv, 'Carolina', carolinaLayout('Youth')).map((r) => [r.age_category, r.gender, r.weight_class, r.snatch_record]);
    expect(ages).toEqual([
      ['U13', 'Men', '36', 1],
      ['U13', 'Women', '30', 2],
      ['U15', 'Men', '40', 1],
      ['U15', 'Women', '33', 2],
    ]);
    expect(carolinaLayout('Masters').ageFor(12)).toBe('Masters 75');
  });
});
