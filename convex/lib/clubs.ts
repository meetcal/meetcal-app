import { compareCollated } from './sort';

/**
 * Clubs are stored as each registrant typed them: `Ong Weightlifting`, `ONG
 * weightlifting`, `RoseCity` and `Rose City`, `Club.` and `Club` (#363).
 * A club is all the spellings that fold to one key: Unicode NFC, lowercased,
 * with everything but letters and digits (spaces, punctuation) dropped. The
 * club list shows one label per key, and every club answer (its
 * registrations, its meet stats) reads every spelling of it.
 */
export function clubKey(club: string): string {
  return club.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Whether two spellings are one club. */
export const sameClub = (a: string, b: string): boolean => clubKey(a) === clubKey(b);

/**
 * The spellings of each club among `spellings` (distinct, non-empty), keyed
 * by `clubKey`, in collated order within a club; a club's label is its first
 * spelling that is not all capitals or all lowercase (as clubs mostly write
 * their own name), else its first.
 */
export function clubSpellingGroups(spellings: Iterable<string>): [key: string, spellings: string[]][] {
  const groups = new Map<string, Set<string>>();
  for (const spelling of spellings) {
    const key = clubKey(spelling);
    if (key === '') continue;
    groups.set(key, (groups.get(key) ?? new Set()).add(spelling));
  }
  return [...groups].map(([key, set]): [string, string[]] => [key, [...set].sort(compareCollated)]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

const mixedCase = (spelling: string) => spelling !== spelling.toUpperCase() && spelling !== spelling.toLowerCase();

export function clubLabel(spellings: readonly string[]): string {
  return spellings.find(mixedCase) ?? spellings[0];
}

/** `GET /clubs`: one label per club (`clubLabel`), in the database's text order. */
export function clubLabels(spellings: Iterable<string>): string[] {
  return clubSpellingGroups(spellings)
    .map(([, group]) => clubLabel(group))
    .sort(compareCollated);
}
