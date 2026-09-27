import { joinJsonChunks, jsonChunks, textChunks } from '../convex/lib/views';

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
});
