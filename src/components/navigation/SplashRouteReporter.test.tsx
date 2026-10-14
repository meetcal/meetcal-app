/**
 * The launch splash's route check in a real expo-router tree shaped like the
 * app's: root Stack > `(tabs)` > one Stack per tab, every tab screen an
 * `index` in its group folder (so all four have the pathname "/"). The root
 * layout renders `SplashRouteReporter` beside its Stack, as `app/_layout.tsx`
 * does.
 */
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { ExpoRoot, Stack, Tabs } from "expo-router";
import { getMockContext } from "expo-router/build/testing-library/mock-config";

import { SplashRouteReporter } from "@/components/navigation/SplashRouteReporter";
import OpenSavedScreen from "@/app/open/saved";
import { createSplashGate, isScheduleRoute, SPLASH_HOLD_MAX_MS } from "@/lib/startup-splash";
import { createStartupTiming } from "@/lib/startup-timing";

jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  default: { View: jest.requireActual("react-native").View },
  useSharedValue: (value: number) => ({ value }),
  useAnimatedStyle: () => ({}),
  withSpring: () => 1,
}));

const Screen = () => null;

function launch(location: string) {
  const timing = createStartupTiming({
    now: () => Date.now(),
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  });
  const gate = createSplashGate({
    timing,
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  });
  const hide = jest.fn(async () => undefined);
  const setRoute = jest.spyOn(gate, "setRoute");

  const context = getMockContext({
    _layout: () => (
      <>
        <Stack screenOptions={{ headerShown: false }} />
        <SplashRouteReporter gate={gate} />
      </>
    ),
    "(tabs)/_layout": () => (
      <Tabs>
        <Tabs.Screen name="(index)" />
        <Tabs.Screen name="(saved)" />
        <Tabs.Screen name="(start-list)" />
        <Tabs.Screen name="(info)" />
      </Tabs>
    ),
    "(tabs)/(index)/_layout": () => <Stack />,
    "(tabs)/(index)/index": Screen,
    "(tabs)/(saved)/_layout": () => <Stack />,
    "(tabs)/(saved)/index": Screen,
    "(tabs)/(start-list)/_layout": () => <Stack />,
    "(tabs)/(start-list)/index": Screen,
    "(tabs)/(info)/_layout": () => <Stack />,
    "(tabs)/(info)/index": Screen,
    "open/saved": OpenSavedScreen,
    "shared-screens/schedule-details": Screen,
  });

  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<ExpoRoot context={context} location={location} />);
  });
  act(() => {
    jest.runOnlyPendingTimers();
  });
  // Armed once the router has settled, so its timers above do not fire the
  // cap; what the reporter said before counts (the app arms first).
  gate.arm(hide);
  return { timing, gate, hide, renderer, setRoute };
}

describe("SplashRouteReporter", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    process.env.EXPO_ROUTER_IMPORT_MODE = "sync";
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("holds the splash on a plain launch, which opens on the Schedule tab", () => {
    const { timing, hide, renderer, setRoute } = launch("/");
    expect(setRoute.mock.calls).toEqual([[true]]);
    expect(hide).not.toHaveBeenCalled();
    expect(timing.outcome()).toBeNull();

    act(() => {
      jest.advanceTimersByTime(SPLASH_HOLD_MAX_MS);
    });
    expect(hide).toHaveBeenCalledTimes(1);
    expect(timing.properties().splash_hide_reason).toBe("cap");
    act(() => renderer.unmount());
  });

  it.each([
    ["the Saved tab", "/(tabs)/(saved)"],
    ["the Start List tab", "/(tabs)/(start-list)"],
    ["the saved widget's link", "/open/saved"],
    ["a session deep link", "/shared-screens/schedule-details?meet=X&sessionNumber=3&platform=Red"],
  ])("counts a launch on %s as another route and hides the splash at once", (_label, location) => {
    const { timing, gate, hide, renderer } = launch(location);
    expect(hide).toHaveBeenCalledTimes(1);
    expect(gate.isHidden()).toBe(true);
    expect(timing.properties()).toMatchObject({
      outcome: "other-route",
      splash_hide_reason: "other-route",
    });
    act(() => renderer.unmount());
  });
});

describe("isScheduleRoute", () => {
  it.each<[string[], boolean | null]>([
    [[], null],
    [["(tabs)", "(index)"], true],
    [["(tabs)", "(index)", "index"], true],
    [["(tabs)", "(saved)"], false],
    [["(tabs)", "(index)", "details"], false],
    [["(auth)", "sign-in"], false],
    [["shared-screens", "schedule-details"], false],
  ])("%j -> %s", (segments, expected) => {
    expect(isScheduleRoute(segments)).toBe(expected);
  });
});
