import React from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
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

const useWindowDimensions = require("react-native/Libraries/Utilities/useWindowDimensions")
  .default as jest.Mock;
const { useSafeAreaInsets } = require("react-native-safe-area-context") as {
  useSafeAreaInsets: jest.Mock;
};

/** A momentum-scroll event carrying the horizontal offset the hook reads. */
const momentumEvent = (x: number) =>
  ({
    nativeEvent: {
      contentInset: { bottom: 0, left: 0, right: 0, top: 0 },
      contentOffset: { x, y: 0 },
      contentSize: { height: 900, width: x + 1000 },
      layoutMeasurement: { height: 900, width: 1000 },
      zoomScale: 1,
    },
  }) as NativeSyntheticEvent<NativeScrollEvent>;

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

  function Harness({ days = schedule }: { days?: Schedule }) {
    captured = usePaginatedSchedule({
      schedule: days,
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
      captured!.onMomentumScrollEnd(momentumEvent(764));
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
      captured!.onMomentumScrollEnd(momentumEvent(800));
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

  it("re-anchors on the day the list opened at, with no swipe", () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Harness />);
    });

    // The list mounts on `initialScrollIndex` (today's day) and only reports it
    // through viewability -- no momentum scroll ever fires.
    act(() => {
      captured!.onViewableItemsChanged({
        viewableItems: [{ index: 2, item: day("2026-06-22") }],
        changed: [],
      } as unknown as Parameters<
        ReturnType<typeof usePaginatedSchedule>["onViewableItemsChanged"]
      >[0]);
    });
    expect(captured!.currentPage).toBe(2);

    setWidth(1000);
    act(() => {
      tree.update(<Harness />);
    });

    expect(scrollToOffset).toHaveBeenCalledWith({
      offset: 2000,
      animated: false,
    });
  });
  it("clamps the current page when a refresh removes days, then unfolds safely", () => {
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<Harness />); });
    act(() => { captured!.handlePageChange(2); });
    act(() => { tree.update(<Harness days={schedule.slice(0, 1)} />); });
    expect(captured!.currentPage).toBe(0);
    expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 0, animated: false });
    setWidth(1000);
    act(() => { tree.update(<Harness days={schedule.slice(0, 1)} />); });
    expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 0, animated: false });
  });

  it("ignores invalid page targets and clamps scroll overshoot", () => {
    act(() => { create(<Harness />); });
    act(() => {
      captured!.handlePageChange(-1);
      captured!.handlePageChange(3);
      captured!.handlePageChange(Number.NaN);
    });
    expect(scrollToIndex).not.toHaveBeenCalled();
    act(() => { captured!.onMomentumScrollEnd(momentumEvent(-400)); });
    expect(captured!.currentPage).toBe(0);
    act(() => { captured!.onMomentumScrollEnd(momentumEvent(4000)); });
    expect(captured!.currentPage).toBe(2);
  });

});
