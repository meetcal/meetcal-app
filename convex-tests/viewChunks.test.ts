import { readStatsViewItems, statsViewItems, type StatsRow } from '../convex/lib/meetData';
import { joinJsonChunks, jsonChunks, textChunks } from '../convex/lib/views';

function statsRow(i: number): StatsRow {
  return {
    key: `lifter ${i}`,
    name: `Lifter ${i} ${'x'.repeat(40)}`,
    club: `Club ${i % 300}`,
    weight_class: '89',
    body_weight: 88.4,
    attempts: [100, -105, 105, 130, 135, -140],
    snatch_best: 105,
    cj_best: 135,
    total: 240,
    placings: [3, 2, 2],
    previous_best: i % 7 === 0 ? null : 230,
  };
}

describe('view chunks', () => {
  it('join a multi-chunk JSON array back into one parseable array', () => {
    const items = Array.from({ length: 30_000 }, (_, i) => [`bigram-${i}`, i, 'x'.repeat(40)]);
    const chunks = jsonChunks(items);
    expect(chunks.length).toBeGreaterThan(1);
    expect(JSON.parse(joinJsonChunks(chunks))).toEqual(items);
    // What a plain join would have produced: not JSON.
    expect(() => JSON.parse(chunks.join(''))).toThrow();
  });

  it('keep an empty array parseable', () => {
    expect(JSON.parse(joinJsonChunks(jsonChunks([])))).toEqual([]);
  });

  it('cut text into chunks that join back exactly', () => {
    const text = 'Zoë Adams\n'.repeat(200_000);
    const chunks = textChunks(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(text);
  });

  it('never split a surrogate pair across chunks', () => {
    const size = textChunks('a'.repeat(3_000_000))[0].length;
    // An astral character straddling the first boundary.
    const text = `${'a'.repeat(size - 1)}😀${'b'.repeat(10)}`;
    const chunks = textChunks(text);
    expect(chunks.join('')).toBe(text);
    for (const chunk of chunks) {
      expect(/[\uD800-\uDBFF]$/.test(chunk)).toBe(false);
      expect(/^[\uDC00-\uDFFF]/.test(chunk)).toBe(false);
    }
  });

  it('cut a national meet\'s stats view over 1 MiB into chunks the reader puts back together', () => {
    const rows = Array.from({ length: 6000 }, (_, i) => statsRow(i));
    const clubCounts: [string, number][] = Array.from({ length: 300 }, (_, i) => [`Club ${i}`, 20]);
    const chunks = jsonChunks(statsViewItems(rows, clubCounts));
    expect(chunks.join('').length).toBeGreaterThan(1024 * 1024);
    expect(chunks.length).toBeGreaterThan(1);
    // Every chunk fits in a document with room to spare.
    for (const chunk of chunks) expect(chunk.length).toBeLessThan(800 * 1024);
    expect(readStatsViewItems(JSON.parse(joinJsonChunks(chunks)) as unknown[])).toEqual({ rows, club_counts: clubCounts });
  });

  it('still read a stats view built as one `{ rows, club_counts }` item', () => {
    const rows = [statsRow(1), statsRow(2)];
    const legacy = JSON.parse(joinJsonChunks(jsonChunks([{ rows, club_counts: [['Club 1', 1]] }]))) as unknown[];
    expect(readStatsViewItems(legacy)).toEqual({ rows, club_counts: [['Club 1', 1]] });
    expect(readStatsViewItems(statsViewItems([], []))).toEqual({ rows: [], club_counts: [] });
  });

  it('reject a stats view of neither form', () => {
    expect(() => readStatsViewItems([])).toThrow('malformed stats view');
    expect(() => readStatsViewItems([{ rows: 'no' }])).toThrow('malformed stats view');
  });
});
