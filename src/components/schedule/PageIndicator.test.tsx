/**
 * Each day dot is a real 44pt touch target. hitSlop cannot provide the
 * height: Android ignores slop that reaches past the parent's bounds, and the
 * pill around the dots is only 22pt tall.
 */
import React from "react";
import { StyleSheet } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { PageIndicator } from "@/components/schedule/PageIndicator";

jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  default: { View: jest.requireActual("react-native").View },
  interpolate: () => 0,
  interpolateColor: () => "#000000",
  useAnimatedStyle: () => ({}),
  useSharedValue: (value: number) => ({ value }),
  withSpring: () => 0,
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ currentTheme: "light" }) }));

function render(element: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(element);
  });
  return tree;
}

function dot(tree: ReactTestRenderer, index: number) {
  // The Pressable's props, not the host view it renders.
  return tree.root.find(
    (n) => typeof n.type !== "string" && n.props.testID === `page-dot-${index}`,
  );
}

describe("PageIndicator", () => {
  it("lays each dot out 44pt tall instead of relying on vertical hitSlop", () => {
    const tree = render(<PageIndicator count={3} currentPage={0} onPageChange={jest.fn()} />);

    for (const index of [0, 1, 2]) {
      const target = dot(tree, index);
      const style = StyleSheet.flatten(target.props.style) as { height?: number };
      expect(style.height).toBeGreaterThanOrEqual(44);
      const hitSlop = target.props.hitSlop as { top?: number; bottom?: number } | undefined;
      expect(hitSlop?.top ?? 0).toBe(0);
      expect(hitSlop?.bottom ?? 0).toBe(0);
    }
    act(() => tree.unmount());
  });

  it("changes to the tapped day", () => {
    const onPageChange = jest.fn();
    const tree = render(<PageIndicator count={3} currentPage={0} onPageChange={onPageChange} />);

    act(() => dot(tree, 2).props.onPress());

    expect(onPageChange).toHaveBeenCalledWith(2);
    act(() => tree.unmount());
  });
});
