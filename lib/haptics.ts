import * as Haptics from 'expo-haptics';

/**
 * The app's one haptic policy.
 *
 * AGENTS.md PoT #9 "don't keep a second copy of policy": eight call sites used
 * to repeat `process.env.EXPO_OS === 'ios' && Haptics.<x>Async(...)`, so the
 * platform gate and the chosen feedback style were duplicated per screen.
 *
 * Two rules live here:
 *   - Haptics are iOS-only in this app. Android taps stay silent.
 *   - A haptic is decoration. `expo-haptics` rejects on hardware that cannot
 *     play the pattern, and an ignored rejection becomes a red-box "possible
 *     unhandled promise rejection" in dev, so every call swallows its own
 *     failure (PoT #7 "check return values").
 *
 * `process.env.EXPO_OS` is inlined by the Expo Babel plugin at bundle time, so
 * the Android bundle still constant-folds these to no-ops.
 */
function hapticsEnabled(): boolean {
  return process.env.EXPO_OS === 'ios';
}

function ignoreHapticFailure(): void {
  // Intentionally empty: a missing Taptic Engine is not an app error.
}

/** Light tap: press-in on tabs, buttons, filter pills, modal rows. */
export function lightImpact(): void {
  if (!hapticsEnabled()) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
    ignoreHapticFailure,
  );
}

/** Confirmation pattern: a save/export/share that actually succeeded. */
export function successNotification(): void {
  if (!hapticsEnabled()) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
    ignoreHapticFailure,
  );
}

/** Failure pattern: paired with an error toast. */
export function errorNotification(): void {
  if (!hapticsEnabled()) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
    ignoreHapticFailure,
  );
}
