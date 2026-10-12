import * as fc from 'fast-check';

import { hostileStringArb } from '@/test-support/arbitraries';

import {
  adaptiveKey,
  MEET_VIEW_PARTS,
  meetKey,
  meetSessionKey,
  meetSessionPrefix,
  natKey,
  REF_VIEWS,
  RESULT_NAMES_VIEW,
  SEARCH_SHARD_PREFIX,
  SEARCH_SHARD_SIZES_VIEW,
  searchShardKey,
  wsoKey,
} from '../convex/lib/viewKeys';

/** Key parts: meet names, labels, and the separator itself where it hurts. */
const partArb = fc.oneof(
  { weight: 2, arbitrary: fc.string({ unit: fc.constantFrom('a', 'B', '|', ' ', 'é', '1'), maxLength: 6 }) },
  { weight: 1, arbitrary: fc.constantFrom('', '|', 'session', 'session|1', 'schedule', 'Open|Men', '2026 Nationals') },
  { weight: 1, arbitrary: hostileStringArb },
);
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

  // FINDING, deferred: see the linked issue in PR #184. Skipped until then:
  // the fix changes stored keys and overlaps PR #179's key parsing.
  // `nat|${federation}|${ageCategory}` (likewise `adaptiveKey`) is
  // ambiguous when a part holds '|': natKey('a|b', 'c') === natKey('a', 'b|c'),
  // so a request whose federation or age holds '|' could read another
  // ranking's view. Latent: no stored federation or age category holds '|',
  // and a key with no '|' in its parts cannot be reached by any other
  // arguments. Proposed fix: encode parts (`encodeURIComponent`, as
  // `searchShardKey` does) or refuse '|' in the query's arguments; encoding
  // changes the key of any part holding '%' or '|', so it needs a redeploy
  // and a views rebuild.
  it.skip('give national rankings of distinct arguments distinct keys', () => {
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

  // FINDING (same as above; deferred: see the linked issue in PR #184): shrunk counterexample.
  it.skip('example: a separator inside a part does not make two rankings one', () => {
    expect(natKey('a|b', 'c')).not.toBe(natKey('a', 'b|c'));
  });

  // FINDING, deferred: see the linked issue in PR #184. Skipped until then:
  // the fix changes stored keys and overlaps PR #179's key parsing.
  // Views are deleted and listed by key prefix, and a meet's
  // prefixes (`meet|${meet}|` in `views:deleteMeetViews`,
  // `meetSessionPrefix(meet)` in `buildMeet`, `meetKey(meet, 'package_static')`
  // when a meet has no row) also cover the keys of any meet whose name starts
  // with that meet's name and '|' ('A' covers 'A|B'; 'A' sessions cover
  // 'A|session|x'). Rebuilding meet 'A' therefore deletes views of meet
  // 'A|session|x', which then read as misses (computed live) until rebuilt,
  // and `rebuildMeets` lists them as rebuilt. Latent: no meet name holds '|'.
  // Proposed fix: encode the meet name in keys, which changes stored keys
  // (redeploy and rebuild), or check that a deleted key parses back to the
  // same meet before deleting it.
  it.skip("make no meet's prefixes cover another meet's views", () => {
    fc.assert(
      // The other meet: any meet, or one whose name extends this one's.
      fc.property(partArb, fc.oneof(meetViewArb, partArb), (meet, pick) => {
        const other =
          typeof pick === 'string' ? { meet: `${meet}|${pick}`, key: meetKey(`${meet}|${pick}`, 'schedule') } : pick;
        fc.pre(meet !== other.meet);
        expect(other.key.startsWith(`meet|${meet}|`)).toBe(false);
        expect(other.key.startsWith(meetSessionPrefix(meet))).toBe(false);
        expect(other.key.startsWith(meetKey(meet, 'package_static'))).toBe(false);
      }),
    );
  });

  // FINDING (same as above; deferred: see the linked issue in PR #184): shrunk counterexamples.
  it.skip("example: meet 'A' does not own the views of meet 'A|B'", () => {
    expect(meetKey('A|B', 'schedule').startsWith('meet|A|')).toBe(false);
    expect(meetKey('A|session|1', 'schedule').startsWith(meetSessionPrefix('A'))).toBe(false);
  });

  it('put every session key under its meet’s session prefix', () => {
    fc.assert(
      fc.property(partArb, sessionArb, (meet, n) => {
        expect(meetSessionKey(meet, n).startsWith(meetSessionPrefix(meet))).toBe(true);
      }),
    );
  });
});
