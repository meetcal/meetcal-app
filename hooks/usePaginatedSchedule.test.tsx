import React from "react";
import { act, create } from "react-test-renderer";
import { usePaginatedSchedule } from "@/hooks/usePaginatedSchedule";
import { DaySchedule, Schedule } from "@/types/schedule";

jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const useWindowDimensions = require("react-native/Libraries/Utilities/useWindowDimensions")
  .default as jest.Mock;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useSafeAreaInsets } = require("react-native-safe-area-context") as {
  useSafeAreaInsets: jest.Mock;
};

const setWidth = (width: number) => {
  useWindowDimensions.mockReturnValue({
    width,
    height: 900,
    scale: 3,
    fontScale: 1,
  });
};

const setInsets = ({ left = 0, right = 0 } = {}) => {
  useSafeAreaInsets.mockReturnValue({ top: 0, right, bottom: 0, left });
};

const day = (date: string): DaySchedule =>
  ({ date, fullDate: date, sessions: [] }) as unknown as DaySchedule;

const schedule = [day("2026-06-20"), day("2026-06-21"), day("2026-06-22")] as unknown as Schedule;

describe("usePaginatedSchedule width changes", () => {
  let captured: ReturnType<typeof usePaginatedSchedule> | null = null;
  const scrollToOffset = jest.fn();
  const scrollToIndex = jest.fn();

  function Harness() {
    captured = usePaginatedSchedule({
      schedule,
      onTitleChange: jest.fn(),
      formatDayTitle: (d) => d.date,
    });
    captured.flatListRef.current = { scrollToOffset, scrollToIndex } as any;
    return null;
  }

  beforeEach(() => {
    captured = null;
    scrollToOffset.mockReset();
    scrollToIndex.mockReset();
    setWidth(400);
    setInsets();
  });

  it("does not re-anchor when the width is unchanged", () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Harness />);
    });
    act(() => {
      tree.update(<Harness />);
    });
    expect(scrollToOffset).not.toHaveBeenCalled();
  });

  it("re-anchors the current page when the window widens (unfold)", () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Harness />);
    });

    act(() => {
      captured!.handlePageChange(2);
    });
    scrollToIndex.mockReset();

    setWidth(1000);
    act(() => {
      tree.update(<Harness />);
    });

    expect(scrollToOffset).toHaveBeenCalledWith({
      offset: 2000,
      animated: false,
    });
  });

  it("re-anchors the current page when the window narrows (fold)", () => {
    setWidth(1000);
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Harness />);
    });

    act(() => {
      captured!.handlePageChange(1);
    });

    setWidth(400);
    act(() => {
      tree.update(<Harness />);
    });

    expect(scrollToOffset).toHaveBeenCalledWith({
      offset: 400,
      animated: false,
    });
  });

  it("pages on the window minus the side safe-area band", () => {
    // iPhone Duo inner display: 466pt window with an 84pt band on the right.
    setWidth(466);
    setInsets({ right: 84 });
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Harness />);
    });

    act(() => {
      captured!.onMomentumScrollEnd({
        nativeEvent: { contentOffset: { x: 764 } },
      });
    });
    expect(captured!.currentPage).toBe(2);
    expect(captured!.pageWidth).toBe(382);

    setInsets();
    act(() => {
      tree.update(<Harness />);
    });
    // Band disappears (folded shut) -> page 2 re-anchors at the new width.
    expect(scrollToOffset).toHaveBeenCalledWith({
      offset: 932,
      animated: false,
    });
  });

  it("tracks the page from momentum scroll before re-anchoring", () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Harness />);
    });

    act(() => {
      captured!.onMomentumScrollEnd({
        nativeEvent: { contentOffset: { x: 800 } },
      });
    });

    setWidth(1000);
    act(() => {
      tree.update(<Harness />);
    });

    expect(scrollToOffset).toHaveBeenCalledWith({
      offset: 2000,
      animated: false,
    });
  });
});
