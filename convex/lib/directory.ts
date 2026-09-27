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

// ---------------------------------------------------------------------------
// Two-letter shards
// ---------------------------------------------------------------------------
//
// Reading the whole directory (~1 MB) for every suggestion query is most of
// its cost. Each shard lists, in directory order, the names containing one
// two-letter sequence; a query reads only the shard of its rarest sequence
// and runs the same match over it. A shard is a subsequence of the directory
// and holds every name the query can match, so the first matches, and their
// order, are the directory's.
//
// Membership must cover what the case-insensitive (`iu`) match can reach.
// Shards serve only ASCII queries (anything else reads the directory), and
// the only non-ASCII characters that fold to ASCII letters are the Kelvin
// sign (to k) and the long s (to s); names are folded with those too.

/** A name or ASCII query folded the way the `iu` match compares ASCII. */
export function foldForShards(text: string): string {
  let folded = '';
  for (const ch of text) {
    if (ch === 'K') folded += 'k';
    else if (ch === 'ſ') folded += 's';
    else if (ch.charCodeAt(0) < 128) folded += ch.toLowerCase();
    else folded += ch;
  }
  return folded;
}

/** The distinct two-character sequences of a name (after folding). */
export function nameBigrams(name: string): Set<string> {
  const chars = [...foldForShards(name)];
  const bigrams = new Set<string>();
  for (let i = 0; i + 1 < chars.length; i++) bigrams.add(chars[i] + chars[i + 1]);
  return bigrams;
}

/** The query's two-character sequences, or null when it must read the whole directory (non-ASCII, or one character). */
export function queryBigrams(query: string): string[] | null {
  if (query.length < 2 || !/^[\x20-\x7e]+$/.test(query)) return null;
  return [...nameBigrams(query)];
}

/** Every shard of a directory, names in directory order. */
export function shardDirectory(names: readonly string[]): Map<string, string[]> {
  const shards = new Map<string, string[]>();
  for (const name of names) {
    for (const bigram of nameBigrams(name)) {
      const shard = shards.get(bigram);
      if (shard) shard.push(name);
      else shards.set(bigram, [name]);
    }
  }
  return shards;
}
