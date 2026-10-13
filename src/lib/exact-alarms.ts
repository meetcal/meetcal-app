import AsyncStorage from '@react-native-async-storage/async-storage';
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
 * No installed package reads `AlarmManager.canScheduleExactAlarms()` from JS,
 * so the app cannot tell whether it holds the permission. It offers the
 * settings page once, when the user turns reminders on, and the reminders
 * setting says they may arrive late without it.
 */

/** Android 12: exact alarms need the permission from here on. */
export const EXACT_ALARM_PERMISSION_API_LEVEL = 31;
/** Android 14: the permission is denied by default for new installs. */
export const EXACT_ALARM_DENIED_BY_DEFAULT_API_LEVEL = 34;
/** `Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM`. */
export const ACTION_REQUEST_SCHEDULE_EXACT_ALARM = 'android.settings.REQUEST_SCHEDULE_EXACT_ALARM';
/** Set once the settings page has been offered, so turning reminders on again does not nag. */
export const EXACT_ALARM_OFFERED_KEY = '@exact_alarm_settings_offered';

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

/** Whether to offer the settings page: the permission is likely denied here. */
export function shouldOfferExactAlarmSettings(
  os: string = Platform.OS,
  version: string | number = Platform.Version,
): boolean {
  const level = apiLevel(os, version);
  return level !== null && level >= EXACT_ALARM_DENIED_BY_DEFAULT_API_LEVEL;
}

/**
 * Open Android's "Alarms & reminders" page. The intent carries no package
 * (React Native's `sendIntent` cannot set one), so Android shows the list of
 * apps; when it cannot be opened, MeetCal's App info page, which links to
 * the same setting.
 */
export async function openExactAlarmSettings(): Promise<void> {
  try {
    await Linking.sendIntent(ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
  } catch (error) {
    console.warn('Exact alarms: could not open Alarms & reminders; opening App info', error);
    await Linking.openSettings().catch(() => undefined);
  }
}

/**
 * After the user turns reminders on: on Android 14+, offer the exact-alarm
 * settings page, once per install. Never throws.
 */
export async function offerExactAlarmSettingsOnce(): Promise<void> {
  if (!shouldOfferExactAlarmSettings()) return;
  try {
    if (await AsyncStorage.getItem(EXACT_ALARM_OFFERED_KEY)) return;
    await AsyncStorage.setItem(EXACT_ALARM_OFFERED_KEY, 'true');
  } catch (error) {
    console.warn('Exact alarms: could not read or record the offer', error);
    return;
  }
  Alert.alert(
    'Get reminders on time',
    'Android may deliver session reminders late unless MeetCal is allowed to set alarms and reminders. Turn on MeetCal under Alarms & reminders.',
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open Settings', onPress: () => void openExactAlarmSettings() },
    ],
  );
}
