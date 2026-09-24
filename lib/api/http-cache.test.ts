import { HTTP_VALIDATOR_CACHE_LIMIT, usableEtag, ValidatorCache } from './http-cache';

describe('ValidatorCache', () => {
  it('evicts the least recently stored entry past the limit', () => {
    const cache = new ValidatorCache(2);
    cache.set('a', { etag: '"a"', value: 1 });
    cache.set('b', { etag: '"b"', value: 2 });
    // Re-storing refreshes recency, so `b` becomes the oldest.
    cache.set('a', { etag: '"a"', value: 1 });
    cache.set('c', { etag: '"c"', value: 3 });

    expect(cache.size).toBe(2);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toEqual({ etag: '"a"', value: 1 });
    expect(cache.get('c')).toEqual({ etag: '"c"', value: 3 });
  });

  it('never grows past the default limit', () => {
    const cache = new ValidatorCache();
    for (let i = 0; i < HTTP_VALIDATOR_CACHE_LIMIT * 3; i += 1) {
      cache.set(`url-${i}`, { etag: `"${i}"`, value: i });
    }
    expect(cache.size).toBe(HTTP_VALIDATOR_CACHE_LIMIT);
  });

  it('deletes and clears', () => {
    const cache = new ValidatorCache(4);
    cache.set('a', { etag: '"a"', value: 1 });
    cache.set('b', { etag: '"b"', value: 2 });
    cache.delete('a');
    expect(cache.get('a')).toBeUndefined();
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('rejects a non-positive limit', () => {
    expect(() => new ValidatorCache(0)).toThrow();
    expect(() => new ValidatorCache(1.5)).toThrow();
  });
});

describe('usableEtag', () => {
  it('keeps non-empty tags and drops blanks', () => {
    expect(usableEtag('"abc"')).toBe('"abc"');
    expect(usableEtag(' W/"abc" ')).toBe('W/"abc"');
    expect(usableEtag('')).toBeNull();
    expect(usableEtag('   ')).toBeNull();
    expect(usableEtag(null)).toBeNull();
    expect(usableEtag(undefined)).toBeNull();
  });
});
