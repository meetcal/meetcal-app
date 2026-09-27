import { inferWeightCategory, normalizeResultName, parseUsamwResults, slugEventId, type PdfWord } from '../../convex/scrapers/parse/usamwResults';

/** A line of words at `y`, spaced out left to right; `*` marks a red (missed) attempt. */
function line(y: number, texts: string[], xs?: number[]): PdfWord[] {
  return texts.map((text, i) => ({ text: text.replace(/\*$/, ''), x: xs ? xs[i] : 20 + i * 40, y, isRed: text.endsWith('*') }));
}

describe('USAMW result PDFs (port of usamw_results.py)', () => {
  it('normalizes names, classes and event ids', () => {
    expect(normalizeResultName('GUNTHER Susan')).toBe('Susan Gunther');
    expect(normalizeResultName("O'NEIL MARY Anne (ADT2)")).toBe("Anne O'neil Mary");
    expect(normalizeResultName('SOLO')).toBeNull();
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
});
