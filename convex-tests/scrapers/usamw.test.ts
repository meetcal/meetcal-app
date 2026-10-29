import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { PdfLine, PdfLineOptions } from '../../convex/scrapers/lib/pdf';
import { ageCategory, discoverRecordPdfs, parseRecordPages, PDF_OPTIONS, type UsamwRecord } from '../../convex/scrapers/parse/usamw';

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

  it('tells a site abroad from the competition by the cells the PDF draws, and keeps the text-only reading', () => {
    const at = (cells: [number, string][]): PdfLine => ({
      text: cells.map(([, text]) => text).join(' '),
      runs: cells.map(([x, text]) => ({ text, x, end: x + text.length * 5 })),
    });
    const head = ['USA National Masters Records - Men', 'M 45 - 49'];
    const abroad: [number, string][] = [[70, '110+'], [114, 'CnJ'], [165, '195'], [199, 'ALBURY'], [295, 'Dimitri'], [364, '26-Sep-26'], [422, 'Athens, Greece'], [547, 'World Masters']];
    const sharedRun: [number, string][] = [[70, '70'], [114, 'SNA'], [168, '94'], [199, 'FLORENDO'], [295, 'Sid'], [364, '29-May-26 San Salvador, ES'], [528, 'Pan American Masters']];
    const [cells] = parseRecordPages([[...head, at(abroad)]], 'Men');
    expect(cells.cjBy).toEqual({ name: 'ALBURY Dimitri', date: '2026-09-26', location: 'World Masters, Athens, Greece' });
    expect(parseRecordPages([[...head, at(sharedRun)]], 'Men')[0].snatchBy).toEqual({ name: 'FLORENDO Sid', date: '2026-05-29', location: 'Pan American Masters, San Salvador, ES' });
    // Text alone cannot place the end of a site with no state code: all of it is kept.
    const [text] = parseRecordPages([[...head, at(abroad).text]], 'Men');
    expect(text.cjBy).toEqual({ name: 'ALBURY Dimitri', date: '2026-09-26', location: 'Athens, Greece World Masters' });
    // A site without a comma is not told from a competition in two cells: the text reading decides.
    const noComma: [number, string][] = [[70, '60'], [114, 'SNA'], [168, '93'], [199, 'MURRAY'], [295, 'George'], [364, '12-Sep-25'], [423, 'Championships'], [547, 'World Masters']];
    expect(parseRecordPages([[...head, at(noComma)]], 'Men')[0].snatchBy?.location).toBe('Championships World Masters');
    // A date drawn in two runs with a gap is still one date.
    const spacedDate = at(noComma).text.replace('12-Sep-25', '12-Sep- 25');
    expect(parseRecordPages([[...head, spacedDate]], 'Men')[0].snatchBy).toEqual({ name: 'MURRAY George', date: '2025-09-12', location: 'Championships World Masters' });
    // A site drawn as two cells is not a whole site: the text reading decides.
    const splitSite: [number, string][] = [[70, '60'], [114, 'SNA'], [168, '93'], [199, 'MURRAY'], [295, 'George'], [364, '12-Sep-25'], [423, 'Las Vegas,'], [480, 'NV'], [547, 'World Masters']];
    expect(parseRecordPages([[...head, at(splitSite)]], 'Men')[0].snatchBy?.location).toBe('World Masters, Las Vegas, NV');
    // Runs drawn touching are one word in a cell, as in the line's text.
    const touching: PdfLine = {
      text: '60 SNA 93 MURRAY George 12-Sep-25 Las Vegas, NV World Masters',
      runs: [
        ...at(splitSite.slice(0, 6)).runs,
        { text: 'Las Ve', x: 423, end: 453 },
        { text: 'gas, NV', x: 453, end: 490 },
        { text: 'World Masters', x: 547, end: 612 },
      ],
    };
    expect(parseRecordPages([[...head, touching]], 'Men')[0].snatchBy?.location).toBe('World Masters, Las Vegas, NV');
    // A date drawn as two runs a few points apart keeps the site abroad split from the competition.
    const gappedDate: PdfLine = {
      text: '110+ CnJ 195 ALBURY Dimitri 26-Sep- 26 Athens, Greece World Masters',
      runs: [...at(abroad.slice(0, 5)).runs, { text: '26-Sep-', x: 364, end: 398 }, { text: '26', x: 402, end: 412 }, ...at(abroad.slice(6)).runs],
    };
    expect(parseRecordPages([[...head, gappedDate]], 'Men')[0].cjBy).toEqual(cells.cjBy);
    // A site cell that runs on into the competition: the text reading decides.
    const runOn: [number, string][] = [[70, '60'], [114, 'SNA'], [168, '93'], [199, 'MURRAY'], [295, 'George'], [364, '12-Sep-25'], [423, 'Las Vegas, NV World'], [560, 'Masters']];
    expect(parseRecordPages([[...head, at(runOn)]], 'Men')[0].snatchBy?.location).toBe('World Masters, Las Vegas, NV');
    // A date drawn as two touching runs is still one date.
    const splitDate: PdfLine = {
      text: '110+ CnJ 195 ALBURY Dimitri 26-Sep-26 Athens, Greece World Masters',
      runs: [...at(abroad.slice(0, 5)).runs, { text: '26-Sep-', x: 364, end: 398 }, { text: '26', x: 398, end: 408 }, ...at(abroad.slice(6)).runs],
    };
    expect(parseRecordPages([[...head, splitDate]], 'Men')[0].cjBy).toEqual(cells.cjBy);
  });

  it('spaces only the names listed as run together, and keeps every other name as written', () => {
    const holder = (name: string) => parseRecordPages([['M 40 - 44', `75 SNA 107 ${name} 27-Mar-26 Little Rock, AR National Masters`]], 'Men')[0].snatchBy?.name;
    expect(holder('TAN CASTELLANOSYicay')).toBe('TAN CASTELLANOS Yicay');
    // A listed name on a line without a date is spaced too.
    expect(parseRecordPages([['M 40 - 44', '75 SNA 107 TAN CASTELLANOSYicay']], 'Men')[0].snatchBy?.name).toBe('TAN CASTELLANOS Yicay');
    for (const name of ["SMITH D'Angelo", "O'Neil Mary", 'SMITH-Jones Ann', 'McDONALD Ann', 'SMITH DEAnne', 'SMITH ALEXandra', 'SMITHDEAnne', 'McDONALDSarah']) {
      expect(holder(name)).toBe(name);
    }
  });

  it('corrects only the listed lifts, and only while the PDF prints the wrong value', () => {
    const page = (age: string, weightClass: string, ...lines: string[]) => [['USA National Masters Records - Women', age, ...lines.map((l) => `${weightClass} ${l} Athens, Greece World Masters`)]];
    const lifts = (records: UsamwRecord[]) => records.map((r) => [r.snatchRecord, r.cjRecord, r.totalRecord]);
    const corrections: string[] = [];
    const ong = (total: number) => page('W 40 - 44', '86', 'SNA 79 ONG Jaquelin 24-Sep-26', 'CnJ 95 ONG Jaquelin 24-Sep-26', `TOT ${total} ONG Jaquelin 24-Sep-26`);
    expect(lifts(parseRecordPages(ong(1744), 'Women', corrections))).toEqual([[79, 95, 174]]);
    expect(corrections).toEqual(['Women Masters 40 86kg totalRecord: printed 1744, stored 174']);
    const nichols = page('W 55 - 59', '69', 'SNA 488 NICHOLS Stacy 19-Sep-26', 'CnJ 65 NICHOLS Stacy 19-Sep-26', 'TOT 113 NICHOLS Stacy 19-Sep-26');
    expect(lifts(parseRecordPages(nichols, 'Women'))).toEqual([[48, 65, 113]]);
    // Fixed at the source, or another value: stored as printed.
    const none: string[] = [];
    expect(lifts(parseRecordPages(ong(174), 'Women', none))).toEqual([[79, 95, 174]]);
    expect(lifts(parseRecordPages(ong(1733), 'Women', none))).toEqual([[79, 95, 1733]]);
    // The same printed value beside another holder or date is not touched.
    const other = page('W 40 - 44', '86', 'TOT 1744 DOE Jane 24-Sep-26');
    expect(lifts(parseRecordPages(other, 'Women', none))).toEqual([[null, null, 1744]]);
    expect(lifts(parseRecordPages(page('W 40 - 44', '86', 'TOT 1744 ONG Jaquelin 25-Sep-26'), 'Women', none))).toEqual([[null, null, 1744]]);
    // The same printed value in another class or gender is not touched.
    expect(lifts(parseRecordPages(page('W 45 - 49', '86', 'TOT 1744 ONG Jaquelin 24-Sep-26'), 'Women', none))).toEqual([[null, null, 1744]]);
    expect(lifts(parseRecordPages(page('M 40 - 44', '86', 'TOT 1744 ONG Jaquelin 24-Sep-26'), 'Men', none))).toEqual([[null, null, 1744]]);
    expect(none).toEqual([]);
  });
});

