import { parseOhioTab } from '../../convex/scrapers/parse/wso/ohio';

const row = (...cells: string[]) => cells.map((c) => `"${c}"`).join(',');

describe('Ohio WSO sheet (port of scraper_ohio.py)', () => {
  it('reads the merged title, class rows and lift rows, the weight in column D', () => {
    const csv = [
      row('Ohio WSO Weightlifting Records (Updated 9/17/2026) Lift 13 and Under 30 kg Snatch Clean & Jerk Total 33 kg', 'Athlete'),
      row('Snatch', 'A', 'T', '18'),
      row('Clean & Jerk', 'A', 'T', '19.5'),
      row('Total', 'A', 'T', '37'),
      row('Lift', 'Athlete'),
      row('33 kg', 'x'),
      row('Snatch', 'B', 'T', ''),
      row('Total', 'B', 'T', '40'),
      row('14-15', ''),
      row('36 kg', 'x'),
      row('Snatch', 'C', 'T', '30'),
      row('Total', 'C', 'T', '70'),
      row('13 and Under', ''),
      row('30 kg', 'x'),
      row('Total', 'D', 'T', '99'),
    ].join('\n');
    expect(parseOhioTab(csv, 'Ohio', 'Youth Women').map((r) => [r.age_category, r.weight_class, r.snatch_record, r.cj_record, r.total_record])).toEqual([
      ['U13', '30', 18, 19, 37],
      ['U13', '33', null, null, 40],
      ['U15', '36', 30, null, 70],
    ]);
  });

  it('uses the lower bound on Masters tabs and the tab name for Junior and Senior', () => {
    const masters = [row('Title Lift 35 - 39 60 kg', 'Athlete'), row('Total', '', '', '200'), row('40 - 44', ''), row('60 kg', ''), row('Total', '', '', '190')].join('\n');
    expect(parseOhioTab(masters, 'Ohio', 'Masters Men').map((r) => [r.age_category, r.gender, r.weight_class, r.total_record])).toEqual([
      ['Masters 35', 'Men', '60', 200],
      ['Masters 40', 'Men', '60', 190],
    ]);
    const senior = [row('Title Lift 49 kg', 'Athlete'), row('Total', '', '', '150')].join('\n');
    expect(parseOhioTab(senior, 'Ohio', 'Senior Women').map((r) => [r.age_category, r.weight_class, r.total_record])).toEqual([['Senior', '49', 150]]);
  });

  it('names who holds each lift: athlete, date, meet and location, or Standard', () => {
    const csv = [
      row('Title Lift 35 - 39 60 kg', 'Athlete ', 'Team ', 'Weight ', 'Date ', 'Meet ', 'Location '),
      row('Snatch', 'Derick Puff', 'Team Aita', '78', '8/16/2026', '2026 Ohio WSO Championships', 'Columbus, OH'),
      row('Clean & Jerk', '', '', '88', '8/1/2026', '', ''),
      row('Total', 'WSO Standard', '', '164', '8/1/2026', '', ''),
      row('65 kg', '', '', '', '', '', ''),
      row('Snatch', 'Standard', '', '74', '', '', ''),
      row('Clean & Jerk', '', '', '', '', '', ''),
      row('Total', '', '', '', '', '', ''),
    ].join('\n');
    const [first, second] = parseOhioTab(csv, 'Ohio', 'Masters Men');
    expect(first).toEqual({
      wso: 'Ohio',
      age_category: 'Masters 35',
      gender: 'Men',
      weight_class: '60',
      snatch_record: 78,
      cj_record: 88,
      total_record: 164,
      snatch_by: { name: 'Derick Puff', date: '2026-08-16', location: '2026 Ohio WSO Championships, Columbus, OH' },
      cj_by: { name: 'Standard', date: '2026-08-01' },
      total_by: { name: 'Standard', date: '2026-08-01' },
    });
    expect(second).toMatchObject({ weight_class: '65', snatch_record: 74, snatch_by: { name: 'Standard' }, cj_record: null, total_record: null });
    expect(second).not.toHaveProperty('cj_by');
    expect(second).not.toHaveProperty('total_by');
  });
});
