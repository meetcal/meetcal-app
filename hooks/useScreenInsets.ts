import { useMemo } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export type HorizontalInsets = {
  paddingLeft: number;
  paddingRight: number;
};

/**
 * Horizontal padding a screen needs so its content clears the system band on
 * the left/right edge.
 *
 * iPhone Duo reserves a band on one side — iOS 27 draws the status items and
 * the floating tab rail there — and reports it as `insets.left` / `insets.right`
 * (84pt on the Duo inner display, 0 on a regular iPhone in portrait). A screen
 * that only honours `top` and `bottom` renders underneath that band.
 *
 * Apply this at the screen's outermost container, not on inner content: inner
 * padding then sits inside the safe band the way layout margins do on iOS.
 */
export function useScreenHorizontalInsets(): HorizontalInsets {
  const insets = useSafeAreaInsets();
  return useMemo(
    () => ({ paddingLeft: insets.left, paddingRight: insets.right }),
    [insets.left, insets.right],
  );
}
