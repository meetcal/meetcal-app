// Lives outside app/: Expo Router turns every file under app/ into a route,
// so a test there would be bundled into the app (react-test-renderer, jest.mock).
import React from "react";
import { Alert, Animated, Pressable, ScrollView, TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import StartListScreen from "@/app/(tabs)/(start-list)/StartListContent";
import type { PillFilterConfig } from "@/components/ui/filters";
import type { LiftResult } from "@/data/types/athletes";
import { getMeetData } from "@/lib/database/offline-store";

// Charge react-native's lazy-getter cost to the file, not the first test.
void [Animated, Pressable, ScrollView, TextInput];

type PillBarProps = {
  configs: PillFilterConfig[];
  onSelect: (id: string, value: string) => void;
  onReset?: () => void;
};
type ActionModalProps = { onSaveAll: () => void };

const mockPillBar = jest.fn((_props: PillBarProps) => null);
const mockActionModal = jest.fn((_props: ActionModalProps) => null);
const mockFlashList = jest.fn((_props: { data: LiftResult[] }) => null);
const mockRequireAuth = jest.fn((_options: { feature: string }) => true as boolean | null);
const mockSaveSessions = jest.fn(async () => true);
const mockPush = jest.fn();
const mockMeet: { selectedMeet: string | null } = { selectedMeet: "Meet A" };
const mockSubscription: { isSubscribed: boolean | null } = { isSubscribed: true };

jest.mock("@/components/ui/filters", () => ({
  FilterPillBar: (props: PillBarProps) => mockPillBar(props),
  ClubFilterModal: () => null,
}));
jest.mock("@/components/start-list/ActionModal", () => ({
  __esModule: true,
  default: (props: ActionModalProps) => mockActionModal(props),
}));
jest.mock("@shopify/flash-list", () => ({
  FlashList: (props: { data: LiftResult[] }) => mockFlashList(props),
}));
// Rows are covered by AthleteItem.test.tsx; the list mock renders none.
jest.mock("@/components/start-list/AthleteItem", () => ({ AthleteItem: () => null }));
jest.mock("@/components/start-list/StartListSkeleton", () => ({
  StartListSkeleton: () => null,
}));
jest.mock("@/components/calendar/CalendarDestinationPickerModal", () => ({
  CalendarDestinationPickerModal: () => null,
}));
jest.mock("@/components/share/ImagePreviewModal", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/share/ShareScheduleView", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/ui/IconSymbol", () => ({ IconSymbol: () => null }));
jest.mock("@/components/ui/EmptyState", () => ({ EmptyState: () => null }));
jest.mock("@/components/ui/Toast", () => ({ showToast: jest.fn() }));
jest.mock("@/contexts/SelectedMeetContext", () => ({
  useSelectedMeet: () => ({
    selectedMeet: mockMeet.selectedMeet,
    meetDetails: null,
  }),
}));
jest.mock("@/contexts/SubscriptionContext", () => ({
  useSubscription: () => ({ isSubscribed: mockSubscription.isSubscribed }),
}));
jest.mock("@/contexts/SavedSessionsContext", () => ({
  useSavedSessions: () => ({ saveSessionsFromAthletes: mockSaveSessions }),
}));
jest.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => ({ currentTheme: "light" }),
}));
jest.mock("@/utils/authGuard", () => ({
  useAuthGuard: () => ({ requireAuth: mockRequireAuth }),
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
  useNavigation: () => ({ setOptions: jest.fn() }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@/lib/database/offline-store", () => ({
  getMeetData: jest.fn(),
  saveMeetAthletes: jest.fn(async () => {}),
  saveMeetSchedule: jest.fn(async () => {}),
}));
jest.mock("@/lib/database/queries", () => ({
  fetchAthletesWithSession: jest.fn(async () => []),
  fetchSchedule: jest.fn(async () => []),
}));
jest.mock("@/lib/networkUtils", () => ({
  isNetworkAvailable: jest.fn(async () => false),
}));
jest.mock("@/lib/start-list-api", () => ({
  getLastYearBestsBatch: jest.fn(async () => ({})),
  preloadYearBests: jest.fn(),
}));
jest.mock("@/lib/share-image", () => ({ captureViewAsPng: jest.fn() }));
jest.mock("@/lib/haptics", () => ({
  lightImpact: jest.fn(),
  successNotification: jest.fn(),
}));
jest.mock("@/utils/calendar", () => ({
  requestCalendarPermissions: jest.fn(),
  createCalendarEvents: jest.fn(),
  createCalendarEventsToCalendar: jest.fn(),
  getWritableCalendars: jest.fn(),
  resolvePreferredAndroidCalendar: jest.fn(),
  setPreferredAndroidCalendarId: jest.fn(),
}));
jest.mock("expo-file-system", () => ({ File: jest.fn(), Paths: { cache: "cache" } }));
jest.mock("expo-sharing", () => ({
  isAvailableAsync: jest.fn(async () => false),
  shareAsync: jest.fn(),
}));
jest.mock("expo-store-review", () => ({
  isAvailableAsync: jest.fn(async () => false),
  requestReview: jest.fn(),
}));

function lifter(overrides: Partial<LiftResult>): LiftResult {
  return {
    memberId: overrides.name ?? "id",
    name: "Lifter",
    age: 25,
    club: "Club",
    gender: "Male",
    weightClass: "89",
    entryTotal: 200,
    adaptive: false,
    ...overrides,
  };
}

const ROSTERS: Record<string, LiftResult[]> = {
  "Meet A": [
    lifter({ name: "John Smith", weightClass: "110", club: "Barbell Club" }),
    lifter({ name: "Jane Doe", weightClass: "110", club: "Lift House" }),
    lifter({ name: "Alex Moore", weightClass: "94", club: "Barbell Club" }),
  ],
  "Meet B": [
    lifter({ name: "Sam Lee", weightClass: "71" }),
    lifter({ name: "Chris Park", weightClass: "79" }),
  ],
};

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  });
};

