/**
 * The first-launch tour on the Schedule tab keeps its page in local state.
 * It must stay mounted while the screen passes through its loading
 * skeletons: a meet list or schedule arriving mid-tour (a reconnect) used to
 * unmount it and restart the tour at page 1.
 */
import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import ScheduleScreen from "@/app/(tabs)/(index)/index";

let mockOnboardingMounts = 0;
let mockOnboardingUnmounts = 0;
jest.mock("@/components/schedule/OnboardingView", () => {
  const { Text: MockText } = jest.requireActual<typeof import("react-native")>("react-native");
  const { useEffect } = jest.requireActual<typeof import("react")>("react");
  return {
    checkOnboardingComplete: jest.fn(async () => false),
    OnboardingView: ({ visible }: { visible: boolean }) => {
      useEffect(() => {
        mockOnboardingMounts += 1;
        return () => {
          mockOnboardingUnmounts += 1;
        };
      }, []);
      return visible ? <MockText>Onboarding</MockText> : null;
    },
  };
});
jest.mock("@/components/schedule/ScheduleSkeleton", () => {
  const { Text: MockText } = jest.requireActual<typeof import("react-native")>("react-native");
  return { ScheduleSkeleton: ({ label }: { label: string }) => <MockText>{label}</MockText> };
});
jest.mock("@/components/schedule/DayView", () => ({ DayView: () => null }));
jest.mock("@/components/schedule/MeetSelectionModal", () => ({ MeetSelectionModal: () => null }));
jest.mock("@/components/schedule/PageIndicator", () => ({ PageIndicator: () => null }));
jest.mock("@/components/schedule/VersionAnnouncement", () => ({ VersionAnnouncement: () => null }));
jest.mock("@/components/saved/NextSessionCard", () => ({ NextSessionCard: () => null }));
jest.mock("@/components/ui/IconSymbol", () => ({ IconSymbol: () => null }));
jest.mock("@/components/ui/Toast", () => ({ showToast: jest.fn() }));
jest.mock("@/components/ui/EmptyState", () => {
  const { Text: MockText } = jest.requireActual<typeof import("react-native")>("react-native");
  return { EmptyState: ({ title }: { title: string }) => <MockText>{title}</MockText> };
});
jest.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ currentTheme: "light" }) }));
jest.mock("@/contexts/SavedSessionsContext", () => ({
  useSavedSessions: () => ({ savedSessions: [] }),
}));

let mockMeet: {
  isLoading: boolean;
  selectedMeet: string | null;
  meetDetails: { time: { timeZoneIdentifier: string; abbreviation: string } } | null;
} = { isLoading: false, selectedMeet: null, meetDetails: null };
jest.mock("@/contexts/SelectedMeetContext", () => ({
  useSelectedMeet: () => ({
    ...mockMeet,
    availableMeets: [],
    setSelectedMeet: jest.fn(),
    refreshAvailableMeets: jest.fn(async () => {}),
  }),
}));

let mockSchedule: { schedule: unknown[]; isLoading: boolean } = { schedule: [], isLoading: false };
jest.mock("@/hooks/useScheduleData", () => ({
  useScheduleData: () => ({
    ...mockSchedule,
    isRefreshing: false,
    loadError: null,
    initialScrollIndex: 0,
    refreshSchedule: jest.fn(async () => {}),
  }),
}));
jest.mock("@/hooks/useUpcomingMeets", () => ({ useUpcomingMeets: () => ({ upcomingMeets: [] }) }));
jest.mock("@/hooks/usePaginatedSchedule", () => ({
  usePaginatedSchedule: () => ({
    currentPage: 0,
    pageWidth: 390,
    flatListRef: { current: null },
    handlePageChange: jest.fn(),
    onViewableItemsChanged: jest.fn(),
    onMomentumScrollEnd: jest.fn(),
    viewabilityConfig: {},
  }),
}));
jest.mock("@/hooks/useIsOffline", () => ({ useIsOffline: () => [false, () => {}] }));
jest.mock("@/hooks/useScreenInsets", () => ({
  useScreenHorizontalInsets: () => ({ paddingLeft: 0, paddingRight: 0 }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@/lib/database/offline-store", () => ({ initStore: jest.fn() }));
jest.mock("@/lib/e2e", () => ({ isMaestroE2E: () => false }));
jest.mock("@/utils/authGuard", () => ({
  useAuthGuard: () => ({ isAuthenticated: false, authState: false, notifyAuthPending: jest.fn() }),
}));
jest.mock("expo-router", () => ({
  useNavigation: () => ({ setOptions: jest.fn() }),
  usePathname: () => "/(tabs)/(index)",
  useRouter: () => ({ push: jest.fn() }),
}));

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => String(node.props.children));
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

async function rerender(renderer: ReactTestRenderer): Promise<void> {
  await act(async () => {
    renderer.update(<ScheduleScreen />);
  });
  await flush();
}

describe("Schedule onboarding", () => {
  beforeEach(() => {
    mockOnboardingMounts = 0;
    mockOnboardingUnmounts = 0;
    mockMeet = { isLoading: false, selectedMeet: null, meetDetails: null };
    mockSchedule = { schedule: [], isLoading: false };
  });

  it("stays mounted while a meet and its schedule load under it", async () => {
    // First launch offline: no meet, the tour opens.
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ScheduleScreen />);
    });
    await flush();
    expect(texts(renderer)).toContain("Onboarding");

    // The connection returns: the meet list reloads...
    mockMeet = { ...mockMeet, isLoading: true };
    await rerender(renderer);
    expect(texts(renderer)).toContain("Loading meets...");

    // ...a meet is selected and its schedule loads...
    mockMeet = {
      isLoading: false,
      selectedMeet: "Nationals",
      meetDetails: { time: { timeZoneIdentifier: "America/New_York", abbreviation: "EDT" } },
    };
    mockSchedule = { schedule: [], isLoading: true };
    await rerender(renderer);
    expect(texts(renderer)).toContain("Loading schedule...");

    // ...and arrives.
    mockSchedule = { schedule: [], isLoading: false };
    await rerender(renderer);

    expect(texts(renderer)).toContain("Onboarding");
    expect(mockOnboardingMounts).toBe(1);
    expect(mockOnboardingUnmounts).toBe(0);
  });
});
