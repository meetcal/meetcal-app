import {
  checkUsamwRows,
  inferWeightCategory,
  normalizeResultName,
  parseUsamwResults,
  parseUsamwRows,
  slugEventId,
  usamwRowProblems,
  type PdfWord,
} from '../../convex/scrapers/parse/usamwResults';

/** A line of words at `y`, spaced out left to right; `*` marks a red (missed) attempt. */
function line(y: number, texts: string[], xs?: number[]): PdfWord[] {
  return texts.map((text, i) => ({ text: text.replace(/\*$/, ''), x: xs ? xs[i] : 20 + i * 40, y, isRed: text.endsWith('*') }));
}

describe('USAMW result PDFs (port of usamw_results.py)', () => {
  it('normalizes names, classes and event ids', () => {
    expect(normalizeResultName('GUNTHER Susan')).toBe('Susan Gunther');
    expect(normalizeResultName("O'NEIL MARY Anne (ADT2)")).toBe("Anne O'neil Mary");
    expect(normalizeResultName('SOLO')).toBeNull();
    // A bare adaptive marker, before or after the name (#404).
    expect(normalizeResultName('FARROW Jason ADT2')).toBe('Jason Farrow');
    expect(normalizeResultName('ADT2 FARROW Jason')).toBe('Jason Farrow');
    expect(normalizeResultName('GILLSON Susan ADT')).toBe('Susan Gillson');
    expect(normalizeResultName('LOVE Samantha [ADT2]')).toBe('Samantha Love');
    expect(normalizeResultName('ADTKINS Mary')).toBe('Mary Adtkins');
    expect(inferWeightCategory('W70', 66.2, '2026-07-09')).toBe('69');
    expect(inferWeightCategory('M40', 72.1, '2026-08-01')).toBe('75');
    expect(inferWeightCategory('M40', 120, '2026-07-09')).toBe('110+');
    expect(slugEventId(' 2026 Elite Invitational ', '2026-07-09')).toBe('2026-elite-invitational-2026-07-09');
  });

  it('reads the QMasters attempt table, red attempts negative and the class from body weight', () => {
    const xs = [20, 40, 80, 130, 200, 290, 330, 360, 390, 420, 450, 480, 510, 540, 580];
    const page = [
      ...line(10, ['Age', 'Group', 'W70']),
      ...line(20, ['1', '113', 'PASKIEWICZ', 'Lynn', 'Unattached', '66.20', '70', '38', '40*', '40*', '48', '50', '52', '90', '266.665'], xs),
      ...line(30, ['2', '123', 'SOUTHARD', 'Marlene', 'Boise', '66.64', '73', '30', '33*', '34*', '40', '-', '46', '76', '242.260'], xs),
    ];
    const rows = parseUsamwResults([page], '2026 Elite Invitational', '2026-07-09');
    expect(rows.map((r) => [r.name, r.age, r.bodyWeight, r.snatch1, r.snatch2, r.snatch3, r.snatchBest, r.cj2, r.cjBest, r.total])).toEqual([
      ['Lynn Paskiewicz', "Women's Masters (70-74) 69kg", 66.2, 38, -40, -40, 38, 50, 52, 90],
      ['Marlene Southard', "Women's Masters (70-74) 69kg", 66.64, 30, -33, -34, 30, 0, 46, 76],
    ]);
    expect(rows[0]).toMatchObject({ eventId: '2026-elite-invitational-2026-07-09', federation: 'USAMW', date: '2026-07-09', adaptive: false });
  });

  it('prefers the per-class tables when a PDF has them', () => {
    const page = [
      ...line(10, ['Age', 'Group', 'M40', 'Weight', 'Category', '88']),
      ...line(20, ['1', '7', 'SMITH', 'John', 'USA', '87.5', '41', '100', '105*', '105', '130', '135', '140*', '240']),
    ];
    const rows = parseUsamwResults([page], 'Meet', '2026-03-29');
    expect(rows.map((r) => [r.name, r.age, r.snatch2, r.snatchBest, r.cj3, r.cjBest, r.total])).toEqual([['John Smith', "Men's Masters (40-44) 88kg", -105, 105, -140, 135, 240]]);
  });

  it('anchors the class table on the body weight past a stray lot or club number (#385)', () => {
    const page = [
      ...line(10, ['Age', 'Group', 'W65', 'Weight', 'Category', '77']),
      // `5150` before the body weight: read by position, the age became the first snatch.
      ...line(20, ['1', '9', 'TRIVIZ', 'Dolores', 'USA', '5150', '74.50', '69', '40', '43', '46*', '48', '51*', '51*', '91']),
    ];
    const rows = parseUsamwResults([page], '2026 USA Masters Nationals', '2026-03-29');
    expect(rows.map((r) => [r.name, r.bodyWeight, r.snatch1, r.snatch3, r.snatchBest, r.cj1, r.cjBest, r.total])).toEqual([
      ['Dolores Triviz', 74.5, 40, -46, 43, 48, 48, 91],
    ]);
    expect(checkUsamwRows(parseUsamwRows([page], 'Meet', '2026-03-29')).rejected).toEqual([]);
  });

  it('rejects impossible rows with their PDF line, and refuses a PDF whose misses were not read (#385)', () => {
    const page = [
      ...line(10, ['Age', 'Group', 'M45', 'Weight', 'Category', '88']),
      // A whole-number body weight with nothing to anchor on: every column read one place out.
      ...line(20, ['1', '3', 'MACARAEG', 'Frederick', 'USA', '12', '84', '48', '50', '53', '55', '65', '68', '70', '117']),
      ...line(30, ['2', '4', 'SMITH', 'John', 'USA', '87.5', '41', '100', '105*', '105', '130', '135', '140*', '240']),
    ];
    const anchored = checkUsamwRows(parseUsamwRows([page], 'Meet', '2026-03-29'));
    expect(anchored.rows.map((r) => r.name)).toEqual(['John Smith']);
    expect(anchored.rejected).toEqual([
      {
        name: 'Frederick Macaraeg',
        line: '1 3 MACARAEG Frederick USA 12 84 48 50 53 55 65 68 70 117',
        problems: ['body weight 12', 'total 70 is not snatch 53 + clean & jerk 68'],
      },
    ]);
    expect(anchored.missesUndetected).toBe(false);

    // 2026 Pan American Masters: misses not printed red, so every attempt reads as made.
    const panAm = [
      ...line(10, ['Age', 'Group', 'M35', 'Weight', 'Category', '94']),
      ...line(20, ['1', '5', 'DIROCHE', 'Neiky', 'DOM', '93.20', '36', '125', '130', '137', '160', '170', '176', '307']),
      ...line(30, ['2', '6', 'ALVAREZ', 'Anibal', 'ARG', '92.00', '38', '90', '95', '100', '115', '115', '115', '210']),
      ...line(40, ['3', '7', 'ROE', 'Sam', 'USA', '90.00', '39', '80', '85', '90', '100', '105', '110', '200']),
    ];
    const check = checkUsamwRows(parseUsamwRows([panAm], 'Pan Am', '2026-05-28'));
    expect(check.missesUndetected).toBe(true);
    expect(check.rejected.map((r) => r.name)).toEqual(['Neiky Diroche', 'Anibal Alvarez']);
  });

  it('finds body weights out of range and attempts that go down', () => {
    const row = parseUsamwResults(
      [[...line(10, ['Age', 'Group', 'W70', 'Weight', 'Category', '69']), ...line(20, ['1', '2', 'DOWNS', 'Jane', 'USA', '970', '71', '40', '38', '42', '50', '52', '55', '97'])]],
      'Meet',
      '2026-03-29',
    )[0];
    expect(usamwRowProblems(row)).toEqual(['body weight 970', 'snatch attempts 40, 38, 42 go down']);
  });
});