const lastCall = <T,>(mock: jest.Mock<null, [T]>): T => {
  const calls = mock.mock.calls;
  if (calls.length === 0) throw new Error("component was never rendered");
  return calls[calls.length - 1][0];
};
const pillBar = () => lastCall(mockPillBar);
const pill = (id: string) => {
  const config = pillBar().configs.find((c) => c.id === id);
  if (!config) throw new Error(`no ${id} pill`);
  return config;
};
const shownNames = () => lastCall(mockFlashList).data.map((a) => a.name);

let tree!: ReactTestRenderer;

async function mount() {
  act(() => {
    tree = create(<StartListScreen />);
  });
  await flush();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockMeet.selectedMeet = "Meet A";
  mockSubscription.isSubscribed = true;
  mockRequireAuth.mockImplementation(() => true);
  jest.mocked(getMeetData).mockImplementation(async (meet: string) => ({
    athletes: ROSTERS[meet] ?? [],
    schedule: [],
    athletesSyncedAt: 0,
  }) as unknown as Awaited<ReturnType<typeof getMeetData>>);
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
  // `[perf] start list ready` (devInfo) on every load.
  jest.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  act(() => tree.unmount());
  jest.restoreAllMocks();
});

describe("Start List weight-class pill", () => {
  it("offers the heaviest class present as itself and filters on it", async () => {
    await mount();
    expect(pill("weightClass").options.map((o) => o.label)).toEqual(["94", "110"]);

    act(() => pillBar().onSelect("weightClass", "110kg"));
    expect(shownNames()).toEqual(["Jane Doe", "John Smith"]);
  });
});

describe("Start List filters across meets", () => {
  it("drops the previous meet's filters when another meet is selected", async () => {
    await mount();
    act(() => pillBar().onSelect("weightClass", "110kg"));
    act(() => pillBar().onSelect("sort", "entryTotal"));
    expect(pill("weightClass").value).toBe("110kg");

    mockMeet.selectedMeet = "Meet B";
    act(() => tree.update(<StartListScreen />));
    await flush();

    expect(pill("weightClass").value).toBe("");
    expect(pill("sort").value).toBe("");
    expect(shownNames()).toEqual(["Chris Park", "Sam Lee"]);
  });
});

describe("Start List Add to Saved", () => {
  it("asks a signed-out user to sign in instead of confirming the save", async () => {
    mockRequireAuth.mockImplementation(() => false);
    await mount();

    await act(async () => {
      await lastCall(mockActionModal).onSaveAll();
    });

    expect(mockRequireAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "save-session",
        returnPath: "/(tabs)/(start-list)",
      }),
    );
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockSaveSessions).not.toHaveBeenCalled();
  });

  it("does nothing while sign-in state is still loading", async () => {
    mockRequireAuth.mockImplementation(() => null);
    await mount();
    await act(async () => {
      await lastCall(mockActionModal).onSaveAll();
    });
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("confirms and saves the filtered athletes for a signed-in user", async () => {
    await mount();
    act(() => pillBar().onSelect("weightClass", "94kg"));

    await act(async () => {
      await lastCall(mockActionModal).onSaveAll();
    });
    const [title, , buttons] = jest.mocked(Alert.alert).mock.calls[0];
    expect(title).toBe("Save Sessions");
    const save = buttons?.find((b) => b.text === "Save");
    await act(async () => {
      await save?.onPress?.();
    });

    expect(mockSaveSessions).toHaveBeenCalledWith(
      [expect.objectContaining({ name: "Alex Moore" })],
      "Meet A",
      [],
    );
  });
});
