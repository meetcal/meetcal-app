/**
 * The scrapers' value normalization, ported from `postgres_writer.py` in the
 * retired backend so rows written to Convex read exactly as they did in
 * Postgres. Applied by `convex/ingest.ts`, never by the scrapers themselves.
 */

/** Each whitespace-separated word capitalized, the rest lowercased. */
export function titleCase(value: string): string {
  const stripped = value.trim();
  if (!stripped) return stripped;
  return stripped
    .split(/\s+/)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

const GENDERS: Record<string, string> = {
  men: 'Men',
  women: 'Women',
  male: 'Male',
  female: 'Female',
  m: 'Men',
  f: 'Women',
};

export function normalizeGender(value: string): string {
  const normalized = value.trim();
  return GENDERS[normalized.toLowerCase()] ?? titleCase(normalized);
}

const AGE_CODES: Record<string, string> = { u13: 'U13', u15: 'U15', u17: 'U17', u20: 'U20', u25: 'U25' };

export function normalizeAgeCategory(value: string): string {
  const normalized = titleCase(value);
  return AGE_CODES[normalized.toLowerCase()] ?? normalized;
}

export function normalizeFederation(value: string): string {
  const normalized = value.trim();
  return ['usaw', 'iwf', 'umwf', 'bwl'].includes(normalized.toLowerCase()) ? normalized.toUpperCase() : normalized;
}
