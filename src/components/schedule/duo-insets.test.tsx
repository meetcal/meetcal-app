/**
 * Content that replaces a screen (skeletons) or sits above every screen
 * (modals) does not inherit a screen's padding, so it clears the iPhone Duo
 * side band itself. The Duo reports the band as an 84pt left or right inset.
 */
import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { ScheduleSkeleton } from "@/components/schedule/ScheduleSkeleton";
import { MeetSelectionModal } from "@/components/schedule/MeetSelectionModal";
import { CalendarDestinationPickerModal } from "@/components/calendar/CalendarDestinationPickerModal";
import type { SessionSortControlProps } from "@/components/schedule-details/sessionSort/types";
import EventInfoScreen from "@/components/info/EventInfoScreen";
import { UpdateNotification } from "@/components/schedule/UpdateNotification";

void [Modal, Pressable, ScrollView, View];

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 84, right: 0 }),
}));
jest.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ currentTheme: "light" }) }));
jest.mock("@/components/ui/IconSymbol", () => ({ IconSymbol: () => null }));
jest.mock("@/components/ui/MaterialSurface", () => ({ MaterialSurface: () => null }));
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  default: { View: jest.requireActual("react-native").View },
  Easing: { out: () => () => 0, cubic: () => 0 },
  runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
  useSharedValue: (value: number) => ({ value }),
  useAnimatedStyle: () => ({}),
  withTiming: (value: number) => value,
  withSpring: (value: number) => value,
}));
jest.mock("@/contexts/SelectedMeetContext", () => ({
  useSelectedMeet: () => ({
    isLoading: false,
    meetDetails: {
      name: "Nationals",
      venue: { name: "Hall", address: { street: "1 Main", city: "Reno", state: "NV", zip: "1" } },
      venueMapPdfUrl: "https://example.com/map.pdf",
      venueMapAppleUrl: "https://maps.apple.com/?q=hall",
    },
  }),
}));
jest.mock("@/hooks/useOTAUpdates", () => ({
  useOTAUpdates: () => ({
    isUpdateAvailable: true,
    isDownloading: false,
    error: null,
    downloadAndRestart: jest.fn(),
    dismissUpdate: jest.fn(),
  }),
}));

function horizontalPadding(tree: ReactTestRenderer, testID: string) {
  const node = tree.root.find((n) => typeof n.type === "string" && n.props.testID === testID);
  const style = StyleSheet.flatten(node.props.style) as {
    paddingLeft?: number;
    paddingRight?: number;
  };
  return { left: style.paddingLeft, right: style.paddingRight };
}

function pressTestID(tree: ReactTestRenderer, testID: string): void {
  const node = tree.root.findAll(
    (n) => n.props?.testID === testID && typeof n.props.onPress === "function",
  )[0];
  act(() => node.props.onPress());
}

function render(element: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(element);
  });
  return tree;
}

function paddingOf(tree: ReactTestRenderer) {
  const node = tree.root.findAll((n) => typeof n.type === "string")[0];
  const style = StyleSheet.flatten(node.props.style) as {
    paddingLeft?: number;
    paddingRight?: number;
  };
  return { left: style.paddingLeft, right: style.paddingRight };
}

describe("iPhone Duo side band", () => {
  it("pads the schedule skeleton like the screen it stands in for", () => {
    const tree = render(<ScheduleSkeleton />);
    expect(paddingOf(tree)).toEqual({ left: 84, right: 0 });
    act(() => tree.unmount());
  });

  it("keeps the meet selector's own margin inside the band", () => {
    const tree = render(
      <MeetSelectionModal
        visible
        onClose={jest.fn()}
        meets={[]}
        selectedMeet={null}
        onSelectMeet={jest.fn(async () => {})}
        onRefresh={jest.fn(async () => {})}
        isRefreshing={false}
      />,
    );
    const backdrop = tree.root.find(
      (n) => typeof n.type === "string" && n.props.testID === "meet-selection-modal-backdrop",
    );
    const style = StyleSheet.flatten(backdrop.props.style) as {
      paddingLeft?: number;
      paddingRight?: number;
    };
    expect(style.paddingLeft).toBe(16 + 84);
    expect(style.paddingRight).toBe(16);
    act(() => tree.unmount());
  });

  it("insets the calendar picker overlay", () => {
    const tree = render(
      <CalendarDestinationPickerModal
        visible
        title="Calendar"
        destinations={[]}
        onClose={jest.fn()}
        onSelect={jest.fn()}
      />,
    );
    const overlay = tree.root.findAll(
      (n) => typeof n.type === "string" && n.props.style != null,
    )[0];
    const style = StyleSheet.flatten(overlay.props.style) as {
      paddingLeft?: number;
      paddingRight?: number;
    };
    expect(style.paddingLeft).toBe(20 + 84);
    expect(style.paddingRight).toBe(20);
    act(() => tree.unmount());
  });

  it("insets the session sort picker (the Modal one; iOS uses a native UIMenu)", () => {
    // Jest resolves `.ios.tsx` first; load the Modal implementation directly.
    const { default: SessionSortControl } = jest.requireActual<{
      default: React.FC<SessionSortControlProps>;
    }>("@/components/schedule-details/sessionSort/SessionSortControl.tsx");
    const tree = render(
      <SessionSortControl
        isSubscribed
        sortLabel="Entry Total"
        sortKey="entryTotal"
        sortDirection="desc"
        sortOptions={[{ label: "Entry Total", key: "entryTotal", direction: "desc" }]}
        onSelect={jest.fn()}
        onLockedPress={jest.fn()}
      />,
    );
    const button = tree.root.findAll(
      (n) => n.props?.accessibilityLabel === "Sort athletes" && typeof n.props.onPress === "function",
    )[0];
    act(() => button.props.onPress());
    expect(horizontalPadding(tree, "session-sort-backdrop")).toEqual({ left: 20 + 84, right: 20 });
    act(() => tree.unmount());
  });

  it("insets the venue map chooser", () => {
    const tree = render(<EventInfoScreen />);
    pressTestID(tree, "info-venue-map");
    expect(horizontalPadding(tree, "venue-map-overlay")).toEqual({ left: 20 + 84, right: 20 });
    act(() => tree.unmount());
  });

  it("insets the update dialog mounted over every screen", () => {
    const tree = render(<UpdateNotification />);
    expect(horizontalPadding(tree, "update-notification-backdrop")).toEqual({
      left: 24 + 84,
      right: 24,
    });
    act(() => tree.unmount());
  });
});
