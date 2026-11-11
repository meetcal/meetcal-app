import { gidOf } from '../../convex/scrapers/parse/wso/common';
import { FLAT_COLUMNS, normalizeAgeGroup, parseFlatSheet } from '../../convex/scrapers/parse/wso/flat';

describe('flat WSO sheets (port of scraper_ga_pnw.py)', () => {
  it('normalizes age groups', () => {
    expect(normalizeAgeGroup('JR')).toBe('Junior');
    expect(normalizeAgeGroup('Open ADAP')).toBe('Senior ADAP');
    expect(normalizeAgeGroup('W65')).toBe('Masters 65');
    expect(normalizeAgeGroup('m40 ADAP')).toBe('Masters 40 ADAP');
    expect(normalizeAgeGroup('U15')).toBe('U15');
  });

  it('groups one-lift rows by age, gender and class, skipping adaptive, unknown lifts and bad rows', () => {
    const csv = [
      'ageGroup,gender,bodyWeightMin,bodyWeightMax,lift,record',
      'U11,F,,36,Snatch,16',
      'U11,F,,36,Clean & Jerk,20.5',
      'U11,F,,36,Total,35',
      'Open,M,110,,Total,300',
      'Open,M,,>110,Snatch,140',
      'Open ADAP,M,,60,Total,100',
      'W65,F,,63,Bench,50',
      ',F,,63,Total,1',
      'W65,X,,63,Total,1',
      'W65,F,,,Total,1',
      'W65,F,,63,Total,',
    ].join('\n');
    expect(parseFlatSheet(csv, 'Georgia')).toEqual([
      { wso: 'Georgia', ageCategory: 'U11', gender: 'Women', weightClass: '36', snatchRecord: 16, cjRecord: 20, totalRecord: 35 },
      { wso: 'Georgia', ageCategory: 'Senior', gender: 'Men', weightClass: '110+', snatchRecord: 140, cjRecord: null, totalRecord: 300 },
      { wso: 'Georgia', ageCategory: 'Masters 65', gender: 'Women', weightClass: '63', snatchRecord: null, cjRecord: null, totalRecord: null },
    ]);
  });

  // California North's hidden tab of the classes retired on 1 August 2026 ends every row then.
  it('skips rows whose endDate has passed, so a tab of retired records parses to nothing', () => {
    const csv = [
      'startDate,endDate,ageGroup,gender,bodyWeightMin,bodyWeightMax,lift,record',
      '2025-05-30,2026-08-01,Open,M,,65,Snatch,120',
      '2026-08-01,,Open,M,,70,Snatch,125',
      '2026-08-01,2026-10-12,Open,M,,75,Snatch,130',
    ].join('\n');
    const today = new Date('2026-10-12T12:00:00Z');
    expect(parseFlatSheet(csv, 'California North', FLAT_COLUMNS, today).map((r) => [r.weightClass, r.snatchRecord])).toEqual([
      ['70', 125],
      ['75', 130],
    ]);
    expect(parseFlatSheet(csv.split('\n').slice(0, 2).join('\n'), 'California North', FLAT_COLUMNS, today)).toEqual([]);
    // Before the change, the same rows still stood.
    expect(parseFlatSheet(csv, 'California North', FLAT_COLUMNS, new Date('2026-07-01T12:00:00Z'))).toHaveLength(3);
  });

  it('reads the tab a sheet URL points at', () => {
    expect(gidOf('https://docs.google.com/spreadsheets/d/abc/edit?gid=35344992#gid=35344992')).toBe('35344992');
    expect(gidOf('https://docs.google.com/spreadsheets/d/abc/edit#gid=0')).toBe('0');
    expect(gidOf('https://docs.google.com/spreadsheets/d/abc/edit?usp=sharing')).toBeNull();
  });

  it('reads California South from its "WSO record" column, the class being the upper bound', () => {
    const csv = [
      'ageGroup,gender,bodyWeightMin,bodyWeightMax,lift,American Record,WSO record',
      'U11,F,0,30,Snatch,22,15',
      'U11,F,0,30,Total,54,37',
      'U11,F,30,33,Snatch,40,28',
      'U11,F,30,33,Total,90,63',
      'U11,F,61,,Total,99,81',
    ].join('\n');
    expect(parseFlatSheet(csv, 'California South', { ...FLAT_COLUMNS, record: 'WSO record' })).toEqual([
      { wso: 'California South', ageCategory: 'U11', gender: 'Women', weightClass: '30', snatchRecord: 15, cjRecord: null, totalRecord: 37 },
      { wso: 'California South', ageCategory: 'U11', gender: 'Women', weightClass: '33', snatchRecord: 28, cjRecord: null, totalRecord: 63 },
      { wso: 'California South', ageCategory: 'U11', gender: 'Women', weightClass: '61+', snatchRecord: null, cjRecord: null, totalRecord: 81 },
    ]);
  });

  it('records who set each lift, "Standard" when unclaimed, the later row for a lift winning with its holder', () => {
    const csv = [
      'ageGroup,gender,bodyWeightMin,bodyWeightMax,lift,record,name,date,place',
      'U11,F,,36,Snatch,16,Hadley Tillman,2025-06-20,Youth Nationals 2025',
      'U11,F,,36,Clean & Jerk,20,STANDARD,6/1/2025,',
      'U11,F,,36,Total,35,,,',
      'U13,M,,40,Snatch,,Nobody,2025-06-20,Somewhere',
      'U13,M,,40,Total,50,First,2025-01-01,Meet A',
      'U13,M,,40,Total,55,"DOE, Jane",08-31-2025,Meet B',
    ].join('\n');
    const [u11, u13] = parseFlatSheet(csv, 'Georgia');
    expect(u11).toEqual({
      wso: 'Georgia',
      ageCategory: 'U11',
      gender: 'Women',
      weightClass: '36',
      snatchRecord: 16,
      cjRecord: 20,
      totalRecord: 35,
      snatchBy: { name: 'Hadley Tillman', date: '2025-06-20', location: 'Youth Nationals 2025' },
      cjBy: { name: 'Standard', date: '2025-06-01' },
      totalBy: { name: 'Standard' },
    });
    expect(u13).toEqual({
      wso: 'Georgia',
      ageCategory: 'U13',
      gender: 'Men',
      weightClass: '40',
      snatchRecord: null,
      cjRecord: null,
      totalRecord: 55,
      totalBy: { name: 'DOE, Jane', date: '2025-08-31', location: 'Meet B' },
    });
  });

  it('leaves holders out for a sheet without a name column', () => {
    const csv = ['ageGroup,gender,bodyWeightMin,bodyWeightMax,lift,record,date', 'U11,F,,36,Snatch,16,2025-06-20'].join('\n');
    expect(parseFlatSheet(csv, 'Georgia')[0]).not.toHaveProperty('snatchBy');
  });

  it('reads DMV holders from Name, Date and Event, ignoring Club', () => {
    const csv = [
      'Age Group,Gender,bodyWeightMin,Weight Class,Lift,Record,Name,Club,Date,Event',
      'U15,M,0,79,Snatch,82,"BANU, Jonathan",12 Labours Barbell,12.05.2025,2025 Virus Weightlifting Finals',
      'U15,M,0,79,Total,141,STANDARD,,06.01.2025,',
    ].join('\n');
    const columns = { age: 'Age Group', gender: 'Gender', min: 'bodyWeightMin', max: 'Weight Class', lift: 'Lift', record: 'Record', name: 'Name', date: 'Date', location: 'Event' };
    expect(parseFlatSheet(csv, 'DMV', columns)).toEqual([
      {
        wso: 'DMV',
        ageCategory: 'U15',
        gender: 'Men',
        weightClass: '79',
        snatchRecord: 82,
        cjRecord: null,
        totalRecord: 141,
        snatchBy: { name: 'BANU, Jonathan', date: '2025-12-05', location: '2025 Virus Weightlifting Finals' },
        totalBy: { name: 'Standard', date: '2025-06-01' },
      },
    ]);
  });

  it('reads DMV under its own column names', () => {
    const csv = ['Age Group,Gender,bodyWeightMin,Weight Class,Lift,Record', 'JR,M,,>110,Snatch,150', 'JR,M,,>110,Total,340', 'W35,F,,58,Clean & Jerk,90'].join('\n');
    const columns = { age: 'Age Group', gender: 'Gender', min: 'bodyWeightMin', max: 'Weight Class', lift: 'Lift', record: 'Record' };
    expect(parseFlatSheet(csv, 'DMV', columns)).toEqual([
      { wso: 'DMV', ageCategory: 'Junior', gender: 'Men', weightClass: '110+', snatchRecord: 150, cjRecord: null, totalRecord: 340 },
      { wso: 'DMV', ageCategory: 'Masters 35', gender: 'Women', weightClass: '58', snatchRecord: null, cjRecord: 90, totalRecord: null },
    ]);
  });
});
