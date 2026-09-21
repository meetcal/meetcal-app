import { IconSymbol } from "@/components/ui/IconSymbol";
import { getChevronIcon } from "@/lib/start-list-utils";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { GenericFilterModal } from "@/components/ui/filters";
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
import { StandardsData } from "@/types/standards";
import {
  buildIntlRankingsFilterSections,
  buildIntlRankingsWidgetPayload,
  buildQualifyingTotalsFilterSections,
  buildQualifyingTotalsWidgetPayload,
  buildStandardsWidgetPayload,
  DataWidgetPayload,
  defaultWidgetSettings,
  hasResolvedWidgetFilters,
  loadWidgetSettings,
  normalizeWidgetSettings,
  saveWidgetSettings,
  STANDARDS_FILTER_SECTIONS,
  syncDataWidgets,
  WidgetKind,
  WidgetSettings,
} from "@/utils/dataWidgets";
import { Stack } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { showToast } from "@/components/ui/Toast";
import { useScreenHorizontalInsets } from "@/hooks/useScreenInsets";

type ActiveModal = WidgetKind | null;

type WidgetPayloads = {
  qualifyingTotals: DataWidgetPayload;
  standards: DataWidgetPayload;
  intlRankings: DataWidgetPayload;
};

type CommitOptions = {
  /**
   * The user pressed something: show the saving spinner and surface failures as
   * a toast. Background commits stay silent.
   */
  interactive?: boolean;
  /** Only the explicit "Update Widgets" button confirms success. */
  announceSuccess?: boolean;
  /** Skip when this exact payload has already been written. */
  dedupe?: boolean;
};

export default function WidgetSettingsScreen() {
  const screenInsets = useScreenHorizontalInsets();
  const colors = useAppColors();
  const { currentTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const [settings, setSettings] = useState<WidgetSettings>(defaultWidgetSettings);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [isSaving, setIsSaving] = useState(false);
  const lastCommittedSignature = useRef<string | null>(null);

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
    let isCancelled = false;
    loadWidgetSettings()
      .then((stored) => {
        if (!isCancelled) setSettings(stored);
      })
      .catch(() => {
        if (!isCancelled) setSettings(defaultWidgetSettings);
      })
      .finally(() => {
        if (!isCancelled) setSettingsLoaded(true);
      });
    return () => {
      isCancelled = true;
    };
  }, []);

  // Heal stored filters against what the freshly fetched data actually offers.
  // `normalizeWidgetSettings` returns the same object when nothing changed, so
  // this cannot loop.
  useEffect(() => {
    if (!settingsLoaded) return;
    setSettings((previous) =>
      normalizeWidgetSettings(previous, totalsData, intlRankings),
    );
  }, [intlRankings, settingsLoaded, totalsData]);

  const buildPayloads = useCallback(
    (next: WidgetSettings): WidgetPayloads => ({
      qualifyingTotals: buildQualifyingTotalsWidgetPayload(
        totalsData,
        next.qualifyingTotals,
      ),
      standards: buildStandardsWidgetPayload(standardsData, next.standards),
      intlRankings: buildIntlRankingsWidgetPayload(
        intlRankings,
        next.intlRankings,
      ),
    }),
    [intlRankings, standardsData, totalsData],
  );

  /**
   * The single write path. Persist first, then push to the native widget, so a
   * widget never renders settings that failed to store. `dedupe` lets the
   * background commit skip a payload byte-identical to the one already written
   * — including one the user just applied by hand.
   */
  const commitWidgets = useCallback(
    async (next: WidgetSettings, options: CommitOptions = {}) => {
      const payloads = buildPayloads(next);
      const signature = JSON.stringify(payloads);
      if (options.dedupe && lastCommittedSignature.current === signature) return;
      lastCommittedSignature.current = signature;

      if (options.interactive) setIsSaving(true);
      try {
        await saveWidgetSettings(next);
        syncDataWidgets(payloads);
        if (options.announceSuccess) {
          showToast({
            type: "success",
            message: "Widget settings saved. Your widgets will update shortly.",
          });
        }
      } catch (commitError) {
        console.error("Failed to save widget settings", commitError);
        // Nothing landed, so the next commit must not dedupe against it.
        lastCommittedSignature.current = null;
        if (options.interactive) {
          showToast({
            type: "error",
            message: "Failed to save widget settings. Please try again.",
          });
        }
      } finally {
        if (options.interactive) setIsSaving(false);
      }
    },
    [buildPayloads],
  );

  const handleApply = (kind: WidgetKind, filters: Record<string, string>) => {
    const nextSettings = {
      ...settings,
      [kind]: filters,
    } as WidgetSettings;
    setSettings(nextSettings);
    setActiveModal(null);
    void commitWidgets(nextSettings, { interactive: true });
  };

  const loading = totalsLoading || standardsLoading || rankingsLoading;
  const error = totalsError || standardsError || rankingsError;

  const {
    qualifyingTotals,
    standards,
    intlRankings: rankings,
  } = useMemo(() => buildPayloads(settings), [buildPayloads, settings]);

  useEffect(() => {
    if (!settingsLoaded || loading || error) return;
    if (
      !hasResolvedWidgetFilters(settings, totalsData, standardsData, intlRankings)
    ) {
      return;
    }
    void commitWidgets(settings, { dedupe: true });
  }, [
    commitWidgets,
    error,
    intlRankings,
    loading,
    settings,
    settingsLoaded,
    standardsData,
    totalsData,
  ]);

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }, screenInsets]}>
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
          onPress={() =>
            void commitWidgets(settings, {
              interactive: true,
              announceSuccess: true,
            })
          }
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
        sections={(tempFilters) =>
          buildQualifyingTotalsFilterSections(
            totalsData,
            tempFilters.event || settings.qualifyingTotals.event,
          )
        }
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
        sections={STANDARDS_FILTER_SECTIONS}
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
        sections={(tempFilters) =>
          buildIntlRankingsFilterSections(
            intlRankings,
            tempFilters.meet || settings.intlRankings.meet,
          )
        }
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

}

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
          name={getChevronIcon("right")}
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
