import AsyncStorage from "@react-native-async-storage/async-storage";
import { NativeModules, Platform } from "react-native";

import { QualifyingTotalsData } from "@/lib/database/fetch-qualifying-totals";
import { IntlRanking } from "@/lib/database/fetchIntlRankings";
import { StandardsData } from "@/types/standards";

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
  rows: WidgetRow[];
};

export const WIDGET_SETTINGS_STORAGE_KEY = "meetcal.widgetSettings";

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
    return mergeWidgetSettings(JSON.parse(stored));
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

export function mergeWidgetSettings(value: unknown): WidgetSettings {
  const parsed = value as Partial<WidgetSettings> | null;
  return {
    qualifyingTotals: {
      ...defaultWidgetSettings.qualifyingTotals,
      ...(parsed?.qualifyingTotals ?? {}),
    },
    standards: {
      ...defaultWidgetSettings.standards,
      ...(parsed?.standards ?? {}),
    },
    intlRankings: {
      ...defaultWidgetSettings.intlRankings,
      ...(parsed?.intlRankings ?? {}),
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
    rows: Object.entries(totals).map(([weightClass, total]) => ({
      leading: weightClass,
      title: "Qualifying total",
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
    rows: standards.map((standard) => ({
      leading: standard.weightClass,
      title: `A ${standard.a}kg`,
      trailing: `B ${standard.b}kg`,
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
    .map((ranking) => ({
      leading: `#${ranking.ranking}`,
      title: ranking.name,
      subtitle: `${ranking.weightClass} • ${ranking.total}kg`,
      trailing: `${ranking.percentA.toFixed(1)}%`,
    }));

  return {
    title: "International Rankings",
    subtitle: [
      settings.meet,
      settings.ageCategory,
      settings.gender,
    ].filter(Boolean).join(" • "),
    emptyMessage: "No rankings",
    rows,
  };
}

export function syncDataWidgets(payloads: {
  qualifyingTotals: DataWidgetPayload;
  standards: DataWidgetPayload;
  intlRankings: DataWidgetPayload;
}) {
  if (Platform.OS !== "ios") return;

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
