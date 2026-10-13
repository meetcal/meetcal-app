/**
 * Word-by-word name matching for search boxes.
 *
 * A name matches when it contains every word of the query, in any order, so
 * "smith john" and "Smith " both find "John Smith". The name suggestion
 * dropdown and the Start List's search share this one policy; the Start List
 * used to match the raw query as a single substring, untrimmed.
 */

/**
 * A name or query folded for substring search: Unicode NFC, then lowercase.
 * NFC, like the name key (`normalizeAthleteName`), so "José" typed with a
 * precomposed é finds a roster name stored with a combining accent.
 */
export function foldForNameSearch(text: string): string {
  return text.normalize('NFC').toLowerCase();
}

/** The query's folded words; `[]` for a blank query (which matches every name). */
export function searchWords(query: string): string[] {
  const trimmed = foldForNameSearch(query).trim();
  return trimmed ? trimmed.split(/\s+/) : [];
}

/** Whether `name` contains every word in `words` (from `searchWords`). */
export function nameMatchesSearchWords(name: string, words: readonly string[]): boolean {
  return lowerNameMatchesSearchWords(foldForNameSearch(name), words);
}

/**
 * `nameMatchesSearchWords` for a name already folded (`foldForNameSearch`),
 * so a list filtered on every keystroke can fold its names once.
 */
export function lowerNameMatchesSearchWords(
  lowerName: string,
  words: readonly string[],
): boolean {
  return words.every((word) => lowerName.includes(word));
}
