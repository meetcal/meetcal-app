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
});
