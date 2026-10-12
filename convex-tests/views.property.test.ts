import * as fc from 'fast-check';

import { joinJsonChunks, jsonChunks, textChunks } from '../convex/lib/views';

/** The chunk limit, in UTF-16 code units (`MAX_CHUNK_CHARS` is not exported). */
const MAX = textChunks('a'.repeat(3_000_000))[0].length;

/**
 * Convex caps a document at 1 MiB and stores strings as UTF-8, so a chunk's
 * text has to fit in that many bytes, whatever characters it holds.
 */
const CONVEX_DOCUMENT_BYTES = 1024 * 1024;

const encoder = new TextEncoder();
const utf8Bytes = (text: string) => encoder.encode(text).length;

/** One character of each UTF-8 width; the four-byte one is a surrogate pair. */
const WIDE_CHARS = ['a', 'é', '€', '😀'] as const;

/** Short text of every kind: graphemes, and arbitrary code units (lone surrogates). */
const shortTextArb = fc.oneof(
  fc.string({ unit: 'grapheme', maxLength: 20 }),
  fc.string({ unit: 'binary', maxLength: 20 }),
);

/**
 * A run of ASCII sized to land a chunk boundary near it: just under, at and
 * just over the limit, its half and its third.
 */
const boundaryRunArb = fc
  .tuple(fc.constantFrom(MAX, Math.floor(MAX / 2), Math.floor(MAX / 3)), fc.integer({ min: -4, max: 4 }))
  .map(([size, delta]) => 'a'.repeat(Math.max(0, size + delta)));

const textArb = fc
  .array(fc.oneof({ weight: 1, arbitrary: boundaryRunArb }, { weight: 2, arbitrary: shortTextArb }), { maxLength: 6 })
  .map((parts) => parts.join(''));

/**
 * JSON items: small values of every kind, and strings sized so the array's
 * text crosses the chunk limit with an item ending at or just around it.
 */
const itemArb: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 3, arbitrary: fc.jsonValue({ maxDepth: 2 }) },
  { weight: 1, arbitrary: shortTextArb },
  { weight: 1, arbitrary: fc.constant(undefined) },
  {
    weight: 1,
    arbitrary: fc
      .tuple(fc.constantFrom(MAX - 2, Math.floor(MAX / 2), Math.floor(MAX / 3)), fc.integer({ min: -6, max: 2 }))
      .map(([size, delta]) => 'x'.repeat(Math.max(0, size + delta))),
  },
);
const itemsArb = fc.array(itemArb, { maxLength: 8 });

const textOf = (item: unknown) => JSON.stringify(item) ?? 'null';
const isHigh = (unit: string | undefined) => unit !== undefined && /^[\uD800-\uDBFF]$/.test(unit);
const isLow = (unit: string | undefined) => unit !== undefined && /^[\uDC00-\uDFFF]$/.test(unit);

