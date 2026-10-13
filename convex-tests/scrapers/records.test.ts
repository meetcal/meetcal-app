import { ageCategory, findRecordsPdfUrl, formatWeightClass, parseRecords, parseRecordsReport } from '../../convex/scrapers/parse/records';

const PAGE = 'https://www.usaweightlifting.org/american-records';

describe('records parser (port of usaw/records_scraper)', () => {
  it('reads kept rows by token position and merges the three lifts per class', () => {
    const lines = [
      'AgeGroup M/F Bodyweight Lift Record Name Date Place Event',
      'OPEN F 49 SNATCH 91 DOE, Jane 2026-06-20 Colorado Springs, CO 2026 Nationals',
      'OPEN F 49 CLEANJERK 115 DOE, Jane 2026-06-20',
      'OPEN F 49 TOTAL 206 DOE, Jane 2026-06-20',
      'JR M >109 SNATCH 180 ROE, Rick 2026-05-01',
      'M35 M 109+ TOTAL Standard 2026-08-01',
      'W40 F 59 SNATCH 70.9 SMITH, Ann 2026-01-01',
      'Open Championships',
    ];
    expect(parseRecords([lines])).toMatchObject([
      { record_type: 'USAW', age_category: 'senior', gender: 'women', weight_class: '49kg', snatch_record: 91, cj_record: 115, total_record: 206 },
      { record_type: 'USAW', age_category: 'junior', gender: 'men', weight_class: '109+kg', snatch_record: 180, cj_record: 0, total_record: 0 },
      { record_type: 'USAW', age_category: 'Masters 40', gender: 'women', weight_class: '59kg', snatch_record: 70, cj_record: 0, total_record: 0 },
    ]);
  });

  it('records who set each lift: name, ISO date, and event then place', () => {
    const lines = [
      'OPEN F 49 SNATCH 91 DOE, Jane 2026-06-20 Colorado Springs, CO 2026 National Championships',
      'OPEN F 49 CLEANJERK 115 DOE, Jane 2026-06-20',
      'OPEN F 49 TOTAL 206 Standard 2026-08-01',
      'JR M 60 SNATCH 120 VAN DER BERG, Jan 2025-12-06 Daytona Beach, FL 2025 Virus Weightlifting Finals & UMWF World Championships',
      'JR M 60 CLEANJERK 150 ROE, Rick 2026-05-01 Local Open',
      'JR M 60 TOTAL Standard 2026-08-01',
      'W80 F 49 SNATCH 0 Standard 2026-08-01',
    ];
    const [women49, men60, women80] = parseRecords([lines]);
    expect(women49.snatch_by).toEqual({ name: 'DOE, Jane', date: '2026-06-20', location: '2026 National Championships, Colorado Springs, CO' });
    expect(women49.cj_by).toEqual({ name: 'DOE, Jane', date: '2026-06-20' });
    expect(women49.total_by).toEqual({ name: 'Standard', date: '2026-08-01' });
    expect(men60.snatch_by).toEqual({
      name: 'VAN DER BERG, Jan',
      date: '2025-12-06',
      location: '2025 Virus Weightlifting Finals & UMWF World Championships, Daytona Beach, FL',
    });
    // No year to split at: place and event stay together, as written.
    expect(men60.cj_by).toEqual({ name: 'ROE, Rick', date: '2026-05-01', location: 'Local Open' });
    // A "Standard" value is no lift, and a 0 kg standard holds nothing.
    expect(men60).not.toHaveProperty('total_by');
    expect(women80).toEqual({ record_type: 'USAW', age_category: 'Masters 80', gender: 'women', weight_class: '49kg', snatch_record: 0, cj_record: 0, total_record: 0 });
  });

  it('maps age codes and weight classes like the Python scraper', () => {
    expect(ageCategory('UNI')).toBe('university');
    expect(ageCategory('Open')).toBe('senior');
    expect(ageCategory('M70')).toBe('Masters 70');
    expect(ageCategory('U17')).toBe('u17');
    expect(ageCategory('ADAP')).toBeNull();
    expect(formatWeightClass('$>86$')).toBe('86+kg');
    expect(formatWeightClass('+109kg')).toBe('109+kg');
    expect(formatWeightClass('48')).toBe('48kg');
    expect(formatWeightClass('Bodyweight')).toBeNull();
  });

  it('reads the age groups the PDF writes since the August 2026 class change (#406)', () => {
    expect(ageCategory('11 & Under')).toBe('u11');
    expect(ageCategory('12-13yo')).toBe('u13');
    expect(ageCategory('14-15yo')).toBe('u15');
    expect(ageCategory('16-17yo')).toBe('u17');
    expect(ageCategory('University')).toBe('university');
    // Lines as the "Post August 1, 2026" PDF (updated Oct 8, 2026) has them.
    const lines = [
      '11 & Under F 37 SNATCH 34 AOKI BLANCHARD, Charlotte 2026-09-12 Fort Worth, TX 2026 Virus Weightlifting Series 2',
      '11 & Under F 37 CLEANJERK 40 AOKI BLANCHARD, Charlotte 2026-09-12',
      '11 & Under F 37 TOTAL 74 AOKI BLANCHARD, Charlotte 2026-09-12',
      '12-13yo M 55 TOTAL 144 GRAFTON, David 2026-09-12',
      '14-15yo M 70 TOTAL 225 BUJANDA, Liam 2026-09-12',
      '16-17yo M 85 SNATCH 130 WHITLOCK, Robert 2026-08-29 Guayaquil, Ecuador 2026 Pan American Youth Championships',
      'University M 110 TOTAL 369 UPMEYER, George 2026-09-12 Doha, QAT 2026 FISU World University Championships',
      // Adaptive records are another table's: never read as these.
      'ADAP - Physical - 11 & Under F 30 SNATCH 0 Standard 2026-08-01',
      'ADAP - Visual Impairment - OPEN M 60 TOTAL 100 Standard 2026-08-01',
    ];
    const { records, unknownAgeGroups } = parseRecordsReport([lines]);
    expect(records.map((r) => [r.age_category, r.gender, r.weight_class, r.snatch_record, r.cj_record, r.total_record])).toEqual([
      ['u11', 'women', '37kg', 34, 40, 74],
      ['u13', 'men', '55kg', 0, 0, 144],
      ['u15', 'men', '70kg', 0, 0, 225],
      ['u17', 'men', '85kg', 130, 0, 0],
      ['university', 'men', '110kg', 0, 0, 369],
    ]);
    expect(records[0].snatch_by).toEqual({ name: 'AOKI BLANCHARD, Charlotte', date: '2026-09-12', location: '2026 Virus Weightlifting Series 2, Fort Worth, TX' });
    expect(unknownAgeGroups).toEqual([]);
  });

  it('names an age group it does not know instead of dropping its rows silently (#406)', () => {
    const { records, unknownAgeGroups } = parseRecordsReport([
      [
        '18-20yo F 49 SNATCH 80 DOE, Jane 2026-09-01',
        'Under 9 M 30 TOTAL 20 Standard 2026-08-01',
        '12-13 yo M 55 TOTAL 144 GRAFTON, David 2026-09-12',
        'JR F 49 SNATCH 81 ROE, Ann 2026-09-01',
        'AgeGroup M/F Bodyweight Lift Record Name Date Place Event',
        'Total records: 5',
      ],
    ]);
    expect(records.map((r) => r.age_category)).toEqual(['junior']);
    expect(unknownAgeGroups).toEqual(['12-13 yo', '18-20yo', 'Under 9']);
  });

  it('picks the current records PDF, ignoring CSS inlined in the button and former records', () => {
    const html = `
      <div><h3>Former American Records</h3><a href="/old.pdf"><span>View</span></a></div>
      <div><h3>American Records - Aug. 1, 2026</h3>
        <a href="https://cdn.example/current.pdf"><style>.x{white-space:nowrap}</style><span>View<style>.y{}</style></span></a></div>`;
    expect(findRecordsPdfUrl(html, PAGE)).toBe('https://cdn.example/current.pdf');
  });
});
