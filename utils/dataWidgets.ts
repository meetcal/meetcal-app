import AsyncStorage from "@react-native-async-storage/async-storage";
import { NativeModules, Platform } from "react-native";

import { QualifyingTotalsData } from "@/lib/database/fetch-qualifying-totals";
import { IntlRanking } from "@/lib/database/fetchIntlRankings";
import { StandardsData } from "@/types/standards";
import {
  createIntlRankingsDeepLink,
  createQualifyingTotalsDeepLink,
  createStandardsDeepLink,
} from "@/utils/deepLinks";

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
    console.log("[Widget] Data widget module method not available");
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
