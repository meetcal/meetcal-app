// Lives outside app/: Expo Router turns every file under app/ into a route,
// so a test there would be bundled into the app (react-test-renderer, jest.mock).
import React from "react";
import { Alert, Animated, Pressable, ScrollView, TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import StartListScreen from "@/components/start-list/StartListScreen";
import type { PillFilterConfig } from "@/components/ui/filters";
import type { LiftResult } from "@/data/types/athletes";
import { getMeetData } from "@/lib/database/offline-store";
import { getLastYearBestsBatch } from "@/lib/start-list-api";
import { showToast } from "@/components/ui/Toast";

// Charge react-native's lazy-getter cost to the file, not the first test.
void [Animated, Pressable, ScrollView, TextInput];

type PillBarProps = {
  configs: PillFilterConfig[];
  onSelect: (id: string, value: string) => void;
  onReset?: () => void;
};
type ActionModalProps = {
  onSaveAll: () => void;
  onSaveToCalendar: () => void;
  onCreateShareableSchedule: () => void;
  onDownloadShareableSchedule: () => void;
};
type ClubModalProps = {
  onSelectClub: (club: string) => void;
  onToggleStarredClub: (club: string) => void;
};

const mockPillBar = jest.fn((_props: PillBarProps) => null);
const mockActionModal = jest.fn((_props: ActionModalProps) => null);
const mockClubModal = jest.fn((_props: ClubModalProps) => null);
type FlashListProps = {
  data: LiftResult[];
  renderItem: (info: { item: LiftResult; index: number }) => React.ReactElement<{
    onSeeAllResults: (name: string) => void;
  }>;
};
const mockFlashList = jest.fn((_props: FlashListProps) => null);
const mockRequireAuth = jest.fn((_options: { feature: string }) => true as boolean | null);
const mockSaveSessions = jest.fn(async () => true);
const mockPush = jest.fn();
const mockMeet: { selectedMeet: string | null } = { selectedMeet: "Meet A" };
const mockSubscription: { isSubscribed: boolean | null } = { isSubscribed: true };

jest.mock("@/components/ui/filters", () => ({
  FilterPillBar: (props: PillBarProps) => mockPillBar(props),
  ClubFilterModal: (props: ClubModalProps) => mockClubModal(props),
}));
jest.mock("@/components/start-list/ActionModal", () => ({
  __esModule: true,
  default: (props: ActionModalProps) => mockActionModal(props),
}));
jest.mock("@shopify/flash-list", () => ({
  FlashList: (props: FlashListProps) => mockFlashList(props),
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

describe("Start List search", () => {
  const search = (text: string) =>
    act(() => tree.root.findByProps({ testID: "start-list-search" }).props.onChangeText(text));

  it("matches names word by word, ignoring order and stray spaces", async () => {
    await mount();
    search("Smith ");
    expect(shownNames()).toEqual(["John Smith"]);
    search("smith john");
    expect(shownNames()).toEqual(["John Smith"]);
    search("smith jane");
    expect(shownNames()).toEqual([]);
  });
});

describe("Start List best-lift sorts", () => {
  it("sends a free user to the paywall instead of sorting", async () => {
    mockSubscription.isSubscribed = false;
    await mount();
    act(() => pillBar().onSelect("sort", "bestSnatch"));

    expect(mockRequireAuth).toHaveBeenCalledWith(
      expect.objectContaining({ feature: "sort-athletes" }),
    );
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/shared-screens/paywall",
      params: { from: "/(tabs)/(start-list)", feature: "sort-athletes" },
    });
    expect(pill("sort").value).toBe("");
  });

  it("asks a signed-out user to sign in and goes no further", async () => {
    mockSubscription.isSubscribed = false;
    mockRequireAuth.mockImplementation(() => false);
    await mount();
    act(() => pillBar().onSelect("sort", "bestTotal"));
    expect(mockPush).not.toHaveBeenCalled();
    expect(pill("sort").value).toBe("");
  });

  it("keeps Entry Total free", async () => {
    mockSubscription.isSubscribed = false;
    await mount();
    act(() => pillBar().onSelect("sort", "entryTotal"));
    expect(mockRequireAuth).not.toHaveBeenCalled();
    expect(pill("sort").value).toBe("entryTotal");
  });

  it("sorts a subscriber's list by the bests", async () => {
    jest.mocked(getLastYearBestsBatch).mockResolvedValue({
      "Jane Doe": { bestSnatch: 90, bestCJ: 110, bestTotal: 200 },
      "Alex Moore": { bestSnatch: 120, bestCJ: 150, bestTotal: 270 },
    });
    await mount();
    act(() => pillBar().onSelect("sort", "bestSnatch"));
    await flush();
    expect(mockPush).not.toHaveBeenCalled();
    expect(pill("sort").value).toBe("bestSnatch");
    expect(shownNames()).toEqual(["Alex Moore", "Jane Doe", "John Smith"]);
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

describe("Start List premium actions", () => {
  const actions = () => lastCall(mockActionModal);

  it("sends a free user to the paywall from Add to Calendar", async () => {
    mockSubscription.isSubscribed = false;
    await mount();
    act(() => actions().onSaveToCalendar());
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/shared-screens/paywall",
      params: { from: "/(tabs)/(start-list)", feature: "add-to-calendar" },
    });
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("does nothing while the subscription is unknown", async () => {
    mockSubscription.isSubscribed = null;
    await mount();
    await act(async () => {
      actions().onSaveToCalendar();
      await actions().onCreateShareableSchedule();
      await actions().onDownloadShareableSchedule();
    });
    expect(mockPush).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(jest.mocked(showToast)).not.toHaveBeenCalled();
  });

  it("asks a subscriber for a club or WSO before building a shareable schedule", async () => {
    await mount();
    await act(async () => {
      await actions().onDownloadShareableSchedule();
    });
    expect(jest.mocked(showToast)).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("Select a specific club") }),
    );
  });

  it("tells a subscriber there are no sessions to add when the schedule has none", async () => {
    await mount();
    act(() => actions().onSaveToCalendar());
    expect(jest.mocked(showToast)).toHaveBeenCalledWith({
      type: "info",
      message: "There are no sessions to add to calendar.",
    });
  });
});

describe("Start List row results link", () => {
  const seeAllResults = (name: string) => {
    const { data, renderItem } = lastCall(mockFlashList);
    const index = data.findIndex((a) => a.name === name);
    act(() => renderItem({ item: data[index], index }).props.onSeeAllResults(name));
  };

  it("opens a subscriber's results", async () => {
    await mount();
    seeAllResults("Jane Doe");
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/shared-screens/athlete-results",
      params: { name: "Jane Doe" },
    });
  });

  it("sends a free user to the paywall and a signed-out user nowhere", async () => {
    mockSubscription.isSubscribed = false;
    await mount();
    seeAllResults("Jane Doe");
    expect(mockPush).toHaveBeenLastCalledWith({
      pathname: "/shared-screens/paywall",
      params: { from: "/(tabs)/(start-list)", feature: "athlete-results" },
    });

    mockPush.mockClear();
    mockRequireAuth.mockImplementation(() => false);
    seeAllResults("Jane Doe");
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe("Start List best-lift sort after a lapse", () => {
  it("falls back to A-Z when the subscription is no longer confirmed", async () => {
    jest.mocked(getLastYearBestsBatch).mockResolvedValue({
      "John Smith": { bestSnatch: 150, bestCJ: 180, bestTotal: 330 },
    });
    await mount();
    act(() => pillBar().onSelect("sort", "bestSnatch"));
    await flush();
    expect(shownNames()[0]).toBe("John Smith");

    mockSubscription.isSubscribed = false;
    act(() => tree.update(<StartListScreen />));
    expect(pill("sort").value).toBe("");
    expect(shownNames()).toEqual(["Alex Moore", "Jane Doe", "John Smith"]);
  });
});

describe("Start List favorite clubs", () => {
  it("drops the Favorites filter when its last club is unstarred", async () => {
    await mount();
    const clubModal = () => lastCall(mockClubModal);
    act(() => clubModal().onToggleStarredClub("Lift House"));
    act(() => clubModal().onSelectClub("Favorites"));
    expect(shownNames()).toEqual(["Jane Doe"]);

    act(() => clubModal().onToggleStarredClub("Lift House"));
    expect(pill("club").value).toBe("");
    expect(shownNames()).toHaveLength(3);
  });
});
