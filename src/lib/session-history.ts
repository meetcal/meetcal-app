import { normalizeAthleteName } from '@/lib/athletes';
import type { AthleteMeetResult } from '@/data/types/athletes';

export type HistoryFetch = (names: string[]) => Promise<AthleteMeetResult[]>;

export type EarlyHistory = {
  names: ReadonlySet<string>;
  results: Promise<AthleteMeetResult[] | null>;
};

function foldedNames(names: readonly string[]): string[] {
  return Array.from(new Set(names.map(normalizeAthleteName).filter((name) => name.length > 0)));
}

export function startEarlyHistory(names: readonly string[], fetch: HistoryFetch): EarlyHistory | null {
  const named = names.filter((name) => name.trim().length > 0);
  if (named.length === 0) return null;
  return {
    names: new Set(foldedNames(named)),
    results: fetch(Array.from(new Set(named))).catch(() => null),
  };
}

export async function historyForNames(
  names: readonly string[],
  early: EarlyHistory | null,
  fetch: HistoryFetch,
): Promise<AthleteMeetResult[]> {
  const wanted = new Set(foldedNames(names));
  const earlyResults = early ? await early.results : null;
  if (!early || earlyResults === null) return fetch(names.filter((name) => wanted.has(normalizeAthleteName(name))));
  const missing = Array.from(new Set(names.filter((name) => {
    const folded = normalizeAthleteName(name);
    return folded.length > 0 && !early.names.has(folded);
  })));
  const covered = earlyResults.filter((row) => wanted.has(normalizeAthleteName(row.name)));
  if (missing.length === 0) return covered;
  return [...covered, ...(await fetch(missing))];
}
