import { consolidateRecords, parseNewJerseyTab, splitDateLocation } from '../../convex/scrapers/parse/wso/newJersey';

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
    expect(records[0]).toMatchObject({ weight_class: '48', snatch_by: julie, cj_by: julie, total_by: julie });
    expect(records[1]).toMatchObject({ weight_class: '71', snatch_record: 90, cj_record: null });
    expect(records[1]).not.toHaveProperty('cj_by');
    // A vacant class has no lifts, so no holders.
    expect(records[2]).toEqual({ wso: 'New Jersey', age_category: 'Senior', gender: 'Women', weight_class: '53', snatch_record: null, cj_record: null, total_record: null });
    // A value with no athlete written is a standard.
    expect(records[4].snatch_by).toEqual({ name: 'Standard' });

    const men71 = consolidateRecords(records).find((r) => r.gender === 'Men' && r.weight_class === '71');
    expect(men71).toEqual({
      wso: 'New Jersey',
      age_category: 'Senior',
      gender: 'Men',
      weight_class: '71',
      snatch_record: 90,
      cj_record: 124,
      total_record: 214,
      snatch_by: { name: 'Justin Bongcaron', date: '2025-06-24', location: 'USAW National U23 Championships' },
      // 124 tied: the first listed keeps it.
      cj_by: { name: 'Joshua Williams', date: '2025-10-25', location: 'NJ WSO Championships' },
      total_by: { name: 'Joshua Williams', date: '2025-10-25', location: 'NJ WSO Championships' },
    });
  });
});
