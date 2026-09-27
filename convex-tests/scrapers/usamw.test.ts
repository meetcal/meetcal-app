import { ageCategory, discoverRecordPdfs, parseRecordPages } from '../../convex/scrapers/parse/usamw';

const STORAGE = 'https://storage.googleapis.com/production-ipower-v1-0-4/354/1018354/vixoE8Rk';

describe('USAMW national records (port of national_records.py)', () => {
  it('finds the men and women PDFs, including the " 1" copy names that broke the Python pattern', () => {
    const page = `
      <a href="${STORAGE}/a?fileName=NM20260713-MEN 1.pdf">Men</a>
      <a href="${STORAGE}/b?fileName=NM20260713-WOMEN 1.pdf">Women</a>
      <a href="${STORAGE}/c?fileName=AM20241209-men.pdf">American</a>
      <a href="${STORAGE}/d?fileName=Supertotal20260330-Women.pdf">Supertotal</a>`;
    expect(discoverRecordPdfs(page)).toEqual({
      Men: `${STORAGE}/a?fileName=NM20260713-MEN 1.pdf`,
      Women: `${STORAGE}/b?fileName=NM20260713-WOMEN 1.pdf`,
    });
    expect(discoverRecordPdfs(`<a href="${STORAGE}/x?fileName=NM2025-men.pdf">m</a><a href="${STORAGE}/y?fileName=NM2025_women.pdf">w</a>`)).toEqual({
      Men: `${STORAGE}/x?fileName=NM2025-men.pdf`,
      Women: `${STORAGE}/y?fileName=NM2025_women.pdf`,
    });
    expect(() => discoverRecordPdfs('<a href="/nothing.pdf">x</a>')).toThrow('Men, Women');
  });

  it('reads the age group from the page head and class/lift/record lines, sorted by age then class', () => {
    const pages = [
      ['USA Masters National Records', 'W40-44', '63 SNA 70 DOE 2025', '63 CNJ 88.5 DOE 2025', '63+ TOT 180 ROE 2024', 'Notes'],
      ['USA Masters National Records', 'W35-39', '48 SNATCH 60 X', '48 C&J 75 X', '48 TOTAL 135 X'],
      ['cover page with no age group'],
    ];
    expect(parseRecordPages(pages, 'Women')).toMatchObject([
      { recordType: 'USAMW', ageCategory: 'Masters 35', gender: 'Women', weightClass: '48kg', snatchRecord: 60, cjRecord: 75, totalRecord: 135 },
      { recordType: 'USAMW', ageCategory: 'Masters 40', gender: 'Women', weightClass: '63kg', snatchRecord: 70, cjRecord: 88, totalRecord: null },
      { recordType: 'USAMW', ageCategory: 'Masters 40', gender: 'Women', weightClass: '63+kg', snatchRecord: null, cjRecord: null, totalRecord: 180 },
    ]);
  });

  it('records who set each lift: family and given name, date, competition then site', () => {
    const pages = [
      [
        'USA National Masters Records - Men',
        'July 13, 2026',
        'M 35 - 39',
        'Cat Lift Record Family Name Given Name Date Site Competition Name',
        '95 SNA 140 ELAM II Onzy 28-Mar-26 Little Rock, AR National Masters',
        '95 CnJ 165 DECRISTOFARO Anthony 12-Sep-25 Las Vegas, NV World Masters',
        '95 TOT 302 ELAM II Onzy 28-Mar-26 Somewhere Open',
        '110+ SNA 148 ALBURY Dimitri',
        '110+ CnJ',
        '110+ TOT',
      ],
    ];
    const [middle, heavy] = parseRecordPages(pages, 'Men');
    expect(middle.snatchBy).toEqual({ name: 'ELAM II Onzy', date: '2026-03-28', location: 'National Masters, Little Rock, AR' });
    expect(middle.cjBy).toEqual({ name: 'DECRISTOFARO Anthony', date: '2025-09-12', location: 'World Masters, Las Vegas, NV' });
    expect(middle.totalBy).toEqual({ name: 'ELAM II Onzy', date: '2026-03-28', location: 'Somewhere Open' });
    // Vacant lifts (no value) have no holder.
    expect(heavy).toEqual({
      recordType: 'USAMW',
      ageCategory: 'Masters 35',
      gender: 'Men',
      weightClass: '110+kg',
      snatchRecord: 148,
      cjRecord: null,
      totalRecord: null,
      snatchBy: { name: 'ALBURY Dimitri' },
    });
  });

  it('maps age headings', () => {
    expect(ageCategory('M 35 - 39 National Records')).toBe('Masters 35');
    expect(ageCategory('W80+')).toBe('Masters 80');
    expect(ageCategory('Records')).toBeNull();
  });
});
