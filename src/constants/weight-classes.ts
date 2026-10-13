/**
 * USA Weightlifting's bodyweight classes, by the dates they applied, newest
 * first. The National Rankings picker (`utils/nat-rankings.ts`) builds every
 * division from this table; the server's `RANKING_DIVISIONS`
 * (`convex/lib/referenceData.ts`) and the website's `division_groups`
 * (`web/src/pages/comp_data/national_rankings.rs`, through
 * `web/src/pages/comp_data/ranking_divisions.json`) are tested against it.
 *
 * Sources: USAW's announcements of the June 1, 2025 and August 1, 2026 IWF
 * categories give the senior/junior and youth (16-17) sets; USAW has not
 * published the 14-15 and 13 & Under / 11 & Under sets, so those are the
 * classes every USAW result since the change is filed under (production
 * results, Jun 2025 - Oct 2026). Masters use the senior set.
 */

export type ClassGender = "Men" | "Women";

/**
 * A family of age groups sharing one class list: `senior` is Open, Junior
 * and every Masters band; `under13` is 13 & Under and 11 & Under.
 */
export type ClassFamily = "senior" | "16-17" | "14-15" | "under13";

export interface WeightClassEra {
  /** Heading the picker groups this era's classes under. */
  label: string;
  /** First day (ISO date) the classes applied. */
  from: string;
  /** Last day (ISO date) they applied; `null` while they still do. */
  to: string | null;
  /** Class upper limits in kg, lightest first, the open class last (`110+`). */
  classes: Record<ClassFamily, Record<ClassGender, readonly string[]>>;
}

export const WEIGHT_CLASS_ERAS: readonly WeightClassEra[] = [
  {
    label: "Current classes",
    from: "2026-08-01",
    to: null,
    classes: {
      senior: {
        Men: ["60", "65", "70", "75", "85", "95", "110", "110+"],
        Women: ["49", "53", "57", "61", "69", "77", "86", "86+"],
      },
      "16-17": {
        Men: ["55", "60", "65", "70", "75", "85", "95", "95+"],
        Women: ["45", "49", "53", "57", "61", "69", "77", "77+"],
      },
      "14-15": {
        Men: ["50", "55", "60", "65", "70", "75", "85", "95", "95+"],
        Women: ["45", "49", "53", "57", "61", "69", "77", "77+"],
      },
      under13: {
        Men: ["32", "36", "40", "45", "50", "55", "60", "65", "70", "70+"],
        Women: ["30", "33", "37", "41", "45", "49", "53", "57", "61", "61+"],
      },
    },
  },
  {
    label: "2025 classes (before Aug 1, 2026)",
    from: "2025-06-01",
    to: "2026-07-31",
    classes: {
      senior: {
        Men: ["60", "65", "71", "79", "88", "94", "110", "110+"],
        Women: ["48", "53", "58", "63", "69", "77", "86", "86+"],
      },
      "16-17": {
        Men: ["56", "60", "65", "71", "79", "88", "94", "94+"],
        Women: ["44", "48", "53", "58", "63", "69", "77", "77+"],
      },
      "14-15": {
        Men: ["48", "52", "56", "60", "65", "71", "79", "79+"],
        Women: ["40", "44", "48", "53", "58", "63", "69", "69+"],
      },
      under13: {
        Men: ["32", "36", "40", "44", "48", "52", "56", "60", "65", "65+"],
        Women: ["30", "33", "36", "40", "44", "48", "53", "58", "63", "63+"],
      },
    },
  },
];
