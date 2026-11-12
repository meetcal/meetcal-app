import { arrayOf, mapOf, readRecordsData, readStandardsData, readStringList } from './cached-shapes';

describe('cached shapes', () => {
  it('keeps the items of a list that fit and drops the rest', () => {
    expect(readStringList(['A', 1, null, 'B'])).toEqual(['A', 'B']);
    expect(readStringList({ not: 'a list' })).toBeUndefined();
  });

  it('keeps the entries of a map that fit and drops the rest', () => {
    const readNumbers = mapOf((value) => (typeof value === 'number' ? value : undefined));
    expect(readNumbers({ a: 1, b: 'two', c: 3 })).toEqual({ a: 1, c: 3 });
    expect(readNumbers(['not', 'a', 'map'])).toBeUndefined();
    expect(arrayOf(readNumbers)([{ a: 1 }, 'x'])).toEqual([{ a: 1 }]);
  });

  it('reads records by age group and gender, with a missing lift as null', () => {
    const stored = {
      Senior: {
        Men: [{ weightClass: '60kg', snatchRecord: 126, cjRecord: 166, totalRecord: 293 }],
        Women: [{ weightClass: '48kg', snatchRecord: 'n/a', cjRecord: null, totalRecord: 200 }],
      },
      Junior: { Men: 'broken' },
    };

    expect(readRecordsData(stored)).toEqual({
      Senior: {
        Men: [{ weightClass: '60kg', snatchRecord: 126, cjRecord: 166, totalRecord: 293 }],
        Women: [{ weightClass: '48kg', snatchRecord: null, cjRecord: null, totalRecord: 200 }],
      },
    });
  });

  it('reads standards and drops a row with no weight class', () => {
    expect(
      readStandardsData({ senior: { men: [{ weightClass: '60kg', a: 281, b: 267 }, { a: 1 }] } }),
    ).toEqual({ senior: { men: [{ weightClass: '60kg', a: 281, b: 267 }] } });
  });
});
