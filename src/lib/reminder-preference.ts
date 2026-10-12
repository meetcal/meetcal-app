import AsyncStorage from '@react-native-async-storage/async-storage';
import { NOTIFICATION_ENABLED_KEY } from '@/utils/notifications';

/**
 * The "Session Reminders" preference and the one rule that decides whether
 * reminders are scheduled. Kept apart from `lib/saved-sessions-reminders` so
 * the Profile switch can write it without importing the scheduling code.
 *
 * Reminders are a premium feature. The rule used to live only in the Profile
 * switch: onboarding wrote the flag for every user who allowed
 * notifications, and scheduling read nothing else, so a free user got a
 * reminder for every saved session while Profile showed the switch off and
 * locked. Scheduling now asks `resolveRemindersPolicy` too.
 */

/** The stored choice: `null` when the user has never made one. */
export async function readReminderPreference(): Promise<boolean | null> {
  const value = await AsyncStorage.getItem(NOTIFICATION_ENABLED_KEY);
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

const listeners = new Set<() => void>();

/** Called after every `setRemindersEnabled`. Returns the unsubscribe. */
export function subscribeToReminderPreference(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Store the user's choice and tell the reminder sync, which schedules every
 * saved session's reminder when it turns on and cancels them when it turns
 * off. Turning reminders on used to only write the flag, so sessions saved
 * before then never got one, and off-then-on lost every reminder.
 */
export async function setRemindersEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(NOTIFICATION_ENABLED_KEY, String(enabled));
  for (const listener of [...listeners]) listener();
}

/**
 * - `on`: schedule a reminder for every upcoming saved session.
 * - `off`: cancel every session reminder.
 * - `unknown`: the subscription status has not resolved. Leave the saved
 *   sessions' reminders as they are (cancelling them would drop a paying
 *   user's reminders while RevenueCat loads) but still cancel the reminders
 *   of sessions that are no longer saved.
 *
 * A user who never chose (`null`) gets reminders once subscribed, the same
 * default the Profile switch applies on its first visit.
 */
export type RemindersPolicy = 'on' | 'off' | 'unknown';

export function resolveRemindersPolicy(
  preference: boolean | null,
  isSubscribed: boolean | null,
): RemindersPolicy {
  if (preference === false) return 'off';
  if (isSubscribed === null) return 'unknown';
  return isSubscribed ? 'on' : 'off';
}
