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
      const numA = parseInt(aLower.replace(/[^0-9]/g, ""), 10);
      const numB = parseInt(bLower.replace(/[^0-9]/g, ""), 10);
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
