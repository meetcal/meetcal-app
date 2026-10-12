import * as fc from 'fast-check';

import { MAX_CHUNK_BYTES, joinJsonChunks, jsonChunks, textChunks, utf8Length } from '../convex/lib/views';

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

/**
 * A run of one character sized to land a chunk boundary near it in bytes: just
 * under, at and just over the byte cap, its half and its third.
 */
const byteBoundaryRunArb = fc
  .tuple(fc.constantFrom(...WIDE_CHARS), fc.constantFrom(1, 2, 3), fc.integer({ min: -3, max: 3 }))
  .map(([char, share, delta]) =>
    char.repeat(Math.max(0, Math.floor(MAX_CHUNK_BYTES / (utf8Bytes(char) * share)) + delta)),
  );

/** A few characters of each width, to shift where the boundary runs start. */
const wideBitArb = fc.array(fc.constantFrom(...WIDE_CHARS), { maxLength: 7 }).map((chars) => chars.join(''));

/** Text mixing one-, two-, three- and four-byte characters around the byte cap. */
const wideTextArb = fc
  .array(
    fc.oneof(
      { weight: 2, arbitrary: byteBoundaryRunArb },
      { weight: 2, arbitrary: wideBitArb },
      { weight: 1, arbitrary: fc.string({ unit: 'binary', maxLength: 20 }) },
    ),
    { maxLength: 4 },
  )
  .map((parts) => parts.join(''));

/** JSON items of wide text: strings near the byte cap, and small values. */
const wideItemArb: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 2, arbitrary: byteBoundaryRunArb.map((run) => run.slice(0, Math.max(0, run.length - 4))) },
  { weight: 1, arbitrary: wideBitArb },
  { weight: 1, arbitrary: fc.jsonValue({ maxDepth: 1 }) },
);
const wideItemsArb = fc.array(wideItemArb, { maxLength: 5 });

/**
 * The chunkers as they were before the byte cap (a character cap only), as an
 * oracle: the chunks they made that fit the byte cap are what is stored today,
 * and the current chunkers must still make exactly those.
 */
const OLD_MAX_CHUNK_CHARS = 700 * 1024;

function oldJsonChunks(items: readonly unknown[]): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let chars = 2;
  for (const item of items) {
    const text = JSON.stringify(item) ?? 'null';
    if (current.length > 0 && chars + text.length + 1 > OLD_MAX_CHUNK_CHARS) {
      chunks.push(`[${current.join(',')}]`);
      current = [];
      chars = 2;
    }
    current.push(text);
    chars += text.length + 1;
  }
  chunks.push(`[${current.join(',')}]`);
  return chunks;
}

function oldTextChunks(text: string): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; ) {
    let end = Math.min(i + OLD_MAX_CHUNK_CHARS, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
    chunks.push(text.slice(i, end));
    i = end;
  }
  return chunks.length > 0 ? chunks : [''];
}

const withinBytes = (chunks: readonly string[]) => chunks.every((chunk) => utf8Bytes(chunk) <= MAX_CHUNK_BYTES);

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

