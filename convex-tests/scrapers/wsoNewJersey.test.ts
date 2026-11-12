import { consolidateRecords, parseNewJerseyTab, splitDateLocation } from '../../convex/scrapers/parse/wso/newJersey';
import { itemAt } from '../../convex/lib/json';

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
    expect(records.map((r) => [r.gender, r.weightClass, r.snatchRecord, r.cjRecord, r.totalRecord])).toEqual([
      ['Women', '48', 60, 75, 135],
      ['Men', '60', 90, null, null],
      ['Women', '48+', null, null, null],
      ['Men', '60+', 100, null, null],
      ['Women', '48+', null, 80, null],
      ['Men', '60+', null, 130, 230],
    ]);
    expect(consolidateRecords(records).map((r) => [r.gender, r.weightClass, r.snatchRecord, r.cjRecord, r.totalRecord])).toEqual([
      ['Women', '48', 60, 75, 135],
      ['Men', '60', 90, null, null],
      ['Women', '48+', null, 80, null],
      ['Men', '60+', 100, 130, 230],
    ]);
  });

  it('splits the "Date/ Location" cell into a date and the meet', () => {
    expect(splitDateLocation('10/25/2025 NJ WSO Championships')).toEqual({ date: '10/25/2025', location: 'NJ WSO Championships' });
    expect(splitDateLocation('Tri-State In House Meet July 20, 2007')).toEqual({ date: 'July 20, 2007', location: 'Tri-State In House Meet' });
    expect(splitDateLocation('Moorestown Summer Classic, July 19, 2025')).toEqual({ date: 'July 19, 2025', location: 'Moorestown Summer Classic' });
    expect(splitDateLocation('Virus Weightlifting Series 2, Dallas, TX 8/28/2025')).toEqual({ date: '8/28/2025', location: 'Virus Weightlifting Series 2, Dallas, TX' });
    expect(splitDateLocation('Dog Days Open, Highland Park, NJ August 17, 2025')).toEqual({ date: 'August 17, 2025', location: 'Dog Days Open, Highland Park, NJ' });
    expect(splitDateLocation('Some Meet')).toEqual({ location: 'Some Meet' });
    expect(splitDateLocation('')).toEqual({});
  });

  it("gives each lift with a value the row's athlete, date and meet, and keeps the best value's holder when consolidating", () => {
    const csv = [
      row('rules', '', 'Athlete', 'Date/ Location', 'Snatch', 'C&J', 'Total', '', '', 'Athlete', 'Date/ Location', 'Snatch', 'C&J', 'Total'),
      row('', '48', 'Julie Carmody', '"Tri-State In House Meet July 20, 2007"', '36', '49', '85', '', '71', 'Justin Bongcaron', '"USAW National U23 Championships, June 24, 2025"', '90', '', ''),
      row('', '53', 'Vacant', '', '', '', '', '', '71', 'Joshua Williams', '10/25/2025 NJ WSO Championships', '', '124', '214'),
      row('', '58', '', '', '70', '', '', '', '71', 'Someone Lighter', '1/1/2024 Old Meet', '85', '124', '200'),
    ].join('\n');
    const records = parseNewJerseyTab(csv, 'New Jersey', 'Senior');
    const julie = { name: 'Julie Carmody', date: '2007-07-20', location: 'Tri-State In House Meet' };
    expect(records[0]).toMatchObject({ weightClass: '48', snatchBy: julie, cjBy: julie, totalBy: julie });
    expect(records[1]).toMatchObject({ weightClass: '71', snatchRecord: 90, cjRecord: null });
    expect(records[1]).not.toHaveProperty('cjBy');
    // A vacant class has no lifts, so no holders.
    expect(records[2]).toEqual({ wso: 'New Jersey', ageCategory: 'Senior', gender: 'Women', weightClass: '53', snatchRecord: null, cjRecord: null, totalRecord: null });
    // A value with no athlete written is a standard.
    expect(itemAt(records, 4).snatchBy).toEqual({ name: 'Standard' });

    const men71 = consolidateRecords(records).find((r) => r.gender === 'Men' && r.weightClass === '71');
    expect(men71).toEqual({
      wso: 'New Jersey',
      ageCategory: 'Senior',
      gender: 'Men',
      weightClass: '71',
      snatchRecord: 90,
      cjRecord: 124,
      totalRecord: 214,
      snatchBy: { name: 'Justin Bongcaron', date: '2025-06-24', location: 'USAW National U23 Championships' },
      // 124 tied: the first listed keeps it.
      cjBy: { name: 'Joshua Williams', date: '2025-10-25', location: 'NJ WSO Championships' },
      totalBy: { name: 'Joshua Williams', date: '2025-10-25', location: 'NJ WSO Championships' },
    });
  });
});
