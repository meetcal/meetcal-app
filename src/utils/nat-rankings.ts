import { AGE_GROUPS } from "@/constants/nat-rankings";
import { ClassFamily, WEIGHT_CLASS_ERAS } from "@/constants/weight-classes";
import { Gender } from "@/types/nat-rankings";

/** One era's divisions in the picker, under its heading. */
export interface WeightClassGroup {
  label: string;
  divisions: string[];
}

/** Masters age group (`Masters 35`) to its band (`35-39`); `90+` is open. */
function mastersBand(ageGroup: string): string | null {
  const start = ageGroup.slice("Masters ".length);
  if (start === "90+") return start;
  const lower = Number(start);
  if (!Number.isInteger(lower) || lower < 35 || lower > 85 || lower % 5 !== 0) return null;
  return `${lower}-${lower + 4}`;
}

/**
 * The division name before the class (`Open Men's`, `Men's 14-15 Age Group`,
 * `Women's Masters (40-44)`) and the class list it uses, or `null` for an
 * age group the picker does not know.
 */
function divisionParts(
  gender: Gender,
  ageGroup: string,
): { prefix: string; family: ClassFamily } | null {
  switch (ageGroup) {
    case "U11":
      return { prefix: `${gender}'s 11 Under Age Group`, family: "under13" };
    case "U13":
      return { prefix: `${gender}'s 13 Under Age Group`, family: "under13" };
    case "U15":
      return { prefix: `${gender}'s 14-15 Age Group`, family: "14-15" };
    case "U17":
      return { prefix: `${gender}'s 16-17 Age Group`, family: "16-17" };
    case "Junior":
      return { prefix: `Junior ${gender}'s`, family: "senior" };
    case "Senior":
      return { prefix: `Open ${gender}'s`, family: "senior" };
  }
  if (ageGroup.startsWith("Masters ")) {
    const band = mastersBand(ageGroup);
    if (band) return { prefix: `${gender}'s Masters (${band})`, family: "senior" };
  }
  return null;
}

/**
 * An age group's divisions by era (`constants/weight-classes.ts`): the current
 * classes first, then each retired set's classes the newer ones do not
 * already offer. A class in both (`Open Men's 60kg`) is one ranking and is
 * listed once, under the newest era.
 */
export function getWeightClassGroups(gender: Gender, ageGroup: string): WeightClassGroup[] {
  const parts = divisionParts(gender, ageGroup);
  if (!parts) return [];
  const listed = new Set<string>();
  const groups: WeightClassGroup[] = [];
  for (const era of WEIGHT_CLASS_ERAS) {
    const divisions = era.classes[parts.family][gender]
      .map((weight) => `${parts.prefix} ${weight}kg`)
      .filter((division) => !listed.has(division));
    for (const division of divisions) listed.add(division);
    if (divisions.length > 0) groups.push({ label: era.label, divisions });
  }
  return groups;
}

/** Every division the picker offers for an age group, current classes first. */
export function getWeightClasses(gender: Gender, ageGroup: string): string[] {
  return getWeightClassGroups(gender, ageGroup).flatMap((group) => group.divisions);
}

/**
 * The picker's weight class options: current classes first, then the retired
 * ones, each under its era's heading (`group`).
 */
export function getWeightClassOptions(
  gender: Gender,
  ageGroup: string,
): { value: string; label: string; group: string }[] {
  return getWeightClassGroups(gender, ageGroup).flatMap((group) =>
    group.divisions.map((division) => ({ value: division, label: division, group: group.label })),
  );
}

/**
 * Every gender and age group's picker groups: the contents of the website's
 * `ranking_divisions.json`, which its own picker is tested against
 * (`scripts/write-ranking-divisions.ts` writes it).
 */
export function rankingDivisionGroups(): Record<Gender, Record<string, WeightClassGroup[]>> {
  const byGender = {} as Record<Gender, Record<string, WeightClassGroup[]>>;
  for (const gender of ["Men", "Women"] as const) {
    byGender[gender] = Object.fromEntries(
      AGE_GROUPS.map((ageGroup) => [ageGroup, getWeightClassGroups(gender, ageGroup)]),
    );
  }
  return byGender;
}
