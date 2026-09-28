import {
  parseReviewPromptState,
  REVIEW_COUNTS,
  shouldRequestReview,
} from "@/lib/review-prompt";

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
