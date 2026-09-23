const BASE_ORDER = [
  "u11",
  "u13",
  "u15",
  "u17",
  "youth",
  "junior",
  "senior",
];

const EXTENDED_ORDER = [
  "u11",
  "u13",
  "u15",
  "u17",
  "youth",
  "junior",
  "university",
  "u23",
  "u25",
  "senior",
];

export function sortAgeGroups(
  ageGroups: string[],
  options?: { includeExtended?: boolean },
): string[] {
  const order = options?.includeExtended ? EXTENDED_ORDER : BASE_ORDER;

  return [...ageGroups].sort((a, b) => {
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();
    const aIdx = order.indexOf(aLower);
    const bIdx = order.indexOf(bLower);

    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
    if (aIdx !== -1) return -1;
    if (bIdx !== -1) return 1;

    const mastersA = aLower.startsWith("masters");
    const mastersB = bLower.startsWith("masters");

    if (mastersA && mastersB) {
      const matchA = aLower.match(/\d+/);
      const matchB = bLower.match(/\d+/);
      const numA = matchA ? parseInt(matchA[0], 10) : NaN;
      const numB = matchB ? parseInt(matchB[0], 10) : NaN;
      if (!Number.isNaN(numA) && !Number.isNaN(numB)) {
        return numA - numB;
      }
      return a.localeCompare(b, undefined, { sensitivity: "base" });
    }
    if (mastersA) return 1;
    if (mastersB) return -1;

    return a.localeCompare(b, undefined, { sensitivity: "base" });
  });
}

/**
 * Display label for an age group key.
 *
 * "u13"/"u23" read as "U13"/"U23"; everything else is capitalised
 * ("senior" -> "Senior", "university" -> "University"). `records`,
 * `wso-records` and `new-standards` each carried their own version of this —
 * one testing `u` + digits, one a `u13`/`u15`/`u17` switch, one a single
 * `u15` ternary — all three producing the same string for every key in
 * `BASE_ORDER`/`EXTENDED_ORDER`.
 *
 * Not the same policy as `formatAgeGroup` in `utils/dataWidgets.ts`, which
 * upper-cases any key starting with "u" (so "university" renders
 * "UNIVERSITY"). That one is the widget's, and changing it is user-visible.
 */
export function formatAgeGroupLabel(ageGroup: string | undefined): string {
  if (!ageGroup) return "";
  const isNumberedUnderGroup =
    ageGroup.startsWith("u") &&
    ageGroup.length > 1 &&
    !Number.isNaN(Number(ageGroup.substring(1, 3)));
  if (isNumberedUnderGroup) return ageGroup.toUpperCase();
  return ageGroup.charAt(0).toUpperCase() + ageGroup.slice(1);
}
