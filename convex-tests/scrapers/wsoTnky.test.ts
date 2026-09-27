import { parseTnky, tnkySection } from '../../convex/scrapers/parse/wso/tnky';

describe('Tennessee-Kentucky WSO sheet (port of scraper_tnky.py)', () => {
  it('reads section headers', () => {
    expect(tnkySection('YOUTH: MEN 13 & Under')).toEqual(['U13', 'Men']);
    expect(tnkySection('YOUTH: WOMEN 14-17 YO')).toEqual(['U17', 'Women']);
    expect(tnkySection('SENIORS: MEN 15 years old <')).toEqual(['Senior', 'Men']);
    expect(tnkySection('MASTERS: WOMEN 35-39 years old')).toEqual(['Masters 35', 'Women']);
    expect(tnkySection('MASTERS: MEN')).toBeNull();
    expect(tnkySection('SNATCH')).toBeNull();
  });

  it('reads classes on the header row or the next, then value, name and date rows per lift', () => {
    const lift = (name: string, ...values: string[]) => [[name, ...values].join(','), 'Name,a,b', 'Date,x,y'];
    const csv = [
      'YOUTH: MEN,44 KG,13 & Under 48 KG',
      ...lift('SNATCH', '40', ''),
      ...lift('C&J', '50', '60'),
      ...lift('TOTAL', '90', 'x'),
      'SENIORS: WOMEN,,15 years old <',
      ',86+ KG,notes',
      ...lift('SNATCH', '100', ''),
      ...lift('C&J', '130', ''),
      ...lift('TOTAL', '230', ''),
      '',
    ].join('\n');
    expect(parseTnky(csv, 'Tennessee-Kentucky').map((r) => [r.age_category, r.gender, r.weight_class, r.snatch_record, r.cj_record, r.total_record])).toEqual([
      ['U13', 'Men', '44', 40, 50, 90],
      ['U13', 'Men', '48', null, 60, null],
      ['Senior', 'Women', '86+', 100, 130, 230],
    ]);
  });

  it('reads who set each lift from the name and date rows, a repeated class keeping the later column with its holder', () => {
    const csv = [
      'SENIORS: WOMEN,,15 years old <',
      ',69 KG,77 KG*,86 KG,77 KG*',
      'SNATCH,88,90,,124',
      'Name,Rachael Skinner,Riley Williams,Ghost,Olivia Reeves',
      'Date,6/25/2025,6/26/2025,1/1/2025,8/30/2025',
      'C&J,107,105,,153',
      'Name,Rachael Skinner,Riley Williams,,Olivia Reeves',
      'Date,6/25/2025,6/26/2025,,12//5/26',
      'TOTAL,195,195,,',
      'Name,,Riley Williams,,Olivia Reeves',
      'Date,,6/26/2025,,',
      ',,,,*Unsubmitted',
    ].join('\n');
    const records = parseTnky(csv, 'Tennessee-Kentucky');
    expect(records[0]).toEqual({
      wso: 'Tennessee-Kentucky',
      age_category: 'Senior',
      gender: 'Women',
      weight_class: '69',
      snatch_record: 88,
      cj_record: 107,
      total_record: 195,
      snatch_by: { name: 'Rachael Skinner', date: '2025-06-25' },
      cj_by: { name: 'Rachael Skinner', date: '2025-06-25' },
      total_by: { name: 'Standard' },
    });
    // 77 twice: the later column's values and holders; a date that can't be read is kept as written.
    expect(records[1]).toMatchObject({
      weight_class: '77',
      snatch_record: 124,
      cj_record: 153,
      total_record: 195,
      snatch_by: { name: 'Olivia Reeves', date: '2025-08-30' },
      cj_by: { name: 'Olivia Reeves', date: '12//5/26' },
      total_by: { name: 'Riley Williams', date: '2025-06-26' },
    });
    // No value, no holder, whatever the name row says.
    expect(records[2]).toEqual({ wso: 'Tennessee-Kentucky', age_category: 'Senior', gender: 'Women', weight_class: '86', snatch_record: null, cj_record: null, total_record: null });
  });
});
