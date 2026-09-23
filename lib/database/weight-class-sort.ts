/**
 * Records/standards weight-class ordering: lightest first, the unlimited
 * ("+") class always last.
 *
 * One copy for `fetch-records`, `fetch-wso-records`, `fetch-adaptive-records`
 * and `fetch-standards`, which each carried a near-identical private version.
 *
 * Note this is NOT the same policy as `sortWeightClasses` in
 * `lib/start-list-utils.ts`, which sorts "+87" next to "87" rather than last.
 * That one orders a start list; this one orders a records table.
 */
export function weightClassSort(a: string, b: string): number {
  const aVal = parseWeightClass(a);
  const bVal = parseWeightClass(b);
  if (aVal === bVal) return 0;
  if (aVal === Infinity) return 1;
  if (bVal === Infinity) return -1;
  return aVal - bVal;
}

function parseWeightClass(weightClass: string): number {
  // "+87kg" / "87+" — the unlimited class sorts after every numbered one.
  if (weightClass.includes('+')) return Infinity;
  const leading = parseInt(weightClass, 10);
  if (!Number.isNaN(leading)) return leading;
  // Classes that don't start with a digit (e.g. an adaptive "K44kg").
  const digitsOnly = parseInt(weightClass.replace(/[^\d]/g, ''), 10);
  return Number.isNaN(digitsOnly) ? Infinity : digitsOnly;
}
