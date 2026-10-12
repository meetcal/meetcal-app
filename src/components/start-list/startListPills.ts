import type { PillFilterConfig } from "@/components/ui/filters";
import {
  ADAPTIVE_ATHLETES_FILTER,
  ATHLETE_SORT_OPTIONS,
  NON_ADAPTIVE_ATHLETES_FILTER,
  STARRED_CLUBS_FILTER,
  type StartListFilters,
} from "@/lib/start-list-utils";

export interface StartListPillInputs {
  filters: StartListFilters;
  ageGroups: readonly string[];
  weightClasses: readonly string[];
  wsos: readonly string[];
  hasAdaptiveAthletes: boolean;
  /** Club opens its own searchable sheet instead of a menu. */
  onOpenClubs: () => void;
}

/**
 * The Start List's filter pills, in display order. The Adaptive pill shows
 * only when the roster has adaptive athletes, and WSO only when it has WSOs.
 */
export function buildStartListPillConfigs({
  filters,
  ageGroups,
  weightClasses,
  wsos,
  hasAdaptiveAthletes,
  onOpenClubs,
}: StartListPillInputs): PillFilterConfig[] {
  const configs: PillFilterConfig[] = [
    {
      id: "sort",
      label: "Sort",
      value: filters.sort === "alphabetical" ? "" : filters.sort,
      options: ATHLETE_SORT_OPTIONS.filter((opt) => opt.value !== "alphabetical"),
      allOptionLabel: "A-Z",
    },
    {
      id: "gender",
      label: "Gender",
      value: filters.gender,
      options: [
        { value: "Male", label: "Male" },
        { value: "Female", label: "Female" },
      ],
      allOptionLabel: "All Genders",
    },
    {
      id: "ageGroup",
      label: "Age Group",
      value: filters.ageGroup,
      options: ageGroups.map((ageGroup) => ({
        value: ageGroup,
        label: ageGroup.replace("Masters ", "M"),
      })),
      allOptionLabel: "All Ages",
    },
    {
      id: "weightClass",
      label: "Weight Class",
      value: filters.weightClass,
      options: weightClasses.map((weightClass) => ({
        value: weightClass,
        label: weightClass.replace("kg", ""),
      })),
      allOptionLabel: "All Weights",
    },
  ];

  if (hasAdaptiveAthletes) {
    configs.push({
      id: "adaptiveAthlete",
      label: "Adaptive",
      value: filters.adaptive,
      options: [
        { value: ADAPTIVE_ATHLETES_FILTER, label: "Adaptive" },
        { value: NON_ADAPTIVE_ATHLETES_FILTER, label: "Non-Adaptive" },
      ],
      allOptionLabel: "All Athletes",
    });
  }

  configs.push({
    id: "club",
    label: "Club",
    value: filters.club === STARRED_CLUBS_FILTER ? "Favorites" : filters.club,
    options: [],
    onPress: onOpenClubs,
  });

  if (wsos.length > 0) {
    configs.push({
      id: "wso",
      label: "WSO",
      value: filters.wso,
      options: wsos.map((wso) => ({ value: wso, label: wso })),
      allOptionLabel: "All Regions",
    });
  }

  return configs;
}
