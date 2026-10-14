import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import type { LiftResult } from "@/data/types/athletes";
import { getLastYearBestsBatch, preloadYearBests, type YearBests } from "@/lib/start-list-api";
import {
  usePreloadYearBests,
  useYearBestsForSort,
  YEAR_BESTS_PREFETCH_DELAY_MS,
  YEAR_BESTS_PREFETCH_NAME_CAP,
} from "./useStartListBests";

jest.mock("@/lib/start-list-api", () => ({
  getLastYearBestsBatch: jest.fn(),
  preloadYearBests: jest.fn(),
}));

const lifter = (name: string) => ({ name }) as unknown as LiftResult;
const bests = (total: number): YearBests => ({ bestSnatch: 0, bestCJ: 0, bestTotal: total });

let result: Record<string, YearBests> = {};
function BestsHarness({ athletes, enabled }: { athletes: LiftResult[]; enabled: boolean }) {
  const value = useYearBestsForSort(athletes, enabled);
  React.useEffect(() => {
    result = value;
  });
  return null;
}

function PreloadHarness({ athletes, enabled = true }: { athletes: LiftResult[]; enabled?: boolean }) {
  usePreloadYearBests(athletes, enabled);
  return null;
}

let tree!: ReactTestRenderer;

beforeEach(() => {
  jest.clearAllMocks();
  result = {};
});

afterEach(() => {
  act(() => tree.unmount());
});

describe("useYearBestsForSort", () => {
  it("loads nothing until a best-lift sort is on", async () => {
    act(() => {
      tree = create(<BestsHarness athletes={[lifter("A")]} enabled={false} />);
    });
    expect(getLastYearBestsBatch).not.toHaveBeenCalled();
  });

  it("drops a batch for a roster that has since been replaced", async () => {
    const pending: ((value: Record<string, YearBests>) => void)[] = [];
    jest
      .mocked(getLastYearBestsBatch)
      .mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const first = [lifter("Old"), lifter("Old")];
    act(() => {
      tree = create(<BestsHarness athletes={first} enabled />);
    });
    expect(getLastYearBestsBatch).toHaveBeenLastCalledWith(["Old"]);

    act(() => tree.update(<BestsHarness athletes={[lifter("New")]} enabled />));
    await act(async () => {
      pending[1]({ New: bests(200) });
    });
    await act(async () => {
      pending[0]({ Old: bests(100) });
    });
    expect(result).toEqual({ New: bests(200) });
  });
});

describe("usePreloadYearBests", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("warms a capped list of A-names after the list settles", () => {
    const roster = [
      lifter("Bob Smith"),
      ...Array.from({ length: YEAR_BESTS_PREFETCH_NAME_CAP + 5 }, (_, i) => lifter(`Al ${i}`)),
    ];
    act(() => {
      tree = create(<PreloadHarness athletes={roster} />);
    });
    expect(preloadYearBests).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(YEAR_BESTS_PREFETCH_DELAY_MS));
    const names = jest.mocked(preloadYearBests).mock.calls[0][0];
    expect(names).toHaveLength(YEAR_BESTS_PREFETCH_NAME_CAP);
    expect(names).not.toContain("Bob Smith");
  });

  it("warms nothing for a non-subscriber: bests are premium on the server", () => {
    act(() => {
      tree = create(<PreloadHarness athletes={[lifter("Al")]} enabled={false} />);
    });
    act(() => jest.advanceTimersByTime(YEAR_BESTS_PREFETCH_DELAY_MS));
    expect(preloadYearBests).not.toHaveBeenCalled();
  });

  it("caps the warm to one bests request", () => {
    const { SMALL_ROWS_NAMES_CHUNK_SIZE } = jest.requireActual<
      typeof import("@/lib/api/meetcal-api")
    >("@/lib/api/meetcal-api");
    expect(YEAR_BESTS_PREFETCH_NAME_CAP).toBeLessThanOrEqual(SMALL_ROWS_NAMES_CHUNK_SIZE);
  });

  it("cancels the warm when the screen goes away first", () => {
    act(() => {
      tree = create(<PreloadHarness athletes={[lifter("Al")]} />);
    });
    act(() => tree.unmount());
    act(() => {
      tree = create(<PreloadHarness athletes={[]} />);
    });
    act(() => jest.advanceTimersByTime(YEAR_BESTS_PREFETCH_DELAY_MS));
    expect(preloadYearBests).not.toHaveBeenCalled();
  });
});
