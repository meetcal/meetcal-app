/**
 * Membership numbers on a roster (`athletes.memberId`): the real one (digits),
 * a `noid:` placeholder for an entrant without one, or a one-off nine-digit
 * id the old entries scraper minted per run. The one spelling of each rule,
 * for the write path, the migrations and the scrapers.
 */

/** What a placeholder id starts with. */
export const PLACEHOLDER_MEMBER_ID_PREFIX = 'noid:';

/**
 * The shared stand-in for a missing membership number (`placeholder_member_id`
 * in the Python writer): athletes without one are keyed on meet and name.
 */
export function placeholderMemberId(name: string): string {
  const normalized = name.split(/\s+/).filter(Boolean).join(' ').toLowerCase();
  return `${PLACEHOLDER_MEMBER_ID_PREFIX}${normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
}

/** Whether an id is a placeholder (`placeholderMemberId`). */
export const isPlaceholderMemberId = (id: string) => id.startsWith(PLACEHOLDER_MEMBER_ID_PREFIX);

/** Whether a row has no membership number: a blank id, or a placeholder. */
export const hasNoMemberId = (id: string) => id === '' || isPlaceholderMemberId(id);

/**
 * A membership number the old entries scraper minted per run: nine digits.
 * A real number can look the same; one is one-off only when no other meet
 * holds it, which the caller looks up.
 */
export const ONE_OFF_MEMBER_ID = /^[1-9]\d{8}$/;
