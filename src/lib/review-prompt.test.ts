import AsyncStorage from "@react-native-async-storage/async-storage";
import * as StoreReview from "expo-store-review";

import {
  FIRST_SAVE_KEY,
  FIRST_SAVE_REVIEW_SHOWN_KEY,
  loadReviewPromptState,
  parseReviewPromptState,
  REVIEW_COUNT_KEY,
  REVIEW_COUNTS,
  REVIEW_PROMPTED_KEY,
  requestReviewAfterFirstSave,
  requestStoreReview,
  shouldRequestFirstSaveReview,
  shouldRequestReview,
} from "@/lib/review-prompt";

jest.mock("expo-store-review", () => ({
  isAvailableAsync: jest.fn(async () => true),
  requestReview: jest.fn(async () => {}),
}));

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe("loadReviewPromptState", () => {
  it("reads both persisted values", async () => {
    await AsyncStorage.setItem(REVIEW_COUNT_KEY, "7");
    await AsyncStorage.setItem(REVIEW_PROMPTED_KEY, "[5]");
    await expect(loadReviewPromptState()).resolves.toEqual({
      applyCount: 7,
      promptedCounts: [5],
    });
  });
});

describe("requestStoreReview", () => {
  it("asks the store when it is available", async () => {
    await expect(requestStoreReview()).resolves.toBe(true);
    expect(StoreReview.requestReview).toHaveBeenCalledTimes(1);
  });

  it("does not ask, and reports it, when the store is unavailable", async () => {
    jest.mocked(StoreReview.isAvailableAsync).mockResolvedValueOnce(false);
    await expect(requestStoreReview()).resolves.toBe(false);
    expect(StoreReview.requestReview).not.toHaveBeenCalled();
  });

  it("never rejects", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.mocked(StoreReview.requestReview).mockRejectedValueOnce(new Error("no"));
    await expect(requestStoreReview()).resolves.toBe(false);
    warn.mockRestore();
  });
});

describe("requestReviewAfterFirstSave", () => {
  it("asks once, on the first save, and remembers both flags", async () => {
    expect(shouldRequestFirstSaveReview(null, null)).toBe(true);
    await requestReviewAfterFirstSave();
    expect(StoreReview.requestReview).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem(FIRST_SAVE_KEY)).toBe("true");
    expect(await AsyncStorage.getItem(FIRST_SAVE_REVIEW_SHOWN_KEY)).toBe("true");

    await requestReviewAfterFirstSave();
    expect(StoreReview.requestReview).toHaveBeenCalledTimes(1);
  });

  it("does not ask again after a first save where the store was unavailable", async () => {
    jest.mocked(StoreReview.isAvailableAsync).mockResolvedValueOnce(false);
    await requestReviewAfterFirstSave();
    expect(await AsyncStorage.getItem(FIRST_SAVE_KEY)).toBe("true");
    expect(await AsyncStorage.getItem(FIRST_SAVE_REVIEW_SHOWN_KEY)).toBeNull();

    await requestReviewAfterFirstSave();
    expect(StoreReview.requestReview).not.toHaveBeenCalled();
  });
});

describe("parseReviewPromptState", () => {
  it("starts from zero with nothing stored", () => {
    expect(parseReviewPromptState(null, null)).toEqual({
      applyCount: 0,
      promptedCounts: [],
    });
  });

  it("keeps only the known prompt thresholds from the stored list", () => {
    expect(
      parseReviewPromptState("12", JSON.stringify([5, "50", null, 7, 100])),
    ).toEqual({ applyCount: 12, promptedCounts: [5, 100] });
  });

  it("does not let a corrupt prompted list reset the apply count", () => {
    expect(parseReviewPromptState("42", "{not json")).toEqual({
      applyCount: 42,
      promptedCounts: [],
    });
    expect(parseReviewPromptState("42", '"5"').promptedCounts).toEqual([]);
  });

  it("treats a non-count value as zero", () => {
    for (const raw of ["abc", "-3", "2.5", "Infinity"]) {
      expect(parseReviewPromptState(raw, null).applyCount).toBe(0);
    }
  });
});

describe("shouldRequestReview", () => {
  it("asks once at each threshold only", () => {
    expect(REVIEW_COUNTS).toEqual([5, 50, 100]);
    expect(shouldRequestReview(4, [])).toBe(false);
    expect(shouldRequestReview(5, [])).toBe(true);
    expect(shouldRequestReview(5, [5])).toBe(false);
    expect(shouldRequestReview(50, [5])).toBe(true);
    expect(shouldRequestReview(101, [])).toBe(false);
  });
});
