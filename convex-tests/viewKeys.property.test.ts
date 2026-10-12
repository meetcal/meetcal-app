import * as fc from 'fast-check';

import { hostileStringArb } from '@/test-support/arbitraries';

import {
  adaptiveKey,
  escapeKeyPart,
  MEET_VIEW_PARTS,
  meetKey,
  meetSessionKey,
  meetSessionPrefix,
  meetViewsPrefix,
  natKey,
  parseViewKey,
  REF_VIEWS,
  RESULT_NAMES_VIEW,
  SEARCH_SHARD_PREFIX,
  SEARCH_SHARD_SIZES_VIEW,
  searchShardKey,
  unescapeKeyPart,
  viewDependencies,
  wsoKey,
} from '../convex/lib/viewKeys';

/**
 * Key parts: meet names, labels, the separator itself where it hurts, and the
 * escape character and the escapes themselves written literally.
 */
const partArb = fc.oneof(
  { weight: 2, arbitrary: fc.string({ unit: fc.constantFrom('a', 'B', '|', ' ', 'é', '1', '%', '7', 'C', '2', '5'), maxLength: 6 }) },
  {
    weight: 1,
    arbitrary: fc.constantFrom('', '|', '%', '%7C', '%25', '%257C', '%7c', 'session', 'session|1', 'schedule', 'Open|Men', '2026 Nationals', '50% Club'),
  },
  { weight: 1, arbitrary: hostileStringArb },
);
/** Parts free of `|` and `%`: every name stored today. */
const plainPartArb = partArb.filter((part) => !part.includes('|') && !part.includes('%'));
const sessionArb = fc.integer({ min: 0, max: 999 });
const partNameArb = fc.constantFrom(...MEET_VIEW_PARTS);

/** Every per-meet key, with the arguments that built it. */
type MeetView = { meet: string; key: string; args: string };
const meetViewArb: fc.Arbitrary<MeetView> = fc.oneof(
  fc.tuple(partArb, partNameArb).map(([meet, part]) => ({ meet, key: meetKey(meet, part), args: JSON.stringify(['part', meet, part]) })),
  fc.tuple(partArb, sessionArb).map(([meet, n]) => ({ meet, key: meetSessionKey(meet, n), args: JSON.stringify(['session', meet, n]) })),
);

/** Two-character sequences as `nameBigrams` makes them: two code points of well-formed text. */
const bigramArb = fc
  .tuple(fc.string({ unit: 'grapheme', minLength: 1, maxLength: 1 }), fc.string({ unit: 'grapheme', minLength: 1, maxLength: 1 }))
  .map(([a, b]) => [...a][0] + [...b][0]);

