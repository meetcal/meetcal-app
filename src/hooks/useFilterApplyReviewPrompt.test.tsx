import AsyncStorage from "@react-native-async-storage/async-storage";
import * as StoreReview from "expo-store-review";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { REVIEW_COUNT_KEY, REVIEW_PROMPTED_KEY } from "@/lib/review-prompt";
import { useFilterApplyReviewPrompt } from "./useFilterApplyReviewPrompt";

jest.mock("expo-store-review", () => ({
  isAvailableAsync: jest.fn(async () => true),
  requestReview: jest.fn(async () => {}),
}));

let track!: () => void;
function Harness() {
  const value = useFilterApplyReviewPrompt();
  React.useEffect(() => {
    track = value;
  });
  return null;
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 3; i += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  });

describe("useFilterApplyReviewPrompt", () => {
  let tree!: ReactTestRenderer;

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  afterEach(() => {
    act(() => tree.unmount());
  });

  it("continues the stored count and asks once at the next threshold", async () => {
    await AsyncStorage.setItem(REVIEW_COUNT_KEY, "3");
    act(() => {
      tree = create(<Harness />);
    });
    await flush();

    act(() => track()); // 4
    await flush();
    expect(StoreReview.requestReview).not.toHaveBeenCalled();

    act(() => track()); // 5
    await flush();
    expect(StoreReview.requestReview).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem(REVIEW_COUNT_KEY)).toBe("5");
    expect(await AsyncStorage.getItem(REVIEW_PROMPTED_KEY)).toBe("[5]");
  });

  it("does not ask again at a threshold it already asked at", async () => {
    await AsyncStorage.setItem(REVIEW_COUNT_KEY, "4");
    await AsyncStorage.setItem(REVIEW_PROMPTED_KEY, "[5]");
    act(() => {
      tree = create(<Harness />);
    });
    await flush();
    act(() => track());
    await flush();
    expect(StoreReview.requestReview).not.toHaveBeenCalled();
  });
});
