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

void [Modal, Pressable, ScrollView, View];

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 84, right: 0 }),
}));
jest.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ currentTheme: "light" }) }));
jest.mock("@/components/ui/IconSymbol", () => ({ IconSymbol: () => null }));
jest.mock("@/components/ui/MaterialSurface", () => ({ MaterialSurface: () => null }));

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
});
