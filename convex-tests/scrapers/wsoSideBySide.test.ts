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
    expect(parseSideBySide(csv, 'Florida', floridaLayout('Masters 35'))).toEqual([
      { wso: 'Florida', age_category: 'Masters 35', gender: 'Men', weight_class: '60', snatch_record: 100, cj_record: 120, total_record: 220 },
      { wso: 'Florida', age_category: 'Masters 35', gender: 'Women', weight_class: '48', snatch_record: 70, cj_record: null, total_record: 150 },
      { wso: 'Florida', age_category: 'Masters 35', gender: 'Men', weight_class: '60+', snatch_record: 130, cj_record: 160, total_record: 290 },
      { wso: 'Florida', age_category: 'Masters 35', gender: 'Women', weight_class: '48+', snatch_record: null, cj_record: null, total_record: null },
    ]);
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
