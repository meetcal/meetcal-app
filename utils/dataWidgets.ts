import AsyncStorage from "@react-native-async-storage/async-storage";
import { NativeModules, Platform } from "react-native";

import type { FilterSection } from "@/components/ui/filters/GenericFilterModal";
import { QualifyingTotalsData } from "@/lib/database/fetch-qualifying-totals";
import { IntlRanking } from "@/lib/database/fetchIntlRankings";
import { sortAgeGroups } from "@/lib/sortAgeGroups";
import { StandardsData } from "@/types/standards";
import {
  createIntlRankingsDeepLink,
  createQualifyingTotalsDeepLink,
  createStandardsDeepLink,
} from "@/utils/deepLinks";
import { devLog } from "@/lib/logger";

export type WidgetKind = "qualifyingTotals" | "standards" | "intlRankings";

export type WidgetSettings = {
  qualifyingTotals: {
    event: string;
    gender: "Men" | "Women";
    ageGroup: string;
  };
  standards: {
    gender: "men" | "women";
    ageGroup: string;
  };
  intlRankings: {
    meet: string;
    ageCategory: string;
    gender: "Men" | "Women" | "";
  };
};

type WidgetRow = {
  leading: string;
  title: string;
  trailing: string;
  subtitle?: string;
};

export type DataWidgetPayload = {
  title: string;
  subtitle: string;
  emptyMessage: string;
  linkURL: string;
  maxRows: number;
  rows: WidgetRow[];
};

export const WIDGET_SETTINGS_STORAGE_KEY = "meetcal.widgetSettings";

/**
 * `maxRows` is display-only metadata the native widget honours
 * (`SavedWidget.swift` renders `min(maxRows, 3)` on medium, `maxRows`
 * otherwise). It is *not* a bound on what we serialize.
 */
export const QUALIFYING_TOTALS_WIDGET_MAX_ROWS = 10;
export const STANDARDS_WIDGET_MAX_ROWS = 10;
export const INTL_RANKINGS_WIDGET_MAX_ROWS = 7;

/**
 * The bound on rows actually serialized across the bridge, so a widget refresh
 * costs the same whether the selected age group has eight weight classes or
 * the whole federation's. International rankings already capped here; the
 * qualifying-totals and standards payloads did not, and shipped every matching
 * row into a widget that can render ten.
 */
export const WIDGET_PAYLOAD_ROW_LIMIT = 20;

export const defaultWidgetSettings: WidgetSettings = {
  qualifyingTotals: {
    event: "Nationals",
    gender: "Men",
    ageGroup: "Senior",
  },
  standards: {
    gender: "men",
    ageGroup: "senior",
  },
  intlRankings: {
    meet: "",
    ageCategory: "Senior",
    gender: "Men",
  },
};

export async function loadWidgetSettings(): Promise<WidgetSettings> {
  const stored = await AsyncStorage.getItem(WIDGET_SETTINGS_STORAGE_KEY);
  if (!stored) return defaultWidgetSettings;

  try {
    const parsed: unknown = JSON.parse(stored);
    return mergeWidgetSettings(parsed);
  } catch {
    return defaultWidgetSettings;
  }
}

export async function saveWidgetSettings(settings: WidgetSettings) {
  await AsyncStorage.setItem(
    WIDGET_SETTINGS_STORAGE_KEY,
    JSON.stringify(settings),
  );
}

function readSection(value: unknown, key: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const section = (value as Record<string, unknown>)[key];
  if (!section || typeof section !== "object" || Array.isArray(section)) {
    return {};
  }
  return section as Record<string, unknown>;
}

function readString(section: Record<string, unknown>, key: string, fallback: string): string {
  const value = section[key];
  return typeof value === "string" ? value : fallback;
}