const isRun = (run: unknown): boolean =>
  typeof run === 'object' && run !== null && 'text' in run && typeof run.text === 'string' && 'x' in run && typeof run.x === 'number' && 'end' in run && typeof run.end === 'number';
const isLine = (line: unknown): line is PdfLine =>
  typeof line === 'object' && line !== null && 'text' in line && typeof line.text === 'string' && 'runs' in line && Array.isArray(line.runs) && line.runs.every(isRun);

/** The PDF's lines as the sync reads them (`pdfRunLines`, `PDF_OPTIONS`), read by Bun in a child process: Jest cannot load unpdf. */
function fixtureLines(name: string, options: PdfLineOptions = PDF_OPTIONS): PdfLine[][] {
  const script = join(__dirname, 'pdfRunLines.mjs');
  // Bun from PATH: the pinned one under `mise run`/`mise exec`, and CI's `setup-bun`, which has no mise.
  let out: string;
  try {
    out = execFileSync('bun', [script, join(__dirname, 'fixtures', name), JSON.stringify(options)], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') throw new Error('bun is not on PATH: run the tests through `mise run` or `mise exec --`');
    throw error;
  }
  const pages: unknown = JSON.parse(out);
  if (!Array.isArray(pages) || !pages.every((page): page is PdfLine[] => Array.isArray(page) && page.every(isLine))) {
    throw new Error(`pdfRunLines.mjs printed no pages of lines for ${name}`);
  }
  return pages;
}

describe('USAMW national records PDFs of September 27, 2026 (pages rotated 90 degrees)', () => {
  let men: PdfLine[][] = [];
  let women: PdfLine[][] = [];
  let records: UsamwRecord[] = [];
  const corrections: string[] = [];
  beforeAll(() => {
    men = fixtureLines('usamw-national-records-men-20260927.pdf');
    women = fixtureLines('usamw-national-records-women-20260927.pdf');
    records = [...parseRecordPages(men, 'Men', corrections), ...parseRecordPages(women, 'Women', corrections)];
  }, 60_000);
  const find = (gender: string, age: number, weightClass: string) =>
    records.find((r) => r.gender === gender && r.ageCategory === `Masters ${age}` && r.weightClass === weightClass);

  it('reads the rotated pages as they are displayed, one table row per line', () => {
    expect(men).toHaveLength(12);
    expect(women).toHaveLength(11);
    expect(men[0].slice(0, 5).map((l) => l.text)).toEqual([
      'USA National Masters Records - Men',
      'September 27, 2026',
      'M 35 - 39',
      'Cat Lift Record Family Name Given Name Date Site Competition Name',
      '60 SNA 93 MURRAY George 12-Sep-25 Las Vegas, NV World Masters',
    ]);
    // Without `asDisplayed` (every other source) a page is read in its own coordinates, one table column per line.
    const own = fixtureLines('usamw-national-records-men-20260927.pdf', { xTolerance: 2, yTolerance: 2 });
    expect(own[0].map((l) => l.text)).toContain('Cat 110110110');
    expect(parseRecordPages(own, 'Men')).toEqual([]);
  });

  it('stores every lift the PDFs hold: 232 men\'s and 192 women\'s', () => {
    const held = (pages: PdfLine[][], gender: string) =>
      pages.flatMap((page) => {
        const age = ageCategory(page.slice(0, 8).map((l) => l.text).find((t) => ageCategory(t)) ?? '');
        return page.flatMap((l) => {
          const m = /^(\d+\+?) (SNA|CnJ|TOT) (\d+) /.exec(l.text);
          return m ? [{ gender, age, weightClass: `${m[1]}kg`, lift: m[2], value: Number(m[3]) }] : [];
        });
      });
    const printed = [...held(men, 'Men'), ...held(women, 'Women')];
    expect(printed.filter((p) => p.gender === 'Men')).toHaveLength(232);
    expect(printed.filter((p) => p.gender === 'Women')).toHaveLength(192);
    const field = { SNA: 'snatchRecord', CnJ: 'cjRecord', TOT: 'totalRecord' } as const;
    const stored = printed.map((p) => records.find((r) => r.gender === p.gender && r.ageCategory === p.age && r.weightClass === p.weightClass)?.[field[p.lift as keyof typeof field]]);
    // Every printed value is stored as printed, but the two corrected.
    const differ = printed.map((p, i) => ({ ...p, stored: stored[i] })).filter((p) => p.stored !== p.value);
    expect(differ).toEqual([
      { gender: 'Women', age: 'Masters 40', weightClass: '86kg', lift: 'TOT', value: 1744, stored: 174 },
      { gender: 'Women', age: 'Masters 55', weightClass: '69kg', lift: 'SNA', value: 488, stored: 48 },
    ]);
    expect(corrections).toEqual(['Women Masters 40 86kg totalRecord: printed 1744, stored 174', 'Women Masters 55 69kg snatchRecord: printed 488, stored 48']);
    const liftCount = records.reduce((n, r) => n + [r.snatchRecord, r.cjRecord, r.totalRecord].filter((v) => v !== null).length, 0);
    expect(liftCount).toBe(232 + 192);
    expect(records).toHaveLength(142);
    // The September 2026 World Masters in Athens.
    const athens = records.flatMap((r) => [r.snatchBy, r.cjBy, r.totalBy]).filter((h) => h?.location === 'World Masters, Athens, Greece');
    expect(athens).toHaveLength(86);
    expect(athens.every((h) => h!.date! >= '2026-09-17' && h!.date! <= '2026-09-26')).toBe(true);
  });

  it('lists the age groups each PDF has a record in', () => {
    const groups = (gender: string) => [...new Set(records.filter((r) => r.gender === gender).map((r) => r.ageCategory))];
    expect(groups('Men')).toEqual([35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90].map((a) => `Masters ${a}`));
    // Nobody holds a W85+ record.
    expect(groups('Women')).toEqual([35, 40, 45, 50, 55, 60, 65, 70, 75, 80].map((a) => `Masters ${a}`));
  });

  it('reads rows exactly', () => {
    expect(find('Men', 35, '110+kg')).toEqual({
      recordType: 'USAMW',
      ageCategory: 'Masters 35',
      gender: 'Men',
      weightClass: '110+kg',
      snatchRecord: 148,
      cjRecord: 195,
      totalRecord: 340,
      snatchBy: { name: 'ALBURY Dimitri', date: '2026-03-29', location: 'National Masters, Little Rock, AR' },
      cjBy: { name: 'ALBURY Dimitri', date: '2026-09-26', location: 'World Masters, Athens, Greece' },
      totalBy: { name: 'ALBURY Dimitri', date: '2026-09-26', location: 'World Masters, Athens, Greece' },
    });
    expect(find('Men', 40, '75kg')).toMatchObject({
      snatchRecord: 107,
      cjRecord: 130,
      totalRecord: 237,
      snatchBy: { name: 'TAN CASTELLANOS Yicay', date: '2026-03-27', location: 'National Masters, Little Rock, AR' },
    });
    expect(find('Men', 45, '70kg')).toMatchObject({
      snatchRecord: 94,
      cjRecord: 115,
      totalRecord: 209,
      totalBy: { name: 'FLORENDO Sid', date: '2026-05-29', location: 'Pan American Masters, San Salvador, ES' },
    });
    expect(find('Men', 85, '60kg')).toMatchObject({
      snatchRecord: 26,
      cjRecord: 25,
      totalRecord: 48,
      snatchBy: { name: 'NOWOTNY Ben', date: '2025-09-04', location: 'World Masters, Las Vegas, NV' },
      cjBy: { name: 'NOWOTNY Ben', date: '2025-05-14', location: 'Pan American Masters, Baton Rouge, LA' },
    });
    expect(find('Women', 40, '86kg')).toMatchObject({ snatchRecord: 79, cjRecord: 95, totalRecord: 174, totalBy: { name: 'ONG Jaquelin', date: '2026-09-24' } });
    expect(find('Women', 55, '69kg')).toMatchObject({ snatchRecord: 48, cjRecord: 65, totalRecord: 113, snatchBy: { name: 'NICHOLS Stacy', date: '2026-09-19' } });
    expect(find('Women', 55, '77kg')).toMatchObject({
      snatchRecord: 62,
      cjRecord: 78,
      totalRecord: 137,
      snatchBy: { name: 'PICKING Michelle', date: '2026-07-10', location: 'Elite Masters Invitational, Savannah, GA' },
      cjBy: { name: 'PICKING Michelle', date: '2025-12-12', location: 'Howard Cohen American Masters, Louisville, KY' },
    });
    // A class with no lifts at all is not listed; one with some keeps the rest empty.
    expect(find('Men', 35, '60kg')).toBeDefined();
    expect(find('Men', 45, '60kg')).toBeUndefined();
  });
});
