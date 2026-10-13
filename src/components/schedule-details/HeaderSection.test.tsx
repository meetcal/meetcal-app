/**
 * The session summary's time-zone label must describe the meet the screen is
 * showing (the `meet` route param), not whichever meet is selected in the
 * picker. The selection is app state, so it is stubbed at the hook.
 */
import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
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
// The calendar picker pads for the iPhone Duo side band (`useScreenHorizontalInsets`).
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("expo-store-review", () => ({}));
jest.mock("@/components/ui/IconSymbol", () => ({ IconSymbol: () => null }));
jest.mock("@/utils/calendar", () => ({}));
let mockSignedIn = true;
jest.mock("@/utils/authGuard", () => ({
  useAuthGuard: () => ({ requireAuth: () => mockSignedIn }),
}));
let mockSubscribed: boolean | null = true;
jest.mock("@/contexts/SubscriptionContext", () => ({
  useSubscription: () => ({ isSubscribed: mockSubscribed, isLoading: false }),
}));
jest.mock("@/lib/toast", () => ({ showToast: jest.fn() }));
const mockExportSessions = jest.fn();
jest.mock("@/hooks/useCalendarSessionsExport", () => ({
  useCalendarSessionsExport: () => ({
    exportSessions: mockExportSessions,
    picker: { visible: false, destinations: [], isLoading: false, onClose: jest.fn(), onSelect: jest.fn() },
  }),
}));
jest.mock("@/contexts/SavedSessionsContext", () => ({
  useSavedSessions: () => ({
    saveSession: jest.fn(),
    removeSession: jest.fn(),
    isSessionSaved: () => false,
  }),
}));

function meetIn(name: string, abbreviation: string, timeZoneIdentifier = ""): Meet {
  return { name, time: { abbreviation, timeZoneIdentifier } } as unknown as Meet;
}

let mockSelection: { meetDetails: Meet | null; availableMeets: Meet[] };
jest.mock("@/contexts/SelectedMeetContext", () => ({
  useSelectedMeet: () => mockSelection,
}));

async function render(
  meet: string,
  { sessionFullDate = "2099-06-20", platformStartTime = "9:00 AM" } = {},
): Promise<ReactTestRenderer> {
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
        platformStartTime={platformStartTime}
        platformWeighInTime="7:00 AM"
        sessionFullDate={sessionFullDate}
      />,
    );
  });
  return renderer;
}

function pressText(renderer: ReactTestRenderer, label: string) {
  const textOf = (node: ReactTestInstance): string =>
    ([] as unknown[]).concat(node.props.children).filter((c) => typeof c === "string").join("");
  const button = renderer.root
    .findAll((node) => typeof node.props.onPress === "function")
    .find((node) => node.findAllByType(Text).some((text) => textOf(text).trim() === label));
  if (!button) throw new Error(`no button "${label}"`);
  act(() => {
    button.props.onPress();
  });
}

async function summaryFor(meet: string, sessionFullDate?: string): Promise<string> {
  const renderer = await render(meet, { sessionFullDate });
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

  it("reads TBD, with no stray zone, for a row the schedule has not timed", async () => {
    mockSelection = { meetDetails: selected, availableMeets: [selected, other] };
    const renderer = await render("Selected Open", { platformStartTime: "" });
    const first = renderer.root.findAllByType(Text)[0];
    expect(([] as unknown[]).concat(first.props.children).join("")).toBe("Session 3 • TBD");
  });

  it("omits the label when the shown meet is not known", async () => {
    mockSelection = { meetDetails: selected, availableMeets: [selected] };
    await expect(summaryFor("Unlisted Open")).resolves.toBe("Session 3 • 9:00 AM");
  });
});

// #284: the label is read at the session's own date, not the meet's first day.
describe("HeaderSection time-zone label across a DST change", () => {
  const newYork = meetIn("Fall Open", "EDT", "America/New_York");

  it("labels a session after the change with the zone then in force", async () => {
    mockSelection = { meetDetails: newYork, availableMeets: [newYork] };
    await expect(summaryFor("Fall Open", "2026-10-31")).resolves.toBe("Session 3 • 9:00 AM EDT");
    await expect(summaryFor("Fall Open", "2026-11-02")).resolves.toBe("Session 3 • 9:00 AM EST");
  });
});

// #340: the same sign-in and subscription gate as the Saved tab and Start List.
describe("HeaderSection Add to Calendar", () => {
  const meet = meetIn("Selected Open", "EDT", "America/New_York");

  beforeEach(() => {
    jest.clearAllMocks();
    mockSignedIn = true;
    mockSubscribed = true;
    mockSelection = { meetDetails: meet, availableMeets: [meet] };
  });

  it("adds the session for a signed-in subscriber", async () => {
    pressText(await render("Selected Open"), "Add to Calendar");
    expect(mockExportSessions).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          date: "2099-06-20",
          startTime: "9:00 AM",
          weighInTime: "7:00 AM",
          sessionNumber: "3",
          platform: "Red",
          meet: "Selected Open",
        }),
      ],
      { confirm: false, systemEditor: true },
    );
  });

  it("asks a signed-out user to sign in and writes nothing", async () => {
    mockSignedIn = false;
    pressText(await render("Selected Open"), "Add to Calendar");
    expect(mockExportSessions).not.toHaveBeenCalled();
  });

  it("sends a free user to the paywall and writes nothing", async () => {
    mockSubscribed = false;
    pressText(await render("Selected Open"), "Add to Calendar");
    expect(mockExportSessions).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/shared-screens/paywall",
      params: expect.objectContaining({ feature: "add-to-calendar" }),
    });
  });

  it("does not try to write a session the schedule has not timed yet", async () => {
    pressText(await render("Selected Open", { platformStartTime: "" }), "Add to Calendar");
    expect(mockExportSessions).not.toHaveBeenCalled();
  });
});

// #309: the Qualifying Totals screen reads only event / gender / age group.
describe("HeaderSection Qualifying Totals", () => {
  it("opens the screen without parameters it would ignore", async () => {
    jest.clearAllMocks();
    mockSignedIn = true;
    mockSubscribed = true;
    const meet = meetIn("Selected Open", "EDT", "America/New_York");
    mockSelection = { meetDetails: meet, availableMeets: [meet] };
    pressText(await render("Selected Open"), "Qualifying Totals");
    expect(mockPush).toHaveBeenCalledWith("/comp-data/new-qualifying-totals");
  });
});
