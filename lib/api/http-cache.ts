/**
 * Validator cache for conditional GETs.
 *
 * The API tags its read-only JSON (`/meets`, `/meets/details`,
 * `/meets/schedule`) with a strong `ETag` and `Cache-Control: no-cache`, and
 * answers `304` with no body when `If-None-Match` names the current tag. The
 * app's refresh loops re-request those URLs every few minutes, so remembering
 * the last tag and the already-validated body per URL turns most refreshes into
 * a bodiless `304`.
 *
 * Bounded (see `HTTP_VALIDATOR_CACHE_LIMIT`) and in memory only: a cold start
 * pays one full download per URL, and nothing here can outlive an app update
 * whose parser disagrees with an old body.
 */

/**
 * Most URLs remembered at once. The steady state is `/meets` plus details and
 * schedule for the selected meet and whatever few meets the user browsed; a
 * miss only costs one full download.
 */
export const HTTP_VALIDATOR_CACHE_LIMIT = 32;

export type ValidatorEntry<T = unknown> = {
  etag: string;
  value: T;
};

/** Insertion-ordered LRU: `Map` keys iterate oldest-first. */
export class ValidatorCache {
  private readonly entries = new Map<string, ValidatorEntry>();

  constructor(private readonly limit: number = HTTP_VALIDATOR_CACHE_LIMIT) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`ValidatorCache limit must be a positive integer, got ${limit}`);
    }
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): ValidatorEntry | undefined {
    return this.entries.get(key);
  }

  /** Stores (or refreshes the recency of) `key`, evicting the oldest past the limit. */
  set(key: string, entry: ValidatorEntry): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}

/**
 * A usable validator from a response header: a non-empty strong or weak tag.
 * Anything else is not worth sending back.
 */
export function usableEtag(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const tag = value.trim();
  return tag.length > 0 ? tag : null;
}
