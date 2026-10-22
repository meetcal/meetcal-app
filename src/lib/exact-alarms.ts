import * as Notifications from 'expo-notifications';
import { Alert, Linking, Platform } from 'react-native';

/**
 * Android's exact-alarm permission, which session reminders need to fire on
 * time (see `scheduleNotification` in utils/notifications.ts).
 *
 * `SCHEDULE_EXACT_ALARM` is declared in app.config.js. Android 12 and 13
 * grant it at install; Android 14 denies it by default for new installs, and
 * the user grants it under Settings > Apps > Special app access > Alarms &
 * reminders. Without it Android still schedules reminders, inexactly, and
 * may deliver them late (later still in Doze).
 *
 * expo-notifications reads `AlarmManager.canScheduleExactAlarms()`
 * (`getExactAlarmPermissionsAsync`) and opens
 * `ACTION_REQUEST_SCHEDULE_EXACT_ALARM` for this app
 * (`requestExactAlarmPermissionsAsync`). Both came in expo-notifications
 * 58.1.1; a binary without them reads as `unknown`, never as denied.
 */

/** Android 12: exact alarms need the permission from here on. */
export const EXACT_ALARM_PERMISSION_API_LEVEL = 31;

/**
 * - `not-needed`: iOS, or Android before 12; reminders are always on time.
 * - `granted` / `denied`: what Android answered.
 * - `unknown`: Android 12+, but the permission could not be read.
 */
export type ExactAlarmStatus = 'not-needed' | 'granted' | 'denied' | 'unknown';

function apiLevel(os: string, version: string | number): number | null {
  if (os !== 'android') return null;
  const level = Number(version);
  return Number.isFinite(level) ? level : null;
}

/** Whether reminders on this device depend on the exact-alarm permission. */
export function remindersNeedExactAlarms(
  os: string = Platform.OS,
  version: string | number = Platform.Version,
): boolean {
  const level = apiLevel(os, version);
  return level !== null && level >= EXACT_ALARM_PERMISSION_API_LEVEL;
}

/** Whether this device can set exact alarms for reminders. Never throws. */
export async function readExactAlarmStatus(): Promise<ExactAlarmStatus> {
  if (!remindersNeedExactAlarms()) return 'not-needed';
  try {
    const response: unknown = await Notifications.getExactAlarmPermissionsAsync();
    if (typeof response !== 'object' || response === null) return 'unknown';
    const granted = 'granted' in response ? response.granted : undefined;
    if (typeof granted !== 'boolean') return 'unknown';
    return granted ? 'granted' : 'denied';
  } catch (error) {
    console.warn('Exact alarms: could not read the permission', error);
    return 'unknown';
  }
}

/**
 * Whether reminders scheduled now are exact: `true` / `false` on Android 12+
 * when the permission could be read, `null` otherwise (nothing to track).
 */
export function exactAlarmsFromStatus(status: ExactAlarmStatus): boolean | null {
  if (status === 'granted') return true;
  if (status === 'denied') return false;
  return null;
}

/**
 * Open Android's "Alarms & reminders" page for MeetCal; when it cannot be
 * opened, MeetCal's App info page, which links to the same setting. Does not
 * wait for the user to come back (the caller re-reads on foreground).
 */
export function openExactAlarmSettings(): void {
  const openAppInfo = (error: unknown) => {
    console.warn('Exact alarms: could not open Alarms & reminders; opening App info', error);
    return Linking.openSettings().catch(() => undefined);
  };
  // Resolves when the user returns (or never, if they revoke it: Android
  // restarts the app), so nothing waits on it. A binary without the native
  // function rejects with expo's UnavailabilityError.
  void Notifications.requestExactAlarmPermissionsAsync().catch(openAppInfo);
}

/**
 * After the user turns reminders on: if Android has denied exact alarms,
 * offer the settings page. Nothing when the permission is held, not needed,
 * or cannot be read. Never throws.
 */
export async function offerExactAlarmSettingsIfDenied(): Promise<void> {
  if ((await readExactAlarmStatus()) !== 'denied') return;
  Alert.alert(
    'Get reminders on time',
    'Android may deliver session reminders late unless MeetCal is allowed to set alarms and reminders. Turn on MeetCal under Alarms & reminders.',
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open Settings', onPress: () => openExactAlarmSettings() },
    ],
  );
}
