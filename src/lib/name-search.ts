/**
 * Word-by-word name matching for search boxes.
 *
 * A name matches when it contains every word of the query, in any order, so
 * "smith john" and "Smith " both find "John Smith". The name suggestion
 * dropdown and the Start List's search share this one policy; the Start List
 * used to match the raw query as a single substring, untrimmed.
 */

/** The query's lowercase words; `[]` for a blank query (which matches every name). */
export function searchWords(query: string): string[] {
  const trimmed = query.trim().toLowerCase();
  return trimmed ? trimmed.split(/\s+/) : [];
}

/** Whether `name` contains every word in `words` (from `searchWords`). */
export function nameMatchesSearchWords(name: string, words: readonly string[]): boolean {
  return lowerNameMatchesSearchWords(name.toLowerCase(), words);
}

/**
 * `nameMatchesSearchWords` for a name already lowercased, so a list filtered
 * on every keystroke can lowercase its names once.
 */
export function lowerNameMatchesSearchWords(
  lowerName: string,
  words: readonly string[],
): boolean {
  return words.every((word) => lowerName.includes(word));
}
