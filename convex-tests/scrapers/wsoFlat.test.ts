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
      { wso: 'Georgia', age_category: 'U11', gender: 'Women', weight_class: '36', snatch_record: 16, cj_record: 20, total_record: 35 },
      { wso: 'Georgia', age_category: 'Senior', gender: 'Men', weight_class: '110+', snatch_record: 140, cj_record: null, total_record: 300 },
      { wso: 'Georgia', age_category: 'Masters 65', gender: 'Women', weight_class: '63', snatch_record: null, cj_record: null, total_record: null },
    ]);
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
      { wso: 'California South', age_category: 'U11', gender: 'Women', weight_class: '30', snatch_record: 15, cj_record: null, total_record: 37 },
      { wso: 'California South', age_category: 'U11', gender: 'Women', weight_class: '33', snatch_record: 28, cj_record: null, total_record: 63 },
      { wso: 'California South', age_category: 'U11', gender: 'Women', weight_class: '61+', snatch_record: null, cj_record: null, total_record: 81 },
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
      age_category: 'U11',
      gender: 'Women',
      weight_class: '36',
      snatch_record: 16,
      cj_record: 20,
      total_record: 35,
      snatch_by: { name: 'Hadley Tillman', date: '2025-06-20', location: 'Youth Nationals 2025' },
      cj_by: { name: 'Standard', date: '2025-06-01' },
      total_by: { name: 'Standard' },
    });
    expect(u13).toEqual({
      wso: 'Georgia',
      age_category: 'U13',
      gender: 'Men',
      weight_class: '40',
      snatch_record: null,
      cj_record: null,
      total_record: 55,
      total_by: { name: 'DOE, Jane', date: '2025-08-31', location: 'Meet B' },
    });
  });

  it('leaves holders out for a sheet without a name column', () => {
    const csv = ['ageGroup,gender,bodyWeightMin,bodyWeightMax,lift,record,date', 'U11,F,,36,Snatch,16,2025-06-20'].join('\n');
    expect(parseFlatSheet(csv, 'Georgia')[0]).not.toHaveProperty('snatch_by');
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
        age_category: 'U15',
        gender: 'Men',
        weight_class: '79',
        snatch_record: 82,
        cj_record: null,
        total_record: 141,
        snatch_by: { name: 'BANU, Jonathan', date: '2025-12-05', location: '2025 Virus Weightlifting Finals' },
        total_by: { name: 'Standard', date: '2025-06-01' },
      },
    ]);
  });

  it('reads DMV under its own column names', () => {
    const csv = ['Age Group,Gender,bodyWeightMin,Weight Class,Lift,Record', 'JR,M,,>110,Snatch,150', 'JR,M,,>110,Total,340', 'W35,F,,58,Clean & Jerk,90'].join('\n');
    const columns = { age: 'Age Group', gender: 'Gender', min: 'bodyWeightMin', max: 'Weight Class', lift: 'Lift', record: 'Record' };
    expect(parseFlatSheet(csv, 'DMV', columns)).toEqual([
      { wso: 'DMV', age_category: 'Junior', gender: 'Men', weight_class: '110+', snatch_record: 150, cj_record: null, total_record: 340 },
      { wso: 'DMV', age_category: 'Masters 35', gender: 'Women', weight_class: '58', snatch_record: null, cj_record: 90, total_record: null },
    ]);
  });
});
