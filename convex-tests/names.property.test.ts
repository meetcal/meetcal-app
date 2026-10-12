import * as fc from 'fast-check';

import { hostileStringArb } from '@/test-support/arbitraries';

import { cleanNameList, distinctNameKeys, normalizeName, requestedNamesByKey } from '../convex/lib/names';

/** Whitespace `\s` matches, ASCII and not. */
const SPACES = [' ', '\t', '\n', '\r', '\v', '\f', ' ', ' ', ' ', '　', '﻿'] as const;
const spaceRunArb = fc.array(fc.constantFrom(...SPACES), { minLength: 1, maxLength: 4 }).map((run) => run.join(''));

/** Names as scraped: words with letters of several scripts and cases, padded with odd whitespace. */
const wordArb = fc.string({
  unit: fc.constantFrom('a', 'B', 'é', 'Á', 'ß', 'İ', 'ı', 'Σ', 'ς', 'Ж', '-', "'", '.', '😀', 'ǅ', 'K'),
  minLength: 1,
  maxLength: 8,
});
const nameArb = fc.oneof(
  { weight: 3, arbitrary: fc.array(wordArb, { minLength: 1, maxLength: 4 }).map((words) => words.join(' ')) },
  { weight: 1, arbitrary: hostileStringArb },
);

/** `name` with every space between words widened to a run of whitespace, and padded. */
const respacedArb = (name: string) =>
  fc
    .tuple(spaceRunArb, spaceRunArb, fc.array(spaceRunArb, { minLength: 8, maxLength: 8 }))
    .map(([lead, trail, gaps]) => {
      const words = name.split(/\s+/).filter(Boolean);
      return lead + words.map((word, i) => (i === 0 ? word : gaps[i % gaps.length] + word)).join('') + trail;
    });

const namesArb = fc.array(nameArb, { maxLength: 30 });

describe('normalizeName (property)', () => {
  it('is idempotent', () => {
    fc.assert(
      fc.property(nameArb, (name) => {
        const key = normalizeName(name);
        expect(normalizeName(key)).toBe(key);
      }),
    );
  });

  it('leaves no outer whitespace, no whitespace but single spaces, no upper case', () => {
    fc.assert(
      fc.property(nameArb, (name) => {
        const key = normalizeName(name);
        expect(key).toBe(key.trim());
        expect(key).not.toMatch(/[^\S ]| {2}/);
        expect(key).toBe(key.toLowerCase());
      }),
    );
  });

  it('ignores how much whitespace, and which kind, separates and pads the words', () => {
    fc.assert(
      fc.property(
        nameArb.chain((name) => fc.tuple(fc.constant(name), respacedArb(name))),
        ([name, respaced]) => {
          expect(normalizeName(respaced)).toBe(normalizeName(name));
        },
      ),
    );
  });

  // Case-insensitive as Postgres `lower()` is: two spellings match when they
  // lower-case alike. Upper-casing is not undone in general ('ß' upper-cases
  // to 'SS'), so that direction is only claimed for ASCII.
  it('ignores case: any spelling that lower-cases alike, and any ASCII casing', () => {
    fc.assert(
      fc.property(nameArb, (name) => {
        expect(normalizeName(name.toLowerCase())).toBe(normalizeName(name));
      }),
    );
    fc.assert(
      fc.property(fc.string({ unit: fc.constantFrom('a', 'Z', 'q', 'M', ' ', '-', "'") }), (name) => {
        expect(normalizeName(name.toUpperCase())).toBe(normalizeName(name));
      }),
    );
  });

  it('example: whitespace that is not ASCII folds too', () => {
    expect(normalizeName('  Zoë　ADAMS﻿')).toBe('zoë adams');
  });
});

describe('cleanNameList (property)', () => {
  it('keeps the trimmed non-empty names, in order, duplicates and all', () => {
    fc.assert(
      fc.property(namesArb, (names) => {
        const cleaned = cleanNameList(names);
        expect(cleaned).toEqual(names.map((name) => name.trim()).filter((name) => name !== ''));
        expect(cleaned.length).toBeLessThanOrEqual(names.length);
        for (const name of cleaned) {
          expect(name).toBe(name.trim());
          expect(name).not.toBe('');
        }
        expect(cleanNameList(cleaned)).toEqual(cleaned);
      }),
    );
  });
});

describe('distinctNameKeys (property)', () => {
  it('holds each folded key once, in first-seen order, and no others', () => {
    fc.assert(
      fc.property(namesArb, (names) => {
        const keys = distinctNameKeys(names);
        expect(new Set(keys).size).toBe(keys.length);
        expect(keys.length).toBeLessThanOrEqual(names.length);
        const folded = names.map(normalizeName);
        expect(new Set(keys)).toEqual(new Set(folded));
        const firstSeen = keys.map((key) => folded.indexOf(key));
        expect(firstSeen).toEqual([...firstSeen].sort((a, b) => a - b));
      }),
    );
  });

  it('gives the same keys whatever the spacing of the request', () => {
    fc.assert(
      fc.property(
        namesArb.chain((names) => fc.tuple(fc.constant(names), fc.tuple(...names.map(respacedArb)))),
        ([names, respaced]) => {
          expect(distinctNameKeys(respaced)).toEqual(distinctNameKeys(names));
        },
      ),
    );
  });
});

describe('requestedNamesByKey (property)', () => {
  it('groups every spelling under its key, keys in the order distinctNameKeys gives', () => {
    fc.assert(
      fc.property(namesArb, (names) => {
        const byKey = requestedNamesByKey(names);
        expect([...byKey.keys()]).toEqual(distinctNameKeys(names));
        for (const [key, spellings] of byKey) {
          expect(spellings).toEqual(names.filter((name) => normalizeName(name) === key));
        }
        expect([...byKey.values()].flat()).toHaveLength(names.length);
      }),
    );
  });
});
