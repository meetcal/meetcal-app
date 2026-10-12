import * as fc from 'fast-check';

import { hostileStringArb } from '@/test-support/arbitraries';

import { etagOf, revalidated, revalidatedText } from '../convex/lib/etag';
import { joinJsonChunks, jsonChunks } from '../convex/lib/views';

/** Any text, including lone surrogates and control characters. */
const textArb = fc.oneof(fc.string({ unit: 'binary' }), fc.string({ unit: 'grapheme' }), hostileStringArb);

const TAG = /^"[0-9a-f]{28}"$/;

// The tag hashes the JSON *text* (`JSON.stringify` order), not the value, so
// the same object with its keys in another order is another answer: the code
// does not claim key-order insensitivity, and the properties below do not
// assume it.
describe('etagOf (property)', () => {
  it('is a quoted 28-digit hex tag, the same every time for the same text', () => {
    fc.assert(
      fc.property(textArb, (text) => {
        const tag = etagOf(text);
        expect(tag).toMatch(TAG);
        expect(etagOf(text)).toBe(tag);
      }),
    );
  });

  it('tells distinct texts apart', () => {
    fc.assert(
      fc.property(fc.uniqueArray(textArb, { minLength: 2, maxLength: 40 }), (texts) => {
        expect(new Set(texts.map(etagOf)).size).toBe(texts.length);
      }),
    );
  });

  it('changes when one code unit changes, anywhere in the text', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'binary', minLength: 1 }),
        fc.nat(),
        fc.integer({ min: 1, max: 0xffff }),
        (text, at, delta) => {
          const i = at % text.length;
          const unit = String.fromCharCode((text.charCodeAt(i) + delta) % 0x10000);
          const changed = text.slice(0, i) + unit + text.slice(i + 1);
          expect(etagOf(changed)).not.toBe(etagOf(text));
        },
      ),
    );
  });
});

describe('revalidated (property)', () => {
  it('answers the body and its tag, or the tag alone when the client holds it (strong or weak)', () => {
    fc.assert(
      fc.property(
        fc.jsonValue(),
        fc.oneof(
          fc.constant<'none' | 'strong' | 'weak'>('none'),
          fc.constant<'none' | 'strong' | 'weak'>('strong'),
          fc.constant<'none' | 'strong' | 'weak'>('weak'),
        ),
        (body, held) => {
          const json = JSON.stringify(body);
          const etag = etagOf(json);
          const ifNoneMatch = held === 'none' ? undefined : held === 'strong' ? etag : `W/${etag}`;
          const answer = revalidated(body, ifNoneMatch);
          expect(answer).toEqual(held === 'none' ? { etag, json } : { etag });
        },
      ),
    );
  });

  it('answers the body to any other tag the client sends', () => {
    fc.assert(
      fc.property(fc.jsonValue(), textArb, (body, ifNoneMatch) => {
        const json = JSON.stringify(body);
        fc.pre(ifNoneMatch !== etagOf(json) && ifNoneMatch !== `W/${etagOf(json)}`);
        expect(revalidated(body, ifNoneMatch)).toEqual({ etag: etagOf(json), json });
      }),
    );
  });

  it('example: a doubly weak tag is not the tag', () => {
    const etag = etagOf('[]');
    expect(revalidated([], `W/W/${etag}`)).toEqual({ etag, json: '[]' });
  });

  // `writeView` tags a JSON view with the hash of its joined chunks; a client
  // must hold the same tag whether it was answered from the view or live.
  it('gives a view built from the same items the same tag as the live answer', () => {
    fc.assert(
      fc.property(fc.array(fc.jsonValue({ maxDepth: 2 }), { maxLength: 20 }), (items) => {
        expect(etagOf(joinJsonChunks(jsonChunks(items)))).toBe(revalidated(items, undefined).etag);
      }),
    );
  });
});

describe('revalidatedText (property)', () => {
  it('never reads the body for a client holding the tag, and reads it once otherwise', async () => {
    await fc.assert(
      fc.asyncProperty(textArb, fc.option(textArb, { nil: undefined }), fc.boolean(), async (text, other, weak) => {
        const etag = etagOf(text);
        const read = jest.fn(async () => text);
        const held = await revalidatedText(etag, read, weak ? `W/${etag}` : etag);
        expect(held).toEqual({ etag });
        expect(read).not.toHaveBeenCalled();

        fc.pre(other !== etag && other !== `W/${etag}`);
        const fresh = await revalidatedText(etag, read, other);
        expect(fresh).toEqual({ etag, json: text });
        expect(read).toHaveBeenCalledTimes(1);
      }),
    );
  });
});
