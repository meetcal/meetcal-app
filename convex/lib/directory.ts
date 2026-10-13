import { normalizeName } from './names';

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

export function directoryText(names: readonly string[]): string {
  return names.join('\n');
}

export function directoryNames(text: string): string[] {
  return text.split('\n').filter((line) => line.length > 0);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Apostrophes names are written with: the typewriter one, the curly ones
 * smart punctuation types (iOS, macOS), the modifier letter and the accents
 * used in their place. A search for any finds them all (#348).
 */
const APOSTROPHES = "'\u2019\u2018\u02bc\u00b4`\u2032";
const APOSTROPHE = new RegExp(`[${APOSTROPHES}]`, 'g');

/**
 * The match pattern for a query: composed to NFC and trimmed, each run of
 * whitespace (any Unicode space, such as a non-breaking one) matching any run
 * of spaces within a name (Sport80 sends `Nick  Eudy`, #387) but never the
 * newline between two directory names, and each apostrophe any apostrophe.
 * Null for a query that is only whitespace.
 */
function searchPattern(query: string): string | null {
  const words = query.normalize('NFC').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  return words.map((word) => escapeRegExp(word).replace(APOSTROPHE, `[${APOSTROPHES}]`)).join('[^\\S\\n]+');
}

/**
 * `ILIKE '%query%'`: a case-insensitive substring test (Unicode case
 * folding), on both sides composed to NFC, so a precomposed and a decomposed
 * accent match each other (`normalizeName` folds names the same way), with
 * whitespace and apostrophes folded as `searchPattern` folds them.
 */
export function nameMatcher(query: string): (name: string) => boolean {
  const source = searchPattern(query);
  if (source === null) return () => false;
  const pattern = new RegExp(source, 'iu');
  return (name) => pattern.test(name.normalize('NFC'));
}

/**
 * Up to `limit` directory names containing `query`, ignoring case, Unicode
 * composition, the width of spaces and the kind of apostrophe (as
 * `nameMatcher`), in directory order, one per athlete: a name whose folded
 * key (`normalizeName`) an earlier match had is left out, as it finds the
 * same history. A name stored decomposed is returned composed.
 */
export function searchDirectory(directory: string, query: string, limit: number): string[] {
  const names: string[] = [];
  const source = searchPattern(query);
  if (source === null) return names;
  const seen = new Set<string>();
  // Nearly free on text that is already NFC, which nearly all of it is.
  const text = directory.normalize('NFC');
  const pattern = new RegExp(source, 'giu');
  while (names.length < limit) {
    const match = pattern.exec(text);
    if (!match) break;
    const lineStart = text.lastIndexOf('\n', match.index) + 1;
    const newline = text.indexOf('\n', match.index);
    const lineEnd = newline === -1 ? text.length : newline;
    const name = text.slice(lineStart, lineEnd);
    const key = normalizeName(name);
    if (!seen.has(key)) {
      seen.add(key);
      names.push(name);
    }
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
// sign (to k) and the long s (to s); names are folded with those too. Runs
// of whitespace (any Unicode space) fold to one space and apostrophes to
// `'`, as `searchPattern` matches them, on names and queries alike: a query
// typed `O'Neal` or `2026 IMWA` then reads a shard that holds `O’Neal` and
// `2026\u00a0IMWA`.

/** A name or query folded the way the search match compares ASCII, spaces and apostrophes. */
export function foldForShards(text: string): string {
  let folded = '';
  for (const ch of text.trim().replace(/\s+/g, ' ').replace(APOSTROPHE, "'")) {
    if (ch === 'K') folded += 'k';
    else if (ch === '\u017f') folded += 's';
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

/**
 * The query's two-character sequences, or null when it must read the whole
 * directory (non-ASCII once spaces and apostrophes are folded, or one
 * character).
 */
export function queryBigrams(query: string): string[] | null {
  const folded = foldForShards(query);
  if (folded.length < 2 || !/^[\x20-\x7e]+$/.test(folded)) return null;
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
