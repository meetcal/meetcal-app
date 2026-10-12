import * as fc from 'fast-check';

import { hostileStringArb } from '@/test-support/arbitraries';

import { normalizeAgeCategory, normalizeFederation, normalizeGender, titleCase } from '../convex/lib/normalize';

const SPACES = [' ', '\t', '\n', ' ', '　', '﻿'] as const;
const padArb = fc.array(fc.constantFrom(...SPACES), { maxLength: 3 }).map((run) => run.join(''));

/** `text` with each ASCII letter's case flipped at random. */
const recasedArb = (text: string) =>
  fc
    .array(fc.boolean(), { minLength: text.length, maxLength: text.length })
    .map((flips) => [...text].map((ch, i) => (flips[i] ? ch.toUpperCase() : ch.toLowerCase())).join(''));

/** What the scrapers send, and what they should never send. */
const valueArb = fc.oneof(
  hostileStringArb,
  fc.string({ unit: fc.constantFrom('a', 'B', 'é', 'Ж', 'σ', 'ς', 'İ', 'ı', ' ', '\t', '1', '-', '😀'), maxLength: 12 }),
);

/**
 * Words whose first character upper-cases to a single code unit that is
 * already upper case. `titleCase` is a port of the Python writer's
 * `part[:1].upper() + part[1:].lower()`, which is not idempotent for a word
 * starting with a character like 'ß' (upper-cases to 'SS', which a second
 * pass makes 'Ss'); that is the behavior rows were written with, so the
 * idempotence property is claimed for the other words only (see the example).
 */
const singleUpper = (value: string) =>
  value
    .trim()
    .split(/\s+/)
    .every((part) => {
      const upper = part.slice(0, 1).toUpperCase();
      return upper.length <= 1 && upper.toUpperCase() === upper;
    });

describe('titleCase (property)', () => {
  it('never throws, trims, and leaves single spaces between words', () => {
    fc.assert(
      fc.property(valueArb, (value) => {
        const titled = titleCase(value);
        expect(titled).toBe(titled.trim());
        expect(titled).not.toMatch(/[^\S ]| {2}/);
        expect(titled.split(' ').filter(Boolean)).toHaveLength(value.trim().split(/\s+/).filter(Boolean).length);
      }),
    );
  });

  it('is idempotent for words that start with a single-unit upper-case letter', () => {
    fc.assert(
      fc.property(valueArb, (value) => {
        fc.pre(singleUpper(value));
        expect(titleCase(titleCase(value))).toBe(titleCase(value));
      }),
    );
  });

  it('ignores the case the value arrived in', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: fc.constantFrom('a', 'q', 'z', ' ', '1', '-'), maxLength: 12 }).chain((value) =>
          fc.tuple(fc.constant(value), recasedArb(value)),
        ),
        ([value, recased]) => {
          expect(titleCase(recased)).toBe(titleCase(value));
        },
      ),
    );
  });

  it('example (shrunk): a word starting with ß titles as the Python writer did, and not idempotently', () => {
    expect(titleCase('ß')).toBe('SS');
    expect(titleCase('SS')).toBe('Ss');
  });
});

describe('normalizeGender (property)', () => {
  const CANONICAL: Record<string, string> = {
    men: 'Men',
    women: 'Women',
    male: 'Male',
    female: 'Female',
    m: 'Men',
    f: 'Women',
  };

  it('maps every spelling of a known gender, whatever its case and padding, to one value', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...Object.keys(CANONICAL)).chain((known) =>
          fc.tuple(fc.constant(known), recasedArb(known), padArb, padArb),
        ),
        ([known, recased, lead, trail]) => {
          expect(normalizeGender(lead + recased + trail)).toBe(CANONICAL[known]);
        },
      ),
    );
  });

  it('never throws, and title-cases anything else', () => {
    fc.assert(
      fc.property(valueArb, (value) => {
        const gender = normalizeGender(value);
        if (!(value.trim().toLowerCase() in CANONICAL)) expect(gender).toBe(titleCase(value));
      }),
    );
  });

  it('is idempotent (for words titleCase is idempotent on)', () => {
    fc.assert(
      fc.property(valueArb, (value) => {
        fc.pre(singleUpper(value));
        expect(normalizeGender(normalizeGender(value))).toBe(normalizeGender(value));
      }),
    );
  });

  // Fixed: the lookup table was an object literal, so these returned
  // `Object`, `Object.prototype` and `Object.prototype.toString`.
  it('example (shrunk): prototype keys are not genders or age codes', () => {
    expect(normalizeGender('constructor')).toBe('Constructor');
    expect(normalizeGender('__proto__')).toBe('__proto__');
    expect(normalizeGender(' toString ')).toBe('Tostring');
    expect(normalizeAgeCategory('__proto__')).toBe('__proto__');
    expect(normalizeAgeCategory('hasOwnProperty')).toBe('Hasownproperty');
  });
});

describe('normalizeAgeCategory (property)', () => {
  it('upper-cases the youth codes whatever their case, and is idempotent', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('u13', 'u15', 'u17', 'u20', 'u25').chain((code) =>
          fc.tuple(fc.constant(code), recasedArb(code), padArb),
        ),
        ([code, recased, pad]) => {
          expect(normalizeAgeCategory(pad + recased + pad)).toBe(code.toUpperCase());
        },
      ),
    );
    fc.assert(
      fc.property(valueArb, (value) => {
        fc.pre(singleUpper(value));
        expect(normalizeAgeCategory(normalizeAgeCategory(value))).toBe(normalizeAgeCategory(value));
      }),
    );
  });
});

describe('normalizeFederation (property)', () => {
  it('upper-cases the four known federations whatever their case and padding', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('usaw', 'iwf', 'umwf', 'bwl').chain((code) =>
          fc.tuple(fc.constant(code), recasedArb(code), padArb, padArb),
        ),
        ([code, recased, lead, trail]) => {
          expect(normalizeFederation(lead + recased + trail)).toBe(code.toUpperCase());
        },
      ),
    );
  });

  it('never throws, trims anything else and leaves its case alone, and is idempotent', () => {
    fc.assert(
      fc.property(valueArb, (value) => {
        const federation = normalizeFederation(value);
        if (!['usaw', 'iwf', 'umwf', 'bwl'].includes(value.trim().toLowerCase())) expect(federation).toBe(value.trim());
        expect(normalizeFederation(federation)).toBe(federation);
      }),
    );
  });
});
