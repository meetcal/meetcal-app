import { readFileSync } from "node:fs";
import { join } from "node:path";

import { AGE_GROUPS } from "@/constants/nat-rankings";
import { WEIGHT_CLASS_ERAS } from "@/constants/weight-classes";
import {
  getWeightClasses,
  getWeightClassGroups,
  getWeightClassOptions,
  rankingDivisionGroups,
} from "@/utils/nat-rankings";

import resultsFixture from "./__fixtures__/usaw-divisions-with-results.json";

const GENDERS = ["Men", "Women"] as const;

/** Every division the picker offers, and the ones under its first (current) heading. */
function offered() {
  const all = new Set<string>();
  const current = new Set<string>();
  for (const gender of GENDERS) {
    for (const ageGroup of AGE_GROUPS) {
      const [first, ...rest] = getWeightClassGroups(gender, ageGroup);
      for (const division of first?.divisions ?? []) {
        all.add(division);
        current.add(division);
      }
      for (const group of rest) for (const division of group.divisions) all.add(division);
    }
  }
  return { all, current };
}

describe("National Rankings divisions", () => {
  it("offer every USAW division with a result since Sep 1, 2026, under the current classes", () => {
    const { current } = offered();
    expect(resultsFixture.sinceSep2026.filter((division) => !current.has(division))).toEqual([]);
  });

  it("keep every division with a result from Jun 2025 to Aug 2026 reachable", () => {
    const { all } = offered();
    expect(resultsFixture.jun2025ToAug2026.filter((division) => !all.has(division))).toEqual([]);
  });

  it("offer the classes USAW adopted on Aug 1, 2026 first", () => {
    expect(getWeightClassGroups("Men", "Senior")[0]).toEqual({
      label: "Current classes",
      divisions: ["60", "65", "70", "75", "85", "95", "110", "110+"].map((w) => `Open Men's ${w}kg`),
    });
    expect(getWeightClasses("Women", "Masters 40").slice(0, 8)).toEqual(
      ["49", "53", "57", "61", "69", "77", "86", "86+"].map((w) => `Women's Masters (40-44) ${w}kg`),
    );
    expect(getWeightClasses("Men", "U17")[0]).toBe("Men's 16-17 Age Group 55kg");
  });

  it("offer nothing for an age group spelled other than the picker writes it", () => {
    for (const ageGroup of ["Masters 40.0", "Masters 040", "Masters 41", "Masters 95", "Masters"]) {
      expect(getWeightClasses("Women", ageGroup)).toEqual([]);
    }
    expect(getWeightClasses("Women", "Masters 90+")).not.toEqual([]);
  });

  it("list the retired 2025 classes after the current ones, once each", () => {
    expect(getWeightClassGroups("Men", "Junior")).toEqual([
      {
        label: "Current classes",
        divisions: ["60", "65", "70", "75", "85", "95", "110", "110+"].map((w) => `Junior Men's ${w}kg`),
      },
      {
        label: "2025 classes (before Aug 1, 2026)",
        divisions: ["71", "79", "88", "94"].map((w) => `Junior Men's ${w}kg`),
      },
    ]);
    for (const gender of GENDERS) {
      for (const ageGroup of AGE_GROUPS) {
        const divisions = getWeightClasses(gender, ageGroup);
        expect(new Set(divisions).size).toBe(divisions.length);
      }
    }
  });

  it("head each option with its era for the picker", () => {
    const options = getWeightClassOptions("Women", "Senior");
    expect(options[0]).toEqual({ value: "Open Women's 49kg", label: "Open Women's 49kg", group: "Current classes" });
    expect(options.at(-1)).toEqual({
      value: "Open Women's 63kg",
      label: "Open Women's 63kg",
      group: "2025 classes (before Aug 1, 2026)",
    });
  });

  it("offer the 13 & Under and 11 & Under light classes", () => {
    for (const ageGroup of ["U11", "U13"]) {
      const men = getWeightClasses("Men", ageGroup);
      const women = getWeightClasses("Women", ageGroup);
      expect(men.slice(0, 2)).toEqual([32, 36].map((w) => `Men's ${ageGroup === "U11" ? 11 : 13} Under Age Group ${w}kg`));
      expect(women.slice(0, 2)).toEqual([30, 33].map((w) => `Women's ${ageGroup === "U11" ? 11 : 13} Under Age Group ${w}kg`));
    }
  });

  it("name every Masters band, and nothing for an unknown age group", () => {
    expect(getWeightClasses("Men", "Masters 90+")[0]).toBe("Men's Masters (90+) 60kg");
    expect(getWeightClasses("Women", "Masters 85")[0]).toBe("Women's Masters (85-89) 49kg");
    expect(getWeightClassGroups("Men", "Masters 37")).toEqual([]);
    expect(getWeightClassGroups("Men", "Youth")).toEqual([]);
  });

  it("date the eras newest first without gaps", () => {
    expect(WEIGHT_CLASS_ERAS[0].to).toBeNull();
    for (let i = 1; i < WEIGHT_CLASS_ERAS.length; i += 1) {
      const newer = WEIGHT_CLASS_ERAS[i - 1];
      const older = WEIGHT_CLASS_ERAS[i];
      expect(older.to).not.toBeNull();
      const dayAfter = new Date(`${older.to}T00:00:00Z`);
      dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
      expect(dayAfter.toISOString().slice(0, 10)).toBe(newer.from);
    }
  });

  it("match the file the website's picker is tested against", () => {
    // Out of date? Run `mise exec -- bun scripts/write-ranking-divisions.ts`,
    // then `cargo test` in web/ to bring `division_groups` along.
    const path = join(__dirname, "..", "..", "web", "src", "pages", "comp_data", "ranking_divisions.json");
    const website: unknown = JSON.parse(readFileSync(path, "utf8"));
    expect(website).toEqual(rankingDivisionGroups());
  });
});
