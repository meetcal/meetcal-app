/**
 * The search directory: every distinct athlete name in `lifting_results`, one
 * per line, in the database's text order.
 *
 * `name ILIKE '%q%'` over 72k names is a substring scan. Postgres ran it over
 * a trigram index; here it is one case-insensitive regular expression run
 * over this text (native search rather than 72k JavaScript comparisons), and
 * the directory is one text value to read instead of 72k array elements.
 *
 * Staleness is harmless by design: a refresh merges new names in seconds
 * after a write, and until then a brand-new athlete is only missing from
 * suggestions (exact-name search reads their history directly).
 */

/** Earlier builds stored `lowercased \u0001 original` lines; read those too. */
const LEGACY_SEPARATOR = '\u0001';

export function directoryText(names: readonly string[]): string {
  return names.join('\n');
}

export function directoryNames(text: string): string[] {
  const names: string[] = [];
  for (const line of text.split('\n')) {
    if (line.length === 0) continue;
    const legacy = line.indexOf(LEGACY_SEPARATOR);
    names.push(legacy === -1 ? line : line.slice(legacy + 1));
  }
  return names;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `ILIKE '%query%'`: a case-insensitive substring test (Unicode case folding). */
export function nameMatcher(query: string): (name: string) => boolean {
  const pattern = new RegExp(escapeRegExp(query), 'iu');
  return (name) => pattern.test(name);
}

/** Up to `limit` directory names containing `query`, ignoring case, in directory order. */
export function searchDirectory(text: string, query: string, limit: number): string[] {
  const names: string[] = [];
  if (query.length === 0 || query.includes('\n')) return names;
  const pattern = new RegExp(escapeRegExp(query), 'giu');
  while (names.length < limit) {
    const match = pattern.exec(text);
    if (!match) break;
    const lineStart = text.lastIndexOf('\n', match.index) + 1;
    const newline = text.indexOf('\n', match.index);
    const lineEnd = newline === -1 ? text.length : newline;
    names.push(text.slice(lineStart, lineEnd));
    // One name matches once: continue on the next line.
    pattern.lastIndex = lineEnd + 1;
  }
  return names;
}
