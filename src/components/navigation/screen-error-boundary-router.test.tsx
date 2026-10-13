/**
 * Root-layout navigation in a real expo-router tree shaped like the app's:
 * root Stack > `(tabs)` Tabs > one Stack per tab.
 *
 * - `unstable_screenErrorBoundary`: expo-router passes the boundary down by
 *   context and wraps leaf routes only, never the `(tabs)` layout, so a tab
 *   screen that throws keeps the tab bar and the other tabs.
 * - The `/open/saved` widget link (`useRedirectIntoTabs`, which
 *   `DismissToRedirect` wraps): a link pushed over the running tabs pops
 *   back to them instead of stacking a second tabs navigator, and a cold
 *   start into the link still lands on one.
 */
import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { ExpoRoot, router, Stack, Tabs } from "expo-router";
import { navigationRef } from "expo-router/build/global-state/navigationRef";
import { getMockContext } from "expo-router/build/testing-library/mock-config";
import OpenSavedScreen from "@/app/open/saved";
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
    act(() => renderer.unmount());
  });
});

describe("redirecting into the running tabs", () => {
  let mounted: ReactTestRenderer | undefined;

  beforeEach(() => {
    jest.useFakeTimers();
    process.env.EXPO_ROUTER_IMPORT_MODE = "sync";
  });

  afterEach(() => {
    act(() => mounted?.unmount());
    mounted = undefined;
    jest.useRealTimers();
  });

  function appContext() {
    return getMockContext({
      _layout: () => <Stack screenOptions={{ headerShown: false }} />,
      "(tabs)/_layout": () => (
        <Tabs>
          <Tabs.Screen name="(index)" />
          <Tabs.Screen name="(saved)" />
        </Tabs>
      ),
      "(tabs)/(index)/_layout": () => <Stack />,
      "(tabs)/(index)/index": () => <Text>Schedule</Text>,
      "(tabs)/(saved)/_layout": () => <Stack />,
      "(tabs)/(saved)/index": () => <Text>Saved sessions</Text>,
      "comp-data/records": () => <Text>Records</Text>,
      "open/saved": OpenSavedScreen,
    });
  }

  function settle(): void {
    act(() => {
      jest.runOnlyPendingTimers();
    });
  }

  /** The root stack's route names and the focused tab. */
  function rootShape(): { stack: string[]; tab: string | undefined } {
    // expo-router nests the root layout's stack under a `__root` route.
    const state = navigationRef.getRootState().routes[0]?.state;
    if (!state) throw new Error("root stack not mounted");
    const tabs = state.routes.find((route) => route.name === "(tabs)")?.state;
    return {
      stack: state.routes.map((route) => route.name),
      tab: tabs ? tabs.routes[tabs.index ?? 0]?.name : undefined,
    };
  }

  it("pops a widget link pushed over the running app back to the existing tabs", () => {
    act(() => {
      mounted = create(<ExpoRoot context={appContext()} location="/" />);
    });
    settle();
    act(() => router.push("/comp-data/records"));
    settle();
    expect(rootShape().stack).toEqual(["(tabs)", "comp-data/records"]);

    act(() => router.push("/open/saved"));
    settle();

    expect(rootShape()).toEqual({ stack: ["(tabs)"], tab: "(saved)" });
  });

  it("lands a cold start into the link on a single tabs navigator", () => {
    act(() => {
      mounted = create(<ExpoRoot context={appContext()} location="/open/saved" />);
    });
    settle();

    expect(rootShape()).toEqual({ stack: ["(tabs)"], tab: "(saved)" });
  });
});
