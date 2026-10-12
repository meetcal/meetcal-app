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
  if (words.length === 0) return true;
  const lower = name.toLowerCase();
  return words.every((word) => lower.includes(word));
}
