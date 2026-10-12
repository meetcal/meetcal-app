/**
 * Folds an athlete name for case- and whitespace-insensitive matching:
 * composes it to Unicode NFC, collapses runs of whitespace to one space,
 * trims, lowercases.
 *
 * NFC, so a name sent with a precomposed letter (é) and with a letter and a
 * combining accent (e + U+0301) is one athlete: sources send both. Not NFKC,
 * which also folds compatibility characters (ligatures, superscripts,
 * full-width letters) and so can join spellings that are different text; NFC
 * joins only spellings that are the same text.
 *
 * The one spelling of the rule in `convex/`, and what `nameKey` is built
 * from: a change here rekeys stored rows, so run
 * `migrations:backfillNameKeys` after deploying one.
 */
export function normalizeName(name: string): string {
  return name.normalize('NFC').split(/\s+/).filter(Boolean).join(' ').toLowerCase();
}

/** Trims every name and drops the empty ones (`clean_name_list`). */
export function cleanNameList(names: readonly string[]): string[] {
  return names.map((name) => name.trim()).filter((name) => name.length > 0);
}

/**
 * Requested spellings grouped by their folded key, so a response keyed by the
 * caller's spelling can be filled from rows matched on the key.
 */
export function requestedNamesByKey(names: readonly string[]): Map<string, string[]> {
  const byKey = new Map<string, string[]>();
  for (const name of names) {
    const key = normalizeName(name);
    const spellings = byKey.get(key);
    if (spellings) {
      spellings.push(name);
    } else {
      byKey.set(key, [name]);
    }
  }
  return byKey;
}

/** Distinct folded keys of `names`, in first-seen order. */
export function distinctNameKeys(names: readonly string[]): string[] {
  return Array.from(new Set(names.map(normalizeName)));
}
