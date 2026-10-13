/**
 * Tap-to-advance on the Wrapped slides: the left 30% of the usable width goes
 * back a slide, the right 30% goes forward, the middle does nothing.
 */

/** Share of the usable width, from the left, that goes back a slide. */
export const WRAPPED_BACK_ZONE = 0.3;
/** Share of the usable width, from the left, past which a tap advances. */
export const WRAPPED_NEXT_ZONE = 0.7;

export type WrappedTapZoneInput = {
  /** The touch's `pageX`: screen coordinates, not the touched element's. */
  pageX: number;
  windowWidth: number;
  /** Side insets (iPhone Duo's 84pt band); the zones follow the usable width. */
  insetLeft: number;
  insetRight: number;
};

/** -1 to go back a slide, 1 to go forward, 0 for a tap in the middle. */
export function wrappedTapDirection({
  pageX,
  windowWidth,
  insetLeft,
  insetRight,
}: WrappedTapZoneInput): -1 | 0 | 1 {
  const usableWidth = windowWidth - insetLeft - insetRight;
  if (!(usableWidth > 0) || !Number.isFinite(pageX)) return 0;
  const x = pageX - insetLeft;
  if (x < usableWidth * WRAPPED_BACK_ZONE) return -1;
  if (x > usableWidth * WRAPPED_NEXT_ZONE) return 1;
  return 0;
}
