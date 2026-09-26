/**
 * Folds an athlete name for case- and whitespace-insensitive matching:
 * collapses runs of whitespace to one space, trims, lowercases.
 *
 * The one spelling of the rule in `convex/`; it matches the Rust API's
 * `normalize_name` and the `lower(btrim(regexp_replace(name, '\s+', ' ')))`
 * Postgres indexes, and is what `name_key` columns are built from.
 */
export function normalizeName(name: string): string {
  return name.split(/\s+/).filter(Boolean).join(' ').toLowerCase();
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
