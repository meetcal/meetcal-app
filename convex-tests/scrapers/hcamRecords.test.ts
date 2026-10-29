import { readFileSync } from 'fs';
import { join } from 'path';
import { discoverHcamPdfs, parseHcamPages } from '../../convex/scrapers/parse/hcamRecords';

const STORAGE = 'https://storage.googleapis.com/production-ipower-v1-0-4/354/1018354/vixoE8Rk';

/** The lines `pdfLines` read from the HCAM PDFs linked on 2026-10-28, page by page. */
function fixture(name: string): string[][] {
  const text = readFileSync(join(__dirname, 'fixtures', name), 'utf8');
  return text
    .split(/^=== page \d+\n/m)
    .filter(Boolean)
    .map((page) => page.split('\n'));
}

describe('HCAM records PDFs', () => {
  it('picks the latest-dated AM file per gender over the retired ones and the other records PDFs', () => {
    // The page as of 2026-10-28, in its order: retired records first, then the current ones.
    const page = `
      <a href="${STORAGE}/n1?fileName=NM20260927-MEN.pdf">Men</a>
      <a href="${STORAGE}/a1?fileName=AM20251215-men.pdf">Retired Records</a>
      <a href="${STORAGE}/a2?fileName=AM20260101-men-30 and up.pdf">HCAM Men</a>
      <a href="${STORAGE}/a2?fileName=AM20260101-men-30 and up.pdf">HCAM Men</a>
      <a href="${STORAGE}/a3?fileName=AM20251215-women.pdf">Retired Records</a>
      <a href="${STORAGE}/a4?fileName=AM20260101-women-30 and up.pdf">HCAM Women</a>
      <a href="${STORAGE}/c1?fileName=AmericasCup20241209-MEN.pdf">Americas Cup</a>
      <a href="${STORAGE}/s1?fileName=Supertotal20260330-Women.pdf">Supertotal</a>`;
    expect(discoverHcamPdfs(page)).toEqual({
      Men: `${STORAGE}/a2?fileName=AM20260101-men-30 and up.pdf`,
      Women: `${STORAGE}/a4?fileName=AM20260101-women-30 and up.pdf`,
    });
    // Order on the page does not matter; the date does.
    const reversed = `<a href="${STORAGE}/b?fileName=AM20270101_WOMEN.pdf">w</a><a href="${STORAGE}/a?fileName=AM20260101-women.pdf">w</a><a href="${STORAGE}/m?fileName=AM20260101 men.pdf">m</a>`;
    expect(discoverHcamPdfs(reversed)).toEqual({ Men: `${STORAGE}/m?fileName=AM20260101 men.pdf`, Women: `${STORAGE}/b?fileName=AM20270101_WOMEN.pdf` });
    // A percent-escaped name is read the same way.
    const escaped = `<a href="${STORAGE}/m?fileName=AM20270101%20men.pdf">m</a><a href="${STORAGE}/w?fileName=AM20270101%20women.pdf">w</a>`;
    expect(discoverHcamPdfs(escaped).Men).toBe(`${STORAGE}/m?fileName=AM20270101%20men.pdf`);
  });

  it('fails rather than guess between two files of the same date, or when a gender has none', () => {
    const twins = `<a href="${STORAGE}/a?fileName=AM20260101-men.pdf">m</a><a href="${STORAGE}/b?fileName=AM20260101-men-30 and up.pdf">m</a><a href="${STORAGE}/w?fileName=AM20260101-women.pdf">w</a>`;
    expect(() => discoverHcamPdfs(twins)).toThrow('Two HCAM men records PDFs dated 20260101');
    expect(() => discoverHcamPdfs(`<a href="${STORAGE}/w?fileName=AM20260101-women.pdf">w</a>`)).toThrow('for: Men');
    expect(() => discoverHcamPdfs('<a href="/AM20260101-men.pdf">x</a>')).toThrow('Men, Women');
  });

  it('reads every held class of the January 2026 PDFs in the USAMW row format', () => {
    const men = parseHcamPages(fixture('hcam-men-20260101.txt'), 'Men');
    const women = parseHcamPages(fixture('hcam-women-20260101.txt'), 'Women');
    expect(men).toHaveLength(17);
    expect(women).toHaveLength(30);
    expect(men[0]).toEqual({
      recordType: 'USAMW_HCAM',
      ageCategory: 'Masters 30',
      gender: 'Men',
      weightClass: '110kg',
      snatchRecord: 77,
      cjRecord: 110,
      totalRecord: 187,
      snatchBy: { name: 'Nathaniel GRESBACH', date: '2025-12-14', location: 'Howard Cohen American Masters, Louisville, KY' },
      cjBy: { name: 'Nathaniel GRESBACH', date: '2025-12-14', location: 'Howard Cohen American Masters, Louisville, KY' },
      totalBy: { name: 'Nathaniel GRESBACH', date: '2025-12-14', location: 'Howard Cohen American Masters, Louisville, KY' },
    });
    // "+110" is stored as USAMW writes it; middle initials and apostrophes stay in the name.
    expect(men[1]).toMatchObject({ weightClass: '110+kg', totalRecord: 347, totalBy: { name: 'Dimitri ALBURY' } });
    expect(women.find((r) => r.ageCategory === 'Masters 50' && r.weightClass === '86+kg')).toMatchObject({ snatchBy: { name: 'Delores M HILL' } });
    expect(women.find((r) => r.ageCategory === 'Masters 50' && r.weightClass === '86kg')).toMatchObject({ cjBy: { name: "Heather O'DANIEL" } });
    // Classes nobody holds yet are not records.
    expect(men.some((r) => r.weightClass === '60kg' && r.ageCategory === 'Masters 30')).toBe(false);
  });

  it('keeps a class whose lifts are only partly held, with the others null', () => {
    const pages = [['AMERICAN MASTERS RECORDS - WOMEN', 'AGE GROUP: 70-74', 'SNATCH', '77 Mary Sharon MAU 44.0 12/11/25 Louisville, KY', 'CLEAN & JERK', '77', 'TOTAL', '77']];
    expect(parseHcamPages(pages, 'Women')).toEqual([
      {
        recordType: 'USAMW_HCAM',
        ageCategory: 'Masters 70',
        gender: 'Women',
        weightClass: '77kg',
        snatchRecord: 44,
        cjRecord: null,
        totalRecord: null,
        snatchBy: { name: 'Mary Sharon MAU', date: '2025-12-11', location: 'Howard Cohen American Masters, Louisville, KY' },
      },
    ]);
  });

  it('carries an age group onto the next page, and reads an open-ended one', () => {
    const pages = [
      ['HOWARD COHEN AMERICAN MASTERS RECORDS - MEN', 'AGE GROUP: 90+', 'SNATCH', '60 Al OLD 40.0 12/14/25 Louisville, KY'],
      ['CLEAN & JERK', '60 Al OLD 50.0 12/14/25 Louisville, KY'],
    ];
    expect(parseHcamPages(pages, 'Men')).toMatchObject([{ ageCategory: 'Masters 90', weightClass: '60kg', snatchRecord: 40, cjRecord: 50 }]);
  });

  it('fails on a swapped or untitled PDF, a row it cannot read, a class outside a section, or a lift listed twice', () => {
    expect(() => parseHcamPages(fixture('hcam-women-20260101.txt'), 'Men')).toThrow('the men PDF holds the other records');
    // Untitled, it could be either gender's.
    const untitled = fixture('hcam-women-20260101.txt').map((lines) => lines.filter((line) => !line.startsWith('HOWARD COHEN')));
    expect(() => parseHcamPages(untitled, 'Men')).toThrow('its gender cannot be checked');
    const page = (...lines: string[]) => [['AGE GROUP: 35 - 39', 'SNATCH', ...lines]];
    expect(() => parseHcamPages(page('85 Jo DOE 90 kg 12/13/25 Louisville, KY'), 'Men')).toThrow('unreadable record row');
    expect(() => parseHcamPages(page('85 Jo DOE 12/13/25 Louisville, KY'), 'Men')).toThrow('unreadable record row');
    expect(() => parseHcamPages(page('85', '85 Jo DOE 90.0 12/13/25 Louisville, KY'), 'Men')).toThrow('Masters 35 85kg snatch listed twice');
    expect(() => parseHcamPages([['AGE GROUP: 35 - 39', '85 Jo DOE 90.0 12/13/25 Louisville, KY']], 'Men')).toThrow('outside an age group and lift');
    expect(() => parseHcamPages([['SNATCH', '85 Jo DOE 90.0 12/13/25 Louisville, KY']], 'Men')).toThrow('outside an age group and lift');
  });
});