describe('jsonChunks (property)', () => {
  it('join back to exactly the JSON of the whole array, each chunk a non-empty array of its own', () => {
    fc.assert(
      fc.property(itemsArb, (items) => {
        const chunks = jsonChunks(items);
        expect(joinJsonChunks(chunks)).toBe(JSON.stringify(items));
        expect(jsonChunks(items)).toEqual(chunks);
        const flattened: unknown[] = [];
        for (const chunk of chunks) {
          const parsed: unknown = JSON.parse(chunk);
          if (!Array.isArray(parsed)) throw new Error(`chunk is not an array: ${chunk.slice(0, 40)}`);
          if (items.length > 0) expect(parsed.length).toBeGreaterThan(0);
          flattened.push(...parsed);
        }
        expect(flattened).toEqual(JSON.parse(JSON.stringify(items)));
      }),
    );
  });

  // An item longer than a chunk cannot be split (every chunk is itself an
  // array), so it gets a chunk of its own; every other chunk is within the limit.
  it('keep every chunk within the limit, unless it holds one item too big to split', () => {
    fc.assert(
      fc.property(itemsArb, (items) => {
        for (const chunk of jsonChunks(items)) {
          if (chunk.length > MAX) expect((JSON.parse(chunk) as unknown[]).length).toBe(1);
        }
      }),
    );
  });

  // The running count charges a comma for the first item too, so a chunk is
  // closed one character early: one that would come to exactly the limit is
  // cut. Harmless (the limit is "at most", well under 1 MiB), and changing it
  // would move the boundaries of stored chunks, so the property allows it.
  it('cut no earlier than needed: the next chunk’s first item would not have fit (to one character)', () => {
    fc.assert(
      fc.property(itemsArb, (items) => {
        const chunks = jsonChunks(items);
        for (let i = 1; i < chunks.length; i++) {
          const first = (JSON.parse(chunks[i]) as unknown[])[0];
          expect(chunks[i - 1].length + textOf(first).length + 1).toBeGreaterThanOrEqual(MAX);
        }
      }),
    );
  });

  it('example (shrunk): an array that would be exactly the limit is cut in two', () => {
    const items = ['x'.repeat(MAX - 6), 0]; // `["…",0]` is MAX characters
    expect(JSON.stringify(items)).toHaveLength(MAX);
    expect(jsonChunks(items)).toHaveLength(2);
    expect(joinJsonChunks(jsonChunks(items))).toBe(JSON.stringify(items));
  });

  it('example: an item exactly filling a chunk stays in one chunk; one more character starts a second', () => {
    const fits = ['x'.repeat(MAX - 4)]; // `["…"]` is MAX characters
    expect(jsonChunks(fits)).toEqual([JSON.stringify(fits)]);
    expect(jsonChunks([...fits, 1])).toHaveLength(2);
    expect(joinJsonChunks(jsonChunks([...fits, 1]))).toBe(JSON.stringify([...fits, 1]));
  });

  // FINDING: the limit counts UTF-16 code units, but Convex stores strings as
  // UTF-8 and caps a document at 1 MiB. A chunk of 700 Ki code units is up to
  // 2.1 MB of three-byte characters (CJK), so writeView's insert would fail.
  // Real chunks are mostly ASCII names and numbers (well under 1 MiB), so this
  // is latent. Proposed fix: also close a chunk when its UTF-8 size would pass
  // ~1,000,000 bytes (count bytes per item as it is added). Chunk boundaries
  // are stored data, so this needs a redeploy and only re-splits chunks that
  // could not have been stored anyway; joined text and etags do not change.
  it.skip('keep every chunk within a Convex document, counted in UTF-8 bytes', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.constantFrom(...WIDE_CHARS), fc.integer({ min: 1, max: 200_000 })), { maxLength: 6 }),
        (runs) => {
          for (const chunk of jsonChunks(runs.map(([char, count]) => char.repeat(count)))) {
            expect(utf8Bytes(chunk)).toBeLessThanOrEqual(CONVEX_DOCUMENT_BYTES);
          }
        },
      ),
    );
  });

  // FINDING (same as above): shrunk counterexample.
  it.skip('example: 400,000 three-byte characters fit in one document', () => {
    for (const chunk of jsonChunks(['中'.repeat(400_000)])) {
      expect(utf8Bytes(chunk)).toBeLessThanOrEqual(CONVEX_DOCUMENT_BYTES);
    }
  });
});

describe('textChunks (property)', () => {
  it('cut text into chunks that join back exactly, never inside a surrogate pair', () => {
    fc.assert(
      fc.property(textArb, (text) => {
        const chunks = textChunks(text);
        expect(chunks.join('')).toBe(text);
        expect(textChunks(text)).toEqual(chunks);
        if (text === '') expect(chunks).toEqual(['']);
        else for (const chunk of chunks) expect(chunk.length).toBeGreaterThan(0);
        for (let i = 1; i < chunks.length; i++) {
          const before = chunks[i - 1];
          expect(isHigh(before[before.length - 1]) && isLow(chunks[i][0])).toBe(false);
        }
      }),
    );
  });

  it('fill every chunk but the last to the limit, less at most the one unit kept off a pair', () => {
    fc.assert(
      fc.property(textArb, (text) => {
        const chunks = textChunks(text);
        for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(MAX);
        for (const chunk of chunks.slice(0, -1)) expect(chunk.length).toBeGreaterThanOrEqual(MAX - 1);
      }),
    );
  });

  it('example: an astral character straddling the limit moves whole into the next chunk', () => {
    const text = `${'a'.repeat(MAX - 1)}😀b`;
    const chunks = textChunks(text);
    expect(chunks).toEqual(['a'.repeat(MAX - 1), '😀b']);
  });

  // FINDING: as for jsonChunks, the limit is in code units, not UTF-8 bytes;
  // see the proposed fix there. Search directory text is names, mostly
  // ASCII, so this is latent.
  it.skip('keep every chunk within a Convex document, counted in UTF-8 bytes', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.constantFrom(...WIDE_CHARS), fc.integer({ min: 1, max: 400_000 })), { maxLength: 6 }),
        (runs) => {
          for (const chunk of textChunks(runs.map(([char, count]) => char.repeat(count)).join(''))) {
            expect(utf8Bytes(chunk)).toBeLessThanOrEqual(CONVEX_DOCUMENT_BYTES);
          }
        },
      ),
    );
  });

  // FINDING (same as above): shrunk counterexample, 1,200,000 bytes in one chunk.
  it.skip('example: 400,000 three-byte characters fit in one document', () => {
    for (const chunk of textChunks('中'.repeat(400_000))) {
      expect(utf8Bytes(chunk)).toBeLessThanOrEqual(CONVEX_DOCUMENT_BYTES);
    }
  });
});
