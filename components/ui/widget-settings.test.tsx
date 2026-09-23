import React from "react";
import { act, create } from "react-test-renderer";
import WidgetSettingsScreen from "@/app/schedule-toolbar/widget-settings";
import { GenericFilterModal } from "@/components/ui/filters";
import { defaultWidgetSettings, saveWidgetSettings, syncDataWidgets } from "@/utils/dataWidgets";

jest.mock("@/components/ui/Toast", () => ({ showToast: jest.fn() }));
jest.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ currentTheme: "light" }) }));
jest.mock("expo-router", () => ({ Stack: { Screen: () => null } }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@/components/ui/filters", () => ({ GenericFilterModal: () => null }));
jest.mock("@/hooks/useMutableResource", () => ({
  useMutableResource: ({ initialData }: { initialData: unknown }) => ({
    data: initialData, isInitialLoading: false, error: null,
  }),
}));
jest.mock("@/utils/dataWidgets", () => {
  const actual = jest.requireActual("@/utils/dataWidgets");
  return {
    ...actual,
    loadWidgetSettings: jest.fn(async () => actual.defaultWidgetSettings),
    saveWidgetSettings: jest.fn(async () => {}),
    syncDataWidgets: jest.fn(),
    hasResolvedWidgetFilters: () => false,
  };
});

describe("widget settings commits", () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it("continues saving after an earlier storage write rejects", async () => {
    const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
    jest.mocked(saveWidgetSettings).mockRejectedValueOnce(new Error("Storage failed"));
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<WidgetSettingsScreen />); });
    const apply = () => tree.root.findAllByType(GenericFilterModal)[1].props.onApplyFilters;
    await act(async () => { apply()({ gender: "women", ageGroup: "senior" }); });
    expect(syncDataWidgets).not.toHaveBeenCalled();
    await act(async () => { apply()({ gender: "men", ageGroup: "junior" }); });
    expect(saveWidgetSettings).toHaveBeenCalledTimes(2);
    expect(syncDataWidgets).toHaveBeenCalledTimes(1);
    await act(async () => { tree.unmount(); });
    errorLog.mockRestore();
  });
  it("serializes overlapping filter changes before updating the native widgets", async () => {
    let releaseFirst!: () => void;
    jest.mocked(saveWidgetSettings).mockImplementationOnce(
      () => new Promise<void>((resolve) => { releaseFirst = resolve; }),
    );
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<WidgetSettingsScreen />); });
    const standardsModal = () => tree.root.findAllByType(GenericFilterModal)[1];
    await act(async () => {
      standardsModal().props.onApplyFilters({ gender: "women", ageGroup: "senior" });
    });
    await act(async () => {
      standardsModal().props.onApplyFilters({ gender: "men", ageGroup: "junior" });
    });
    expect(saveWidgetSettings).toHaveBeenCalledTimes(1);
    expect(syncDataWidgets).not.toHaveBeenCalled();
    await act(async () => { releaseFirst(); });
    expect(saveWidgetSettings).toHaveBeenCalledTimes(2);
    expect(saveWidgetSettings).toHaveBeenLastCalledWith({
      ...defaultWidgetSettings,
      standards: { gender: "men", ageGroup: "junior" },
    });
    expect(syncDataWidgets).toHaveBeenCalledTimes(2);
    await act(async () => { tree.unmount(); });
  });
});
