import {
  isSheetDrag,
  SHEET_DISMISS_VELOCITY,
  shouldDismissSheet,
} from "@/components/ui/filters/filterSheetGesture";

describe("isSheetDrag", () => {
  it("claims a downward, mostly vertical move", () => {
    expect(isSheetDrag(2, 20)).toBe(true);
  });

  it("leaves taps, upward moves and horizontal swipes alone", () => {
    expect(isSheetDrag(0, 3)).toBe(false);
    expect(isSheetDrag(0, -40)).toBe(false);
    expect(isSheetDrag(40, 20)).toBe(false);
  });
});

describe("shouldDismissSheet", () => {
  const height = 800;

  it("dismisses a slow drag past a quarter of the sheet", () => {
    expect(shouldDismissSheet(200, 0.1, height)).toBe(true);
    expect(shouldDismissSheet(199, 0.1, height)).toBe(false);
  });

  it("dismisses a short fast flick", () => {
    expect(shouldDismissSheet(30, SHEET_DISMISS_VELOCITY, height)).toBe(true);
  });

  it("never dismisses on an upward or zero release", () => {
    expect(shouldDismissSheet(0, 5, height)).toBe(false);
    expect(shouldDismissSheet(-50, 5, height)).toBe(false);
  });

  it("does not treat an unmeasured sheet as fully dragged", () => {
    expect(shouldDismissSheet(10, 0, 0)).toBe(false);
  });
});
