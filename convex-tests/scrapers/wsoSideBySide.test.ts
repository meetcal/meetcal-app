import { carolinaLayout, floridaLayout, parseSideBySide } from '../../convex/scrapers/parse/wso/sideBySide';
import { itemAt } from '../../convex/lib/json';

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
    const tab = { wso: 'Florida', ageCategory: 'Masters 35' };
    expect(parseSideBySide(csv, 'Florida', floridaLayout('Masters 35'))).toEqual([
      { ...tab, gender: 'Men', weightClass: '60', snatchRecord: 100, cjRecord: 120, totalRecord: 220, snatchBy: standard, cjBy: standard, totalBy: standard },
      { ...tab, gender: 'Women', weightClass: '48', snatchRecord: 70, cjRecord: null, totalRecord: 150, snatchBy: standard, totalBy: standard },
      { ...tab, gender: 'Men', weightClass: '60+', snatchRecord: 130, cjRecord: 160, totalRecord: 290, snatchBy: standard, cjBy: standard, totalBy: standard },
      { ...tab, gender: 'Women', weightClass: '48+', snatchRecord: null, cjRecord: null, totalRecord: null },
    ]);
  });

  it('reads who set each Florida lift from the athlete and date beside it', () => {
    const csv = [
      row('U13 Youth State Records'),
      row('44', 'Snatch', '42', 'STANDARD', '6/1/25', '', '40', 'Snatch', '52', 'Annalee Seek', '6/28/26'),
      row('', 'Clean and Jerk', '0', 'STANDARD', '6/1/25', '', '', 'Clean & Jerk', '60', 'Annalee Seek', '6/28/26'),
      row('', 'Total', '97', 'STANDARD', '6/1/25', '', '', 'Total', '112', 'Annalee Seek', ''),
    ].join('\n');
    const florida = parseSideBySide(csv, 'Florida', floridaLayout('U13'));
    const [men, women] = [itemAt(florida, 0), itemAt(florida, 1)];
    expect(men.snatchBy).toEqual({ name: 'Standard', date: '2025-06-01' });
    expect(men).not.toHaveProperty('cjBy');
    expect(women).toMatchObject({
      snatchRecord: 52,
      snatchBy: { name: 'Annalee Seek', date: '2026-06-28' },
      cjBy: { name: 'Annalee Seek', date: '2026-06-28' },
      totalBy: { name: 'Annalee Seek' },
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
      ageCategory: 'U13',
      gender: 'Men',
      weightClass: '48',
      snatchRecord: 42,
      cjRecord: null,
      totalRecord: 90,
      snatchBy: { name: 'Standard' },
      totalBy: { name: 'Standard' },
    });
    const isla = { name: 'Isla Dominguez', date: '2025-09-24', location: 'Cary, NC' };
    expect(women).toMatchObject({ snatchRecord: 38, cjRecord: 50, totalRecord: 88, snatchBy: isla, cjBy: isla, totalBy: isla });
  });

  it('moves to the next Carolina age group at each repeated header row', () => {
    const header = row('', 'Lift', '', '', '', '', '', '', '', 'Lift');
    const snatch = (men: string, women: string) => row(men, 'Snatch', '1', '', '', '', '', '', women, 'Snatch', '2');
    const csv = [header, '', '', '', '', '', snatch('36', '30'), header, snatch('40', '33')].join('\n');
    const ages = parseSideBySide(csv, 'Carolina', carolinaLayout('Youth')).map((r) => [r.ageCategory, r.gender, r.weightClass, r.snatchRecord]);
    expect(ages).toEqual([
      ['U13', 'Men', '36', 1],
      ['U13', 'Women', '30', 2],
      ['U15', 'Men', '40', 1],
      ['U15', 'Women', '33', 2],
    ]);
    expect(carolinaLayout('Masters').ageFor(12)).toBe('Masters 75');
  });
});
