import { consolidateRecords, parseNewJerseyTab } from '../../convex/scrapers/parse/wso/newJersey';

const row = (...cells: string[]) => cells.concat(Array(14).fill('')).slice(0, 14).join(',');

describe('New Jersey WSO sheet (port of scraper_newjersey.py)', () => {
  it('reads one row per class, women left and men right, 0 as no record and a blank class as the open one', () => {
    const csv = [
      row('rules', '', 'Athlete', 'Date', 'Snatch', 'C&J', 'Total', '', '', 'Athlete', 'Date', 'Snatch', 'C&J', 'Total'),
      row('', '48', 'A', '', '60', '75', '135', '', '60', 'B', '', '90', '0', ''),
      row('', '', 'Vacant', '', '', '', '', '', '', 'C', '', '100', '', ''),
      row('', '', 'D', '', '', '80', '', '', '', 'E', '', '', '130', '230'),
      'short,row',
    ].join('\n');
    const records = parseNewJerseyTab(csv, 'New Jersey', 'Masters 35');
    expect(records.map((r) => [r.gender, r.weight_class, r.snatch_record, r.cj_record, r.total_record])).toEqual([
      ['Women', '48', 60, 75, 135],
      ['Men', '60', 90, null, null],
      ['Women', '48+', null, null, null],
      ['Men', '60+', 100, null, null],
      ['Women', '48+', null, 80, null],
      ['Men', '60+', null, 130, 230],
    ]);
    expect(consolidateRecords(records).map((r) => [r.gender, r.weight_class, r.snatch_record, r.cj_record, r.total_record])).toEqual([
      ['Women', '48', 60, 75, 135],
      ['Men', '60', 90, null, null],
      ['Women', '48+', null, 80, null],
      ['Men', '60+', 100, 130, 230],
    ]);
  });
});