describe('the byte cap', () => {
  it('leaves room in a Convex document for the rest of a view_chunks row', () => {
    expect(MAX).toBe(OLD_MAX_CHUNK_CHARS);
    // A row is the text plus `key`, `index`, `_id` and `_creationTime`.
    expect(CONVEX_DOCUMENT_BYTES - MAX_CHUNK_BYTES).toBeGreaterThanOrEqual(32 * 1024);
  });

  it('utf8Length counts what a UTF-8 encoder writes, lone surrogates included', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string({ unit: 'binary', maxLength: 40 }), wideBitArb), (text) => {
        expect(utf8Length(text)).toBe(utf8Bytes(text));
      }),
    );
  });
});

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

  // Regression: the limit used to count only UTF-16 code units, but Convex
  // stores strings as UTF-8 and caps a document at 1 MiB, so a chunk of 700 Ki
  // code units could be 2.1 MB of three-byte characters (CJK) and writeView's
  // insert would fail. Chunks are now also capped at MAX_CHUNK_BYTES.
  it('keep every chunk within a Convex document, counted in UTF-8 bytes', () => {
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

  // An item can't be split (every chunk is an array), so one over the byte cap
  // on its own still gets a chunk to itself; every other chunk is within the cap.
  it('keep every chunk within the byte cap, unless it holds one item too big to split', () => {
    fc.assert(
      fc.property(wideItemsArb, (items) => {
        const chunks = jsonChunks(items);
        expect(joinJsonChunks(chunks)).toBe(JSON.stringify(items));
        for (const chunk of chunks) {
          const parsed: unknown = JSON.parse(chunk);
          if (!Array.isArray(parsed)) throw new Error(`chunk is not an array: ${chunk.slice(0, 40)}`);
          if (items.length > 0) expect(parsed.length).toBeGreaterThan(0);
          if (utf8Bytes(chunk) > MAX_CHUNK_BYTES || chunk.length > MAX) expect(parsed.length).toBe(1);
        }
      }),
    );
  });

  it('cut no earlier than needed: the next chunk’s first item would not have fit, in bytes or characters', () => {
    fc.assert(
      fc.property(wideItemsArb, (items) => {
        const chunks = jsonChunks(items);
        for (let i = 1; i < chunks.length; i++) {
          const first = textOf((JSON.parse(chunks[i]) as unknown[])[0]);
          const bytesOver = utf8Bytes(chunks[i - 1]) + 1 + utf8Bytes(first) > MAX_CHUNK_BYTES;
          const charsOver = chunks[i - 1].length + first.length + 1 >= MAX;
          expect(bytesOver || charsOver).toBe(true);
        }
      }),
    );
  });

  // Stored chunks keep their boundaries: the byte cap only re-cuts chunks that
  // were over it, which Convex could never have stored.
  it('make the same chunks as before the byte cap whenever those all fit it (ASCII always does)', () => {
    fc.assert(
      fc.property(fc.oneof(itemsArb, wideItemsArb), (items) => {
        const old = oldJsonChunks(items);
        if (withinBytes(old)) expect(jsonChunks(items)).toEqual(old);
      }),
    );
  });

  it('make exactly the chunks it made before the byte cap, for ASCII items', () => {
    const asciiItemArb = fc.oneof(
      { weight: 3, arbitrary: fc.jsonValue({ maxDepth: 2, stringUnit: 'grapheme-ascii' }) },
      { weight: 1, arbitrary: boundaryRunArb },
    );
    fc.assert(
      fc.property(fc.array(asciiItemArb, { maxLength: 8 }), (items) => {
        expect(jsonChunks(items)).toEqual(oldJsonChunks(items));
      }),
    );
  });

  // Regression (same as above): this was one chunk of 1,200,005 bytes. (A
  // single item that big still gets one chunk, since items are not split.)
  it('example: 400,000 three-byte characters in two items no longer share a chunk', () => {
    const items = ['中'.repeat(200_000), '中'.repeat(200_000)];
    expect(oldJsonChunks(items)).toHaveLength(1);
    const chunks = jsonChunks(items);
    expect(chunks).toEqual(items.map((item) => JSON.stringify([item])));
    for (const chunk of chunks) expect(utf8Bytes(chunk)).toBeLessThanOrEqual(CONVEX_DOCUMENT_BYTES);
    expect(joinJsonChunks(chunks)).toBe(JSON.stringify(items));
  });

  it('example: a chunk of exactly the byte cap stays whole; one more item starts a second', () => {
    const fits = ['é'.repeat((MAX_CHUNK_BYTES - 4) / 2)]; // `["…"]` is the cap exactly
    expect(utf8Bytes(JSON.stringify(fits))).toBe(MAX_CHUNK_BYTES);
    expect(jsonChunks(fits)).toEqual([JSON.stringify(fits)]);
    const items = ['é'.repeat((MAX_CHUNK_BYTES - 6) / 2), 0]; // `["…",0]` is the cap exactly
    expect(utf8Bytes(JSON.stringify(items))).toBe(MAX_CHUNK_BYTES);
    expect(jsonChunks(items)).toEqual([JSON.stringify(items)]);
    expect(jsonChunks([...items, 1])).toEqual([JSON.stringify(items), '[1]']);
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

  // Regression: as for jsonChunks, the limit used to be in code units only,
  // not UTF-8 bytes; chunks are now also capped at MAX_CHUNK_BYTES.
  it('keep every chunk within a Convex document, counted in UTF-8 bytes', () => {
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

  // Regression (same as above): this was one chunk of 1,200,000 bytes.
  it('example: 400,000 three-byte characters fit in one document', () => {
    const text = '中'.repeat(400_000);
    expect(oldTextChunks(text)).toHaveLength(1);
    const chunks = textChunks(text);
    expect(chunks.map((chunk) => chunk.length)).toEqual([333_333, 66_667]);
    for (const chunk of chunks) expect(utf8Bytes(chunk)).toBeLessThanOrEqual(CONVEX_DOCUMENT_BYTES);
  });

  it('cut wide text within both caps, joining back exactly, never inside a pair nor earlier than needed', () => {
    fc.assert(
      fc.property(wideTextArb, (text) => {
        const chunks = textChunks(text);
        expect(chunks.join('')).toBe(text);
        if (text === '') expect(chunks).toEqual(['']);
        for (const chunk of chunks) {
          if (text !== '') expect(chunk.length).toBeGreaterThan(0);
          expect(chunk.length).toBeLessThanOrEqual(MAX);
          expect(utf8Bytes(chunk)).toBeLessThanOrEqual(MAX_CHUNK_BYTES);
        }
        for (let i = 1; i < chunks.length; i++) {
          const before = chunks[i - 1];
          expect(isHigh(before[before.length - 1]) && isLow(chunks[i][0])).toBe(false);
          // The next code point would not have fit, in bytes or characters.
          const next = String.fromCodePoint(chunks[i].codePointAt(0) ?? 0);
          const bytesFull = utf8Bytes(before) + utf8Bytes(next) > MAX_CHUNK_BYTES;
          expect(bytesFull || before.length >= MAX - 1).toBe(true);
        }
      }),
    );
  });

  // Stored chunks keep their boundaries: the byte cap only re-cuts chunks that
  // were over it, which Convex could never have stored.
  it('make the same chunks as before the byte cap whenever those all fit it (ASCII always does)', () => {
    fc.assert(
      fc.property(fc.oneof(textArb, wideTextArb), (text) => {
        const old = oldTextChunks(text);
        if (withinBytes(old)) expect(textChunks(text)).toEqual(old);
      }),
    );
  });

  it('make exactly the chunks it made before the byte cap, for ASCII text', () => {
    const asciiTextArb = fc
      .array(fc.oneof(boundaryRunArb, fc.string({ unit: 'grapheme-ascii', maxLength: 20 })), { maxLength: 6 })
      .map((parts) => parts.join(''));
    fc.assert(
      fc.property(asciiTextArb, (text) => {
        expect(textChunks(text)).toEqual(oldTextChunks(text));
      }),
    );
  });

  it('example: a four-byte character that would pass the byte cap moves whole into the next chunk', () => {
    // 'abc' and 249,999 pairs is 999,999 bytes; one more pair would pass the cap.
    const text = `abc${'😀'.repeat(250_000)}`;
    const chunks = textChunks(text);
    expect(chunks).toEqual([`abc${'😀'.repeat(249_999)}`, '😀']);
    expect(utf8Bytes(chunks[0])).toBe(MAX_CHUNK_BYTES - 1);
  });
});
