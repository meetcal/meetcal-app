import React from "react";
import { Alert } from "react-native";
import { act, create } from "react-test-renderer";

import SavedScreen from "@/app/(tabs)/(saved)/index";
import type { SavedSession } from "@/lib/saved-sessions-store";

const mockResetAllSessions = jest.fn(async () => true);
const mockMigrateLegacySessions = jest.fn(async () => true);
let mockSavedSessions: SavedSession[] = [];
jest.mock("@/contexts/SavedSessionsContext", () => ({
  useSavedSessions: () => ({
    savedSessions: mockSavedSessions,
    isLoading: false,
    authExpired: false,
    syncFailed: false,
    loadSavedSessions: jest.fn(async () => undefined),
    resetAllSessions: mockResetAllSessions,
    migrateLegacySessions: mockMigrateLegacySessions,
  }),
}));

let mockAvailableMeets: { name: string }[] = [];
jest.mock("@/contexts/SelectedMeetContext", () => ({
  useSelectedMeet: () => ({
    selectedMeet: "Ended Meet",
    availableMeets: mockAvailableMeets,
    meetDetails: null,
  }),
}));
jest.mock("@/contexts/SubscriptionContext", () => ({
  useSubscription: () => ({ isSubscribed: true, isLoading: false }),
}));
// Offline: Clerk never loads, so there is no Clerk user; the cached sign-in
// is what `requireAuth` trusts.
jest.mock("@clerk/expo", () => ({ useUser: () => ({ user: null, isLoaded: false }) }));
jest.mock("@/utils/authGuard", () => ({ useAuthGuard: () => ({ requireAuth: () => true }) }));
jest.mock("@/hooks/useCalendarSessionsExport", () => ({
  useCalendarSessionsExport: () => ({
    exportSessions: jest.fn(),
    picker: { visible: false, destinations: [], onClose: jest.fn(), onSelect: jest.fn(), isLoading: false },
  }),
}));
jest.mock("@/hooks/saved-sessions/useSavedScheduleLookup", () => ({
  useSavedScheduleLookup: () => ({ sessionLookupByMeet: new Map(), isLoading: false }),
}));
const mockSetOptions = jest.fn();
jest.mock("expo-router", () => {
  const { useEffect } = jest.requireActual("react");
  return {
    useFocusEffect: (effect: () => void) => useEffect(() => effect(), [effect]),
    useNavigation: () => ({ setOptions: mockSetOptions }),
    useRouter: () => ({ push: jest.fn() }),
  };
});
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@/hooks/useScreenInsets", () => ({ useScreenHorizontalInsets: () => ({}) }));
jest.mock("@/components/saved/NextSessionCard", () => ({ NextSessionCard: () => null }));
jest.mock("@/components/calendar/CalendarDestinationPickerModal", () => ({
  CalendarDestinationPickerModal: () => null,
}));
jest.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ currentTheme: "light" }) }));
jest.mock("@/components/ui/EmptyState", () => ({ EmptyState: () => null }));
jest.mock("@/components/ui/IconSymbol", () => ({ IconSymbol: () => null }));
jest.mock("@/components/ui/Toast", () => ({ showToast: jest.fn() }));

const SESSION: SavedSession = {
  id: "Ended-Meet-1-Red",
  meet: "Ended Meet" as never,
  sessionNumber: 1,
  platform: "Red",
  weightClass: "71kg",
  startTime: "10:00 AM",
  weighInTime: "8:00 AM",
  date: "2026-10-10",
};

/** The trash button's handler, from whichever header the platform renders. */
function resetHandler(): () => void {
  const options = mockSetOptions.mock.calls.at(-1)?.[0] ?? {};
  if (options.unstable_headerRightItems) {
    return options.unstable_headerRightItems()[1].onPress;
  }
  const header = create(options.headerRight());
  return header.root.findAllByProps({ accessibilityLabel: "Delete all saved sessions" })[0].props.onPress;
}

async function render() {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<SavedScreen />);
  });
  return tree;
}

describe("Saved tab", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "warn").mockImplementation(() => {});
    mockSavedSessions = [SESSION];
    mockAvailableMeets = [{ name: "Another Meet" }];
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shows the selected meet's sessions after the meet leaves the meets list (#269)", async () => {
    const tree = await render();
    // The card renders its row, not `null`.
    const texts = tree.root
      .findAll((node) => typeof node.type === "string")
      .flatMap((node) => node.children.filter((child): child is string => typeof child === "string"));
    expect(texts.join(" ")).toContain("71kg");
    expect(tree.root.findAllByProps({ testID: "saved-empty-state" })).toHaveLength(0);
  });

  it("asks to reset offline, with no Clerk user, and resets through the hook (#287)", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await render();

    await act(async () => {
      resetHandler()();
    });

    expect(alert).toHaveBeenCalledTimes(1);
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => Promise<void> }[];
    await act(async () => {
      await buttons.find((button) => button.text === "Reset")!.onPress!();
    });
    expect(mockResetAllSessions).toHaveBeenCalledWith("Ended Meet");
  });

  it("runs the legacy migration with no Clerk user", async () => {
    mockMigrateLegacySessions.mockResolvedValueOnce(false);
    await render();
    expect(mockMigrateLegacySessions).toHaveBeenCalledWith("Ended Meet");
  });
});
