import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { FilterSection, GenericFilterModal } from "@/components/ui/filters";
import { useTheme } from "@/contexts/ThemeContext";
import { useAppColors } from "@/hooks/useAppColors";
import { useMutableResource } from "@/hooks/useMutableResource";
import {
  QualifyingTotalsData,
  qualifyingTotalsResource,
} from "@/lib/database/fetch-qualifying-totals";
import { standardsResource } from "@/lib/database/fetch-standards";
import {
  IntlRanking,
  intlRankingsResource,
} from "@/lib/database/fetchIntlRankings";
import { sortAgeGroups } from "@/lib/sortAgeGroups";
import { StandardsData } from "@/types/standards";
import {
  buildIntlRankingsWidgetPayload,
  buildQualifyingTotalsWidgetPayload,
  buildStandardsWidgetPayload,
  defaultWidgetSettings,
  formatAgeGroup,
  loadWidgetSettings,
  saveWidgetSettings,
  syncDataWidgets,
  WidgetKind,
  WidgetSettings,
} from "@/utils/dataWidgets";
import { Stack } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type ActiveModal = WidgetKind | null;

export default function WidgetSettingsScreen() {
  const colors = useAppColors();
  const { currentTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const [settings, setSettings] = useState<WidgetSettings>(defaultWidgetSettings);
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [isSaving, setIsSaving] = useState(false);

  const {
    data: totalsData,
    isInitialLoading: totalsLoading,
    error: totalsError,
  } = useMutableResource({
    resource: qualifyingTotalsResource,
    params: [] as const,
    initialData: {} as QualifyingTotalsData,
  });
  const {
    data: standardsData,
    isInitialLoading: standardsLoading,
    error: standardsError,
  } = useMutableResource({
    resource: standardsResource,
    params: [] as const,
    initialData: {} as StandardsData,
  });
  const {
    data: intlRankings,
    isInitialLoading: rankingsLoading,
    error: rankingsError,
  } = useMutableResource({
    resource: intlRankingsResource,
    params: [] as const,
    initialData: [] as IntlRanking[],
  });

  useEffect(() => {
    loadWidgetSettings()
      .then((stored) => setSettings(stored))
      .catch(() => setSettings(defaultWidgetSettings));
  }, []);

  const eventOptions = useMemo(
    () =>
      Object.keys(totalsData)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    [totalsData],
  );

  const meetOptions = useMemo(
    () =>
      Array.from(new Set(intlRankings.map((ranking) => ranking.meet)))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    [intlRankings],
  );

  const rankingsGenderOptions = useMemo(
    () =>
      Array.from(new Set(intlRankings.map((ranking) => ranking.gender)))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    [intlRankings],
  );

  useEffect(() => {
    setSettings((previous) => normalizeSettings(previous));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventOptions, meetOptions, intlRankings.length, totalsData]);

  const syncWidgets = async (nextSettings: WidgetSettings, showAlert = true) => {
    setIsSaving(true);
    try {
      await saveWidgetSettings(nextSettings);
      syncDataWidgets({
        qualifyingTotals: buildQualifyingTotalsWidgetPayload(
          totalsData,
          nextSettings.qualifyingTotals,
        ),
        standards: buildStandardsWidgetPayload(
          standardsData,
          nextSettings.standards,
        ),
        intlRankings: buildIntlRankingsWidgetPayload(
          intlRankings,
          nextSettings.intlRankings,
        ),
      });
      if (showAlert) {
        Alert.alert("Widget Settings Saved", "Your large widgets will update shortly.");
      }
    } catch (error) {
      console.error("Failed to save widget settings", error);
      Alert.alert("Error", "Failed to save widget settings. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleApply = (kind: WidgetKind, filters: Record<string, string>) => {
    const nextSettings = {
      ...settings,
      [kind]: filters,
    } as WidgetSettings;
    setSettings(nextSettings);
    setActiveModal(null);
    void syncWidgets(nextSettings, false);
  };

  const loading = totalsLoading || standardsLoading || rankingsLoading;
  const error = totalsError || standardsError || rankingsError;

  const qualifyingTotals = buildQualifyingTotalsWidgetPayload(
    totalsData,
    settings.qualifyingTotals,
  );
  const standards = buildStandardsWidgetPayload(
    standardsData,
    settings.standards,
  );
  const rankings = buildIntlRankingsWidgetPayload(
    intlRankings,
    settings.intlRankings,
  );

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title: "Widget Settings",
          headerBackTitle: "Back",
          headerShown: true,
          gestureEnabled: true,
          gestureDirection: "horizontal",
          animation: "slide_from_right",
          headerTitleStyle: {
            color: currentTheme === "dark" ? "#fff" : "#000",
          },
          headerStyle: {
            backgroundColor: currentTheme === "dark" ? "#000000" : "#F5F5F5",
          },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: "minimal",
          headerTintColor: colors.text,
        }}
      />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(32, insets.bottom + 24) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {loading && (
          <View style={[styles.statusRow, { backgroundColor: colors.card }]}>
            <ActivityIndicator color={colors.link} />
            <ThemedText style={[styles.statusText, { color: colors.secondaryText }]}>
              Loading widget data
            </ThemedText>
          </View>
        )}

        {!!error && (
          <View style={[styles.statusRow, { backgroundColor: colors.card }]}>
            <ThemedText style={[styles.statusText, { color: colors.danger }]}>
              {error}
            </ThemedText>
          </View>
        )}

        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <WidgetSettingsRow
            title="Qualifying Totals"
            subtitle={qualifyingTotals.subtitle}
            onPress={() => setActiveModal("qualifyingTotals")}
          />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <WidgetSettingsRow
            title="A/B Standards"
            subtitle={standards.subtitle}
            onPress={() => setActiveModal("standards")}
          />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <WidgetSettingsRow
            title="International Rankings"
            subtitle={rankings.subtitle || "Choose rankings filters"}
            onPress={() => setActiveModal("intlRankings")}
          />
        </View>

        <Pressable
          disabled={isSaving || loading}
          style={({ pressed }) => [
            styles.saveButton,
            { backgroundColor: colors.link },
            (isSaving || loading) && styles.disabled,
            pressed && !isSaving && !loading && { opacity: 0.85 },
          ]}
          onPress={() => void syncWidgets(settings)}
        >
          {isSaving ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <View style={styles.saveButtonContent}>
              <IconSymbol name="arrow.clockwise" size={18} color="#FFFFFF" />
              <ThemedText style={styles.saveButtonText}>Update Widgets</ThemedText>
            </View>
          )}
        </Pressable>
      </ScrollView>

      <GenericFilterModal
        visible={activeModal === "qualifyingTotals"}
        onClose={() => setActiveModal(null)}
        filters={settings.qualifyingTotals}
        onApplyFilters={(filters) => handleApply("qualifyingTotals", filters)}
        onResetFilters={() =>
          handleApply("qualifyingTotals", defaultWidgetSettings.qualifyingTotals)
        }
        sections={(tempFilters) => buildQualifyingTotalSections(tempFilters)}
        resultCount={(tempFilters) =>
          buildQualifyingTotalsWidgetPayload(
            totalsData,
            tempFilters as WidgetSettings["qualifyingTotals"],
          ).rows.length
        }
        resultLabel="weight classes"
      />

      <GenericFilterModal
        visible={activeModal === "standards"}
        onClose={() => setActiveModal(null)}
        filters={settings.standards}
        onApplyFilters={(filters) => handleApply("standards", filters)}
        onResetFilters={() =>
          handleApply("standards", defaultWidgetSettings.standards)
        }
        sections={standardSections}
        resultCount={(tempFilters) =>
          buildStandardsWidgetPayload(
            standardsData,
            tempFilters as WidgetSettings["standards"],
          ).rows.length
        }
        resultLabel="standards"
      />

      <GenericFilterModal
        visible={activeModal === "intlRankings"}
        onClose={() => setActiveModal(null)}
        filters={settings.intlRankings}
        onApplyFilters={(filters) => handleApply("intlRankings", filters)}
        onResetFilters={() =>
          handleApply("intlRankings", defaultWidgetSettings.intlRankings)
        }
        sections={(tempFilters) => buildRankingSections(tempFilters)}
        resultCount={(tempFilters) =>
          buildIntlRankingsWidgetPayload(
            intlRankings,
            tempFilters as WidgetSettings["intlRankings"],
          ).rows.length
        }
        resultLabel="rankings"
      />
    </ThemedView>
  );

  function normalizeSettings(previous: WidgetSettings): WidgetSettings {
    const nextEvent = eventOptions.includes(previous.qualifyingTotals.event)
      ? previous.qualifyingTotals.event
      : (eventOptions[0] ?? previous.qualifyingTotals.event);
    const totalAgeOptions = nextEvent
      ? sortAgeGroups(Object.keys(totalsData[nextEvent] ?? {}), {
          includeExtended: true,
        })
      : [];
    const nextTotalAge = totalAgeOptions.includes(previous.qualifyingTotals.ageGroup)
      ? previous.qualifyingTotals.ageGroup
      : (totalAgeOptions[0] ?? previous.qualifyingTotals.ageGroup);

    const nextMeet = previous.intlRankings.meet || meetOptions[0] || "";
    const rankingAgeOptions = getRankingAgeOptions(nextMeet);
    const nextRankingAge = rankingAgeOptions.includes(previous.intlRankings.ageCategory)
      ? previous.intlRankings.ageCategory
      : (rankingAgeOptions.includes("Senior")
          ? "Senior"
          : rankingAgeOptions[0] ?? previous.intlRankings.ageCategory);
    const previousRankingGender = previous.intlRankings.gender;
    const nextRankingGender = previousRankingGender &&
      rankingsGenderOptions.includes(previousRankingGender)
      ? previousRankingGender
      : ((rankingsGenderOptions.includes("Men")
          ? "Men"
          : rankingsGenderOptions[0]) as WidgetSettings["intlRankings"]["gender"] | undefined) ??
        previous.intlRankings.gender;

    return {
      qualifyingTotals: {
        ...previous.qualifyingTotals,
        event: nextEvent,
        ageGroup: nextTotalAge,
      },
      standards: previous.standards,
      intlRankings: {
        meet: nextMeet,
        ageCategory: nextRankingAge,
        gender: nextRankingGender,
      },
    };
  }

  function buildQualifyingTotalSections(
    tempFilters: Record<string, string>,
  ): FilterSection[] {
    const selectedEvent = tempFilters.event || settings.qualifyingTotals.event;
    const ageOptions = selectedEvent
      ? sortAgeGroups(Object.keys(totalsData[selectedEvent] ?? {}), {
          includeExtended: true,
        })
      : [];

    return [
      {
        id: "event",
        title: "Event",
        options: eventOptions.map((event) => ({ value: event, label: event })),
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
        options: ageOptions.map((ageGroup) => ({
          value: ageGroup,
          label: formatAgeGroup(ageGroup),
        })),
        dependsOn: ["event"],
      },
    ];
  }

  function getRankingAgeOptions(meet: string) {
    return sortAgeGroups(
      Array.from(
        new Set(
          intlRankings
            .filter((ranking) => !meet || ranking.meet === meet)
            .map((ranking) => ranking.ageCategory),
        ),
      ).filter(Boolean),
      { includeExtended: true },
    );
  }

  function buildRankingSections(
    tempFilters: Record<string, string>,
  ): FilterSection[] {
    const selectedMeet = tempFilters.meet || settings.intlRankings.meet;
    const ageOptions = getRankingAgeOptions(selectedMeet);

    return [
      {
        id: "meet",
        title: "Meet",
        options: meetOptions.map((meet) => ({ value: meet, label: meet })),
      },
      {
        id: "ageCategory",
        title: "Age Category",
        options: ageOptions.map((ageCategory) => ({
          value: ageCategory,
          label: ageCategory,
        })),
        dependsOn: ["meet"],
      },
      {
        id: "gender",
        title: "Gender",
        options: rankingsGenderOptions.map((gender) => ({
          value: gender,
          label: gender,
        })),
      },
    ];
  }
}