describe('view keys (property)', () => {
  it('give a meet view and a session view of distinct arguments distinct keys', () => {
    fc.assert(
      fc.property(meetViewArb, meetViewArb, (a, b) => {
        if (a.args !== b.args) expect(a.key).not.toBe(b.key);
      }),
    );
  });

  it('keep each family apart from every other and from the fixed keys', () => {
    const fixed = [...Object.values(REF_VIEWS), RESULT_NAMES_VIEW, SEARCH_SHARD_SIZES_VIEW];
    fc.assert(
      fc.property(meetViewArb, partArb, bigramArb, (meetView, wso, bigram) => {
        const keys = [meetView.key, wsoKey(wso), searchShardKey(bigram), natKey(wso, wso), adaptiveKey(wso, wso, wso)];
        expect(new Set(keys).size).toBe(keys.length);
        for (const key of keys) expect(fixed).not.toContain(key);
      }),
    );
  });

  it('give each wso, and each shard bigram, its own key', () => {
    fc.assert(
      fc.property(partArb, partArb, bigramArb, bigramArb, (a, b, x, y) => {
        if (a !== b) expect(wsoKey(a)).not.toBe(wsoKey(b));
        if (x !== y) expect(searchShardKey(x)).not.toBe(searchShardKey(y));
      }),
    );
  });

  // Shards are deleted by prefix (`deleteViewsWithPrefix(ctx, searchShardKey(b))`),
  // so no shard's key may be a prefix of another's.
  it('make no shard key a prefix of another shard key', () => {
    fc.assert(
      fc.property(bigramArb, bigramArb, (x, y) => {
        fc.pre(x !== y);
        expect(searchShardKey(y).startsWith(searchShardKey(x))).toBe(false);
        expect(searchShardKey(x).startsWith(SEARCH_SHARD_PREFIX)).toBe(true);
      }),
    );
  });

  // The app sends 'men' or 'Men'; the key folds gender case on purpose.
  it('example: adaptive keys fold the case of the gender, nothing else', () => {
    expect(adaptiveKey('Men', 'BWL', '2026')).toBe(adaptiveKey('men', 'BWL', '2026'));
    expect(adaptiveKey('men', 'bwl', '2026')).not.toBe(adaptiveKey('men', 'BWL', '2026'));
  });

  // REGRESSION (#192): `nat|${federation}|${ageCategory}` (likewise
  // `adaptiveKey`) was ambiguous when a part held '|': natKey('a|b', 'c') was
  // natKey('a', 'b|c'), so a request whose federation or age held '|' could
  // read another ranking's view. Parts are now escaped (`escapeKeyPart`).
  it('give national rankings of distinct arguments distinct keys', () => {
    fc.assert(
      // Every other way to cut `federation|age` in two at a '|'.
      fc.property(partArb, partArb, (federation, age) => {
        const joined = `${federation}|${age}`;
        for (let i = joined.indexOf('|'); i >= 0; i = joined.indexOf('|', i + 1)) {
          const [f, a] = [joined.slice(0, i), joined.slice(i + 1)];
          if (f !== federation) expect(natKey(f, a)).not.toBe(natKey(federation, age));
        }
      }),
    );
  });

  // REGRESSION (#192): the shrunk counterexample.
  it('example: a separator inside a part does not make two rankings one', () => {
    expect(natKey('a|b', 'c')).not.toBe(natKey('a', 'b|c'));
    expect(adaptiveKey('men|x', 'BWL', '2026')).not.toBe(adaptiveKey('men', 'x|BWL', '2026'));
  });

  // REGRESSION (#192): views are deleted and listed by key prefix, and a
  // meet's prefixes (`meetViewsPrefix(meet)` in `views:deleteMeetViews`,
  // `meetSessionPrefix(meet)` in `buildMeet`, `meetKey(meet, 'package_static')`
  // when a meet has no row) covered the keys of any meet whose name started
  // with that meet's name and '|' ('A' covered 'A|B'; 'A' sessions covered
  // 'A|session|x'), so rebuilding meet 'A' deleted the views of meet
  // 'A|session|x'. An escaped name holds no '|', so each prefix ends at the
  // meet name's end.
  it("make no meet's prefixes cover another meet's views", () => {
    fc.assert(
      // The other meet: any meet, or one whose name extends this one's.
      fc.property(partArb, fc.oneof(meetViewArb, partArb), (meet, pick) => {
        const other =
          typeof pick === 'string' ? { meet: `${meet}|${pick}`, key: meetKey(`${meet}|${pick}`, 'schedule') } : pick;
        fc.pre(meet !== other.meet);
        expect(other.key.startsWith(meetViewsPrefix(meet))).toBe(false);
        expect(other.key.startsWith(meetSessionPrefix(meet))).toBe(false);
        expect(other.key.startsWith(meetKey(meet, 'package_static'))).toBe(false);
      }),
    );
  });

  // REGRESSION (#192): the shrunk counterexamples.
  it("example: meet 'A' does not own the views of meet 'A|B'", () => {
    expect(meetKey('A|B', 'schedule').startsWith(meetViewsPrefix('A'))).toBe(false);
    expect(meetKey('A|session|1', 'schedule').startsWith(meetSessionPrefix('A'))).toBe(false);
    expect(meetSessionKey('A|session|1', 2).startsWith(meetSessionPrefix('A'))).toBe(false);
    expect(meetKey('A|package_static', 'schedule').startsWith(meetKey('A', 'package_static'))).toBe(false);
  });

  it('put every view of a meet under its own prefix', () => {
    fc.assert(
      fc.property(meetViewArb, (view) => {
        expect(view.key.startsWith(meetViewsPrefix(view.meet))).toBe(true);
      }),
    );
  });

  it('escape key parts reversibly, leaving no separator in them', () => {
    fc.assert(
      fc.property(partArb, (part) => {
        const escaped = escapeKeyPart(part);
        expect(escaped).not.toContain('|');
        expect(unescapeKeyPart(escaped)).toBe(part);
      }),
    );
    expect(escapeKeyPart('%7C|%25')).toBe('%257C%7C%2525');
  });

  it('give every key family injective builders over arbitrary parts', () => {
    const tuple = <T>(arb: fc.Arbitrary<T>) => fc.tuple(arb, arb);
    fc.assert(
      fc.property(tuple(partArb), tuple(partArb), tuple(partArb), tuple(sessionArb), tuple(partNameArb), (a, b, c, n, part) => {
        const distinct = (x: unknown[], y: unknown[]) => JSON.stringify(x) !== JSON.stringify(y);
        if (distinct([a[0], b[0]], [a[1], b[1]])) expect(natKey(a[0], b[0])).not.toBe(natKey(a[1], b[1]));
        if (distinct([a[0].toLowerCase(), b[0], c[0]], [a[1].toLowerCase(), b[1], c[1]])) {
          expect(adaptiveKey(a[0], b[0], c[0])).not.toBe(adaptiveKey(a[1], b[1], c[1]));
        }
        if (a[0] !== a[1]) expect(wsoKey(a[0])).not.toBe(wsoKey(a[1]));
        if (distinct([a[0], part[0]], [a[1], part[1]])) expect(meetKey(a[0], part[0])).not.toBe(meetKey(a[1], part[1]));
        if (distinct([a[0], n[0]], [a[1], n[1]])) expect(meetSessionKey(a[0], n[0])).not.toBe(meetSessionKey(a[1], n[1]));
      }),
    );
  });

  it('parse every key family back into the arguments that built it', () => {
    fc.assert(
      fc.property(partArb, partArb, partArb, sessionArb, partNameArb, (x, y, z, n, part) => {
        expect(parseViewKey(meetKey(x, part))).toEqual({ family: 'meet', meet: x, part });
        expect(parseViewKey(meetSessionKey(x, n))).toEqual({ family: 'session', meet: x, sessionNumber: n });
        expect(parseViewKey(natKey(x, y))).toEqual({ family: 'nat', federation: x, ageCategory: y });
        expect(parseViewKey(adaptiveKey(x, y, z))).toEqual({ family: 'adaptive', gender: x.toLowerCase(), excludeFederation: y, season: z });
        expect(parseViewKey(wsoKey(x))).toEqual({ family: 'wso', wso: x });
        // The hints a view depends on name the unescaped parts, as the writes leave them.
        expect(viewDependencies(meetKey(x, part))?.hints).toEqual([{ kind: 'meet', key: x }]);
        expect(viewDependencies(meetSessionKey(x, n))?.hints).toEqual([{ kind: 'meet', key: x }]);
        expect(viewDependencies(natKey(x, y))?.hints).toEqual([{ kind: 'nat', key: JSON.stringify([x, y]) }]);
      }),
    );
  });

  // Escaping must not move any stored view: every stored name is free of '|'
  // and '%', and for those the keys are the ones built before escaping.
  it('keep the old key, byte for byte, for parts free of | and %', () => {
    const old = {
      nat: (federation: string, ageCategory: string) => `nat|${federation}|${ageCategory}`,
      meet: (meet: string, part: string) => `meet|${meet}|${part}`,
      session: (meet: string, sessionNumber: number) => `meet|${meet}|session|${sessionNumber}`,
      sessionPrefix: (meet: string) => `meet|${meet}|session|`,
      meetPrefix: (meet: string) => `meet|${meet}|`,
      wso: (wso: string) => `wso|${wso}`,
      adaptive: (gender: string, excludeFederation: string, season: string) =>
        `adaptive|${gender.toLowerCase()}|${excludeFederation}|${season}`,
    };
    fc.assert(
      fc.property(plainPartArb, plainPartArb, plainPartArb, sessionArb, partNameArb, (x, y, z, n, part) => {
        expect(natKey(x, y)).toBe(old.nat(x, y));
        expect(meetKey(x, part)).toBe(old.meet(x, part));
        expect(meetSessionKey(x, n)).toBe(old.session(x, n));
        expect(meetSessionPrefix(x)).toBe(old.sessionPrefix(x));
        expect(meetViewsPrefix(x)).toBe(old.meetPrefix(x));
        expect(wsoKey(x)).toBe(old.wso(x));
        expect(adaptiveKey(x, y, z)).toBe(old.adaptive(x, y, z));
      }),
    );
  });

  it('put every session key under its meet’s session prefix', () => {
    fc.assert(
      fc.property(partArb, sessionArb, (meet, n) => {
        expect(meetSessionKey(meet, n).startsWith(meetSessionPrefix(meet))).toBe(true);
      }),
    );
  });
});
