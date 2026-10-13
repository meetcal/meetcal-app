/**
 * The root `Stack`'s `unstable_screenErrorBoundary` in a real expo-router
 * tree shaped like the app's: root Stack > `(tabs)` Tabs > one Stack per tab.
 * expo-router passes the boundary down by context and wraps leaf routes only,
 * never the `(tabs)` layout, so a tab screen that throws keeps the tab bar
 * and the other tabs.
 */
import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { ExpoRoot, Stack, Tabs } from "expo-router";
import { getMockContext } from "expo-router/build/testing-library/mock-config";
import { ScreenErrorBoundary } from "@/components/navigation/ScreenErrorBoundary";

jest.mock("@sentry/react-native", () => ({ captureException: jest.fn() }));
jest.mock("@/lib/haptics", () => ({ lightImpact: jest.fn() }));
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  default: { View: jest.requireActual("react-native").View },
  useSharedValue: (value: number) => ({ value }),
  useAnimatedStyle: () => ({}),
  withSpring: () => 1,
}));

function ThrowingSchedule(): React.ReactElement {
  throw new Error("bad row");
}

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => String(node.props.children));
}

describe("unstable_screenErrorBoundary on the root Stack", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    process.env.EXPO_ROUTER_IMPORT_MODE = "sync";
    // React logs caught render errors.
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("catches a tab screen's render error inside the tab, keeping the tab bar", () => {
    const context = getMockContext({
      _layout: () => (
        <Stack
          screenOptions={{ headerShown: false }}
          unstable_screenErrorBoundary={ScreenErrorBoundary}
        />
      ),
      "(tabs)/_layout": () => (
        <Tabs>
          <Tabs.Screen name="(index)" options={{ title: "Schedule tab" }} />
          <Tabs.Screen name="(saved)" options={{ title: "Saved tab" }} />
        </Tabs>
      ),
      "(tabs)/(index)/_layout": () => <Stack />,
      "(tabs)/(index)/index": ThrowingSchedule,
      "(tabs)/(saved)/_layout": () => <Stack />,
      "(tabs)/(saved)/saved": () => <Text>Saved sessions</Text>,
    });

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<ExpoRoot context={context} location="/" />);
    });
    act(() => {
      jest.runOnlyPendingTimers();
    });

    const shown = texts(renderer);
    expect(shown).toContain("Something went wrong");
    // The tab navigator still renders its bar: the boundary sits inside it.
    expect(shown).toEqual(expect.arrayContaining(["Schedule tab", "Saved tab"]));
  });
});
