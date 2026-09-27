/**
 * Conditional reads, the Convex spelling of the Rust API's strong `ETag` +
 * `If-None-Match`.
 *
 * A revalidated query takes the tag the client last stored and answers
 * `{ etag }` alone when the body would be the same, so an unchanged answer
 * costs a few dozen bytes on the wire instead of the whole body. Otherwise it
 * answers `{ etag, json }`, the body as JSON text (see `convex/lib/views.ts`
 * for why text). Convex caches query results by arguments, so both answers
 * are computed once per data version and then served from the cache.
 */
export type Revalidated = { etag: string; json?: string };

/**
 * Two independent 53-bit hashes of the text (cyrb53), hex encoded. A tag only
 * has to tell two versions of one answer apart; it is not a security
 * boundary, and 106 bits make an accidental collision irrelevant.
 */
export function etagOf(text: string): string {
  return `"${cyrb53(text, 0x9e3779b9)}${cyrb53(text, 0x85ebca6b)}"`;
}

function cyrb53(text: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const value = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return value.toString(16).padStart(14, '0');
}

function stripWeak(tag: string): string {
  return tag.startsWith('W/') ? tag.slice(2) : tag;
}

/** Answers `body`, or the tag alone when `ifNoneMatch` names it. */
export function revalidated(body: unknown, ifNoneMatch: string | undefined): Revalidated {
  const json = JSON.stringify(body);
  const etag = etagOf(json);
  if (ifNoneMatch && stripWeak(ifNoneMatch) === etag) return { etag };
  return { etag, json };
}

/**
 * For answers whose tag is known without building them (materialized views):
 * a client already holding `etag` gets it back without the body ever being
 * read.
 */
export async function revalidatedText(
  etag: string,
  json: () => Promise<string>,
  ifNoneMatch: string | undefined,
): Promise<Revalidated> {
  if (ifNoneMatch && stripWeak(ifNoneMatch) === etag) return { etag };
  return { etag, json: await json() };
}
