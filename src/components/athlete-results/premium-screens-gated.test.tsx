/**
 * The Attempt Estimator and Athlete Results are premium screens. The buttons
 * that open them check the subscription, but a `meetcal://` deep link reaches
 * the route directly, so each screen must sit behind `SubscriptionGate`.
 */
import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import AttemptEstimatorScreen from "@/app/shared-screens/attempt-estimator";
import AthleteResultsScreen from "@/app/shared-screens/athlete-results";

// A gate that never lets the screen through, as for a free user.
jest.mock("@/components/ui/SubscriptionGate", () => {
  const { Text: MockText } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    SubscriptionGate: ({ feature }: { feature?: string; children: React.ReactNode }) => (
      <MockText>{`gate:${feature}`}</MockText>
    ),
  };
});
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  default: { View: jest.requireActual("react-native").View },
  FadeIn: { duration: () => ({}) },
  useSharedValue: (value: number) => ({ value }),
  useAnimatedStyle: () => ({}),
  withTiming: (value: number) => value,
  withRepeat: (value: number) => value,
}));
jest.mock("@shopify/flash-list", () => ({ FlashList: () => null }));
jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({}),
}));

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => String(node.props.children));
}

describe.each([
  ["Attempt Estimator", AttemptEstimatorScreen, "attempt-estimator"],
  ["Athlete Results", AthleteResultsScreen, "athlete-results"],
])("%s", (_name, Screen, feature) => {
  it("renders only behind the subscription gate", () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Screen />);
    });

    expect(texts(renderer)).toEqual([`gate:${feature}`]);
  });
});
