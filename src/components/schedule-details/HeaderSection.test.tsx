/**
 * The session summary's time-zone label must describe the meet the screen is
 * showing (the `meet` route param), not whichever meet is selected in the
 * picker. The selection is app state, so it is stubbed at the hook.
 */
import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { Meet } from "@/data/types/meet";
import HeaderSection from "@/components/schedule-details/HeaderSection";

jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  default: { View: jest.requireActual("react-native").View },
  useSharedValue: (value: number) => ({ value }),
  useAnimatedStyle: () => ({}),
  withSequence: () => 1,
  withSpring: () => 1,
}));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("expo-store-review", () => ({}));
jest.mock("@/components/ui/IconSymbol", () => ({ IconSymbol: () => null }));
jest.mock("@/utils/calendar", () => ({}));
jest.mock("@/utils/authGuard", () => ({ useAuthGuard: () => ({ requireAuth: () => true }) }));
jest.mock("@/contexts/SubscriptionContext", () => ({
  useSubscription: () => ({ isSubscribed: true }),
}));
jest.mock("@/contexts/SavedSessionsContext", () => ({
  useSavedSessions: () => ({
    saveSession: jest.fn(),
    removeSession: jest.fn(),
    isSessionSaved: () => false,
  }),
}));

function meetIn(name: string, abbreviation: string): Meet {
  return { name, time: { abbreviation } } as unknown as Meet;
}

let mockSelection: { meetDetails: Meet | null; availableMeets: Meet[] };
jest.mock("@/contexts/SelectedMeetContext", () => ({
  useSelectedMeet: () => mockSelection,
}));

async function summaryFor(meet: string): Promise<string> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <HeaderSection
        sessionNumber="3"
        platform="Red"
        weightClass="W71"
        startTime="9:00 AM"
        meet={meet}
        currentSchedule={[]}
        sessionId="s-3"
        sessionDate="2099-06-20"
        sessionWeightClass="W71"
        platformStartTime="9:00 AM"
        platformWeighInTime="7:00 AM"
      />,
    );
  });
  const first = renderer.root.findAllByType(Text)[0];
  return ([] as unknown[]).concat(first.props.children).join("");
}

describe("HeaderSection time-zone label", () => {
  const selected = meetIn("Selected Open", "MDT");
  const other = meetIn("Other Open", "EST");

  it("uses the selected meet's zone when it is the meet on screen", async () => {
    mockSelection = { meetDetails: selected, availableMeets: [selected, other] };
    await expect(summaryFor("Selected Open")).resolves.toBe("Session 3 • 9:00 AM MDT");
  });

  it("uses the shown meet's zone, not the selected meet's, for another meet", async () => {
    mockSelection = { meetDetails: selected, availableMeets: [selected, other] };
    await expect(summaryFor("Other Open")).resolves.toBe("Session 3 • 9:00 AM EST");
  });

  it("omits the label when the shown meet is not known", async () => {
    mockSelection = { meetDetails: selected, availableMeets: [selected] };
    await expect(summaryFor("Unlisted Open")).resolves.toBe("Session 3 • 9:00 AM");
  });
});
