// Drag-to-dismiss policy for the Android filter sheet. iOS uses the native
// page sheet, whose swipe-down is handled by UIKit.

/** Vertical travel (pt) before a drag on the handle is claimed from a tap. */
export const SHEET_DRAG_ACTIVATION_PT = 6;
/** Fraction of the sheet's height a slow drag must cover to dismiss. */
export const SHEET_DISMISS_DISTANCE_RATIO = 0.25;
/** Downward release velocity (pt/ms) that dismisses regardless of distance. */
export const SHEET_DISMISS_VELOCITY = 0.8;

/** A move is a sheet drag when it is downward and mostly vertical. */
export function isSheetDrag(dx: number, dy: number): boolean {
  return dy > SHEET_DRAG_ACTIVATION_PT && Math.abs(dy) > Math.abs(dx);
}

/** Decide on release whether the sheet closes or springs back. */
export function shouldDismissSheet(
  dy: number,
  vy: number,
  sheetHeight: number,
): boolean {
  if (dy <= 0) return false;
  if (vy >= SHEET_DISMISS_VELOCITY) return true;
  return sheetHeight > 0 && dy >= sheetHeight * SHEET_DISMISS_DISTANCE_RATIO;
}
