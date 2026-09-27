import { gidOf } from '../../convex/scrapers/parse/wso/common';
import { normalizeAgeGroup, parseFlatSheet } from '../../convex/scrapers/parse/wso/flat';

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
    expect(parseFlatSheet(csv, 'California South', 'WSO record')).toEqual([
      { wso: 'California South', age_category: 'U11', gender: 'Women', weight_class: '30', snatch_record: 15, cj_record: null, total_record: 37 },
      { wso: 'California South', age_category: 'U11', gender: 'Women', weight_class: '33', snatch_record: 28, cj_record: null, total_record: 63 },
      { wso: 'California South', age_category: 'U11', gender: 'Women', weight_class: '61+', snatch_record: null, cj_record: null, total_record: 81 },
    ]);
  });
});