const standardSections: FilterSection[] = [
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

function WidgetSettingsRow({
  title,
  subtitle,
  onPress,
}: {
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const colors = useAppColors();

  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: colors.pressed },
      ]}
      onPress={onPress}
    >
      <View style={styles.rowText}>
        <ThemedText style={[styles.rowTitle, { color: colors.text }]}>
          {title}
        </ThemedText>
        <ThemedText
          numberOfLines={1}
          ellipsizeMode="tail"
          style={[styles.rowSubtitle, { color: colors.secondaryText }]}
        >
          {subtitle}
        </ThemedText>
      </View>
      <View style={styles.rowTrailing}>
        <IconSymbol
          name={Platform.OS === "ios" ? "chevron.right" : "chevron-forward"}
          size={20}
          color={colors.link}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  statusRow: {
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
    padding: 14,
  },
  statusText: {
    flex: 1,
    fontSize: 15,
  },
  card: {
    borderRadius: 12,
    marginBottom: 16,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  row: {
    minHeight: 76,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    marginRight: 12,
  },
  rowTitle: {
    fontSize: 17,
    fontWeight: "500",
    marginBottom: 4,
  },
  rowSubtitle: {
    fontSize: 14,
  },
  rowTrailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 16,
  },
  saveButton: {
    minHeight: 52,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  saveButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  disabled: {
    opacity: 0.65,
  },
  saveButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
  },
});