function readEnum<T extends string>(
  section: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = section[key];
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/**
 * Narrows stored widget settings instead of `as Partial<WidgetSettings>`-ing
 * them past `JSON.parse`. The old spread copied whatever was on disk straight
 * into the payload, so a hand-edited or migrated value ("M" for a gender, a
 * string where a section object belongs) reached the native widget as a lookup
 * key that matches nothing and rendered an empty widget with no explanation.
 */
export function mergeWidgetSettings(value: unknown): WidgetSettings {
  const qualifyingTotals = readSection(value, "qualifyingTotals");
  const standards = readSection(value, "standards");
  const intlRankings = readSection(value, "intlRankings");

  return {
    qualifyingTotals: {
      event: readString(
        qualifyingTotals,
        "event",
        defaultWidgetSettings.qualifyingTotals.event,
      ),
      gender: readEnum(
        qualifyingTotals,
        "gender",
        ["Men", "Women"] as const,
        defaultWidgetSettings.qualifyingTotals.gender,
      ),
      ageGroup: readString(
        qualifyingTotals,
        "ageGroup",
        defaultWidgetSettings.qualifyingTotals.ageGroup,
      ),
    },
    standards: {
      gender: readEnum(
        standards,
        "gender",
        ["men", "women"] as const,
        defaultWidgetSettings.standards.gender,
      ),
      ageGroup: readString(
        standards,
        "ageGroup",
        defaultWidgetSettings.standards.ageGroup,
      ),
    },
    intlRankings: {
      meet: readString(
        intlRankings,
        "meet",
        defaultWidgetSettings.intlRankings.meet,
      ),
      ageCategory: readString(
        intlRankings,
        "ageCategory",
        defaultWidgetSettings.intlRankings.ageCategory,
      ),
      gender: readEnum(
        intlRankings,
        "gender",
        ["Men", "Women", ""] as const,
        defaultWidgetSettings.intlRankings.gender,
      ),
    },
  };
}

export function buildQualifyingTotalsWidgetPayload(
  totalsData: QualifyingTotalsData,
  settings: WidgetSettings["qualifyingTotals"],
): DataWidgetPayload {
  const totals =
    totalsData[settings.event]?.[settings.ageGroup]?.[settings.gender] ?? {};

  return {
    title: "Qualifying Totals",
    subtitle: [
      settings.event,
      settings.gender,
      formatAgeGroup(settings.ageGroup),
    ].filter(Boolean).join(" • "),
    emptyMessage: "No qualifying totals",
    linkURL: createQualifyingTotalsDeepLink(settings),
    maxRows: QUALIFYING_TOTALS_WIDGET_MAX_ROWS,
    rows: Object.entries(totals)
      .slice(0, WIDGET_PAYLOAD_ROW_LIMIT)
      .map(([weightClass, total]) => ({
        leading: weightClass,
        title: "",
        trailing: `${total}kg`,
      })),
  };
}

export function buildStandardsWidgetPayload(
  standardsData: StandardsData,
  settings: WidgetSettings["standards"],
): DataWidgetPayload {
  const standards = standardsData[settings.ageGroup]?.[settings.gender] ?? [];

  return {
    title: "A/B Standards",
    subtitle: `${formatGender(settings.gender)} • ${formatAgeGroup(settings.ageGroup)}`,
    emptyMessage: "No standards",
    linkURL: createStandardsDeepLink(settings),
    maxRows: STANDARDS_WIDGET_MAX_ROWS,
    rows: standards.slice(0, WIDGET_PAYLOAD_ROW_LIMIT).map((standard) => ({
      leading: standard.weightClass,
      title: `${standard.a}kg`,
      trailing: `${standard.b}kg`,
    })),
  };
}

export function buildIntlRankingsWidgetPayload(
  rankings: IntlRanking[],
  settings: WidgetSettings["intlRankings"],
): DataWidgetPayload {
  const rows = rankings
    .filter(
      (ranking) =>
        (!settings.meet || ranking.meet === settings.meet) &&
        (!settings.ageCategory || ranking.ageCategory === settings.ageCategory) &&
        (!settings.gender || ranking.gender === settings.gender),
    )
    .sort((a, b) => a.ranking - b.ranking)
    .slice(0, WIDGET_PAYLOAD_ROW_LIMIT)
    .map((ranking) => ({
      leading: `#${ranking.ranking}`,
      title: ranking.name,
      subtitle: `${ranking.weightClass} • ${ranking.total}kg`,
      trailing: `${ranking.percentA}%`,
    }));

  return {
    title: "International Rankings",
    subtitle: [
      settings.meet,
      settings.ageCategory,
      settings.gender,
    ].filter(Boolean).join(" • "),
    emptyMessage: "No rankings",
    linkURL: createIntlRankingsDeepLink(settings),
    maxRows: INTL_RANKINGS_WIDGET_MAX_ROWS,
    rows,
  };
}

export function syncDataWidgets(payloads: {
  qualifyingTotals: DataWidgetPayload;
  standards: DataWidgetPayload;
  intlRankings: DataWidgetPayload;
}) {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return;

  const module = NativeModules.SavedWidget;
  if (!module?.updateDataWidgets) {
    devLog("[Widget] Data widget module method not available");
    return;
  }

  module.updateDataWidgets(JSON.stringify(payloads));
}

export function formatAgeGroup(ageGroup: string) {
  if (!ageGroup) return "";
  const upper = ageGroup.toUpperCase();
  if (upper.startsWith("U")) return upper;
  return ageGroup.charAt(0).toUpperCase() + ageGroup.slice(1);
}

function formatGender(gender: string) {
  return gender === "men" ? "Men" : "Women";
}

/**
 * Filter policy for the widget settings screen.
 *
 * This used to live in closures declared after `WidgetSettingsScreen`'s
 * `return`, reading component state directly. That put the widget's option and
 * healing policy in a screen with no way to test it, and made the settings
 * screen the second owner of rules the payload builders above already imply.
 * Everything below is a pure function of the fetched data plus the stored
 * settings.
 */

const OPTION_COLLATOR_OPTIONS: Intl.CollatorOptions = { sensitivity: "base" };

function compareOptionLabels(left: string, right: string): number {
  return left.localeCompare(right, undefined, OPTION_COLLATOR_OPTIONS);
}

function sortedUnique(values: (string | undefined | null)[]): string[] {
  return Array.from(new Set(values))
    .filter((value): value is string => Boolean(value))
    .sort(compareOptionLabels);
}

export type WidgetFilterOptions = {
  /** Qualifying-total events, e.g. "Nationals". */
  events: string[];
  /** Meets that international rankings exist for. */
  rankingMeets: string[];
  /** Genders that international rankings exist for. */
  rankingGenders: string[];
};

export function buildWidgetFilterOptions(
  totalsData: QualifyingTotalsData,
  intlRankings: IntlRanking[],
): WidgetFilterOptions {
  return {
    events: sortedUnique(Object.keys(totalsData)),
    rankingMeets: sortedUnique(intlRankings.map((ranking) => ranking.meet)),
    rankingGenders: sortedUnique(intlRankings.map((ranking) => ranking.gender)),
  };
}

export function buildTotalsAgeGroupOptions(
  totalsData: QualifyingTotalsData,
  event: string,
): string[] {
  if (!event) return [];
  return sortAgeGroups(Object.keys(totalsData[event] ?? {}), {
    includeExtended: true,
  });
}

export function buildRankingAgeCategoryOptions(
  intlRankings: IntlRanking[],
  meet: string,
): string[] {
  const ageCategories = intlRankings
    .filter((ranking) => !meet || ranking.meet === meet)
    .map((ranking) => ranking.ageCategory)
    .filter(Boolean);
  return sortAgeGroups(Array.from(new Set(ageCategories)), {
    includeExtended: true,
  });
}

export function areWidgetSettingsEqual(
  left: WidgetSettings,
  right: WidgetSettings,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function pickOption<T extends string>(
  current: T,
  options: readonly string[],
  preferred?: T,
): T {
  if (options.includes(current)) return current;
  if (preferred && options.includes(preferred)) return preferred;
  return (options[0] as T | undefined) ?? current;
}

/**
 * Heals stored settings against the options the freshly fetched data actually
 * offers, and returns `settings` itself when nothing needed healing so callers
 * can use referential equality.
 *
 * A stored meet that is no longer offered is defaulted the same way a stored
 * event is. Only defaulting when the value is *empty* left last season's meet
 * in place forever, and `hasResolvedWidgetFilters` then refused to sync — so
 * the rankings widget silently stopped updating with no way back except
 * re-picking the filter by hand.
 */
export function normalizeWidgetSettings(
  settings: WidgetSettings,
  totalsData: QualifyingTotalsData,
  intlRankings: IntlRanking[],
): WidgetSettings {
  const { events, rankingMeets, rankingGenders } = buildWidgetFilterOptions(
    totalsData,
    intlRankings,
  );

  const event = pickOption(settings.qualifyingTotals.event, events);
  const ageGroup = pickOption(
    settings.qualifyingTotals.ageGroup,
    buildTotalsAgeGroupOptions(totalsData, event),
  );

  const meet = pickOption(settings.intlRankings.meet, rankingMeets);
  const ageCategory = pickOption(
    settings.intlRankings.ageCategory,
    buildRankingAgeCategoryOptions(intlRankings, meet),
    "Senior",
  );
  const gender = pickOption(
    settings.intlRankings.gender,
    rankingGenders,
    "Men",
  );

  const normalized: WidgetSettings = {
    qualifyingTotals: { ...settings.qualifyingTotals, event, ageGroup },
    standards: settings.standards,
    intlRankings: { meet, ageCategory, gender },
  };

  return areWidgetSettingsEqual(settings, normalized) ? settings : normalized;
}

/**
 * True when every stored filter resolves against the fetched data, i.e. the
 * payloads built from these settings describe something real. The auto-sync
 * path uses this so a half-loaded screen never overwrites a good widget with
 * an empty one.
 */
export function hasResolvedWidgetFilters(
  settings: WidgetSettings,
  totalsData: QualifyingTotalsData,
  standardsData: StandardsData,
  intlRankings: IntlRanking[],
): boolean {
  const { events, rankingMeets } = buildWidgetFilterOptions(
    totalsData,
    intlRankings,
  );
  if (
    events.length === 0 ||
    Object.keys(standardsData).length === 0 ||
    intlRankings.length === 0
  ) {
    return false;
  }

  return (
    events.includes(settings.qualifyingTotals.event) &&
    buildTotalsAgeGroupOptions(
      totalsData,
      settings.qualifyingTotals.event,
    ).includes(settings.qualifyingTotals.ageGroup) &&
    rankingMeets.includes(settings.intlRankings.meet)
  );
}

function toFilterOptions(values: string[], label?: (value: string) => string) {
  return values.map((value) => ({
    value,
    label: label ? label(value) : value,
  }));
}

export function buildQualifyingTotalsFilterSections(
  totalsData: QualifyingTotalsData,
  selectedEvent: string,
): FilterSection[] {
  return [
    {
      id: "event",
      title: "Event",
      options: toFilterOptions(buildWidgetFilterOptions(totalsData, []).events),
    },
    {
      id: "gender",
      title: "Gender",
      options: [
        { value: "Men", label: "Men" },
        { value: "Women", label: "Women" },
      ],
    },
    {
      id: "ageGroup",
      title: "Age Group",
      options: toFilterOptions(
        buildTotalsAgeGroupOptions(totalsData, selectedEvent),
        formatAgeGroup,
      ),
      dependsOn: ["event"],
    },
  ];
}

export function buildIntlRankingsFilterSections(
  intlRankings: IntlRanking[],
  selectedMeet: string,
): FilterSection[] {
  const { rankingMeets, rankingGenders } = buildWidgetFilterOptions(
    {},
    intlRankings,
  );

  return [
    {
      id: "meet",
      title: "Meet",
      options: toFilterOptions(rankingMeets),
    },
    {
      id: "ageCategory",
      title: "Age Category",
      options: toFilterOptions(
        buildRankingAgeCategoryOptions(intlRankings, selectedMeet),
      ),
      dependsOn: ["meet"],
    },
    {
      id: "gender",
      title: "Gender",
      options: toFilterOptions(rankingGenders),
    },
  ];
}

export const STANDARDS_FILTER_SECTIONS: FilterSection[] = [
  {
    id: "gender",
    title: "Gender",
    options: [
      { value: "men", label: "Men" },
      { value: "women", label: "Women" },
    ],
  },
  {
    id: "ageGroup",
    title: "Age Group",
    options: [
      { value: "u15", label: "U15" },
      { value: "youth", label: "Youth" },
      { value: "junior", label: "Junior" },
      { value: "senior", label: "Senior" },
    ],
  },
];
