import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { subscribeToReminderPreference } from '@/lib/reminder-preference';
import {
  createReminderSyncRunner,
  type ReminderSyncRunner,
  syncSessionReminders,
} from '@/lib/saved-sessions-reminders';
import type { SavedSession } from '@/lib/saved-sessions-store';

/**
 * Keep the pending session reminders in line with `sessions`: after every
 * load, reconcile and commit (each publishes a new list), when the
 * subscription status changes, when the Profile switch changes, and on
 * sign-out (an empty list cancels them all), and whenever the app returns
 * to the foreground. Only the soonest `MAX_PENDING_REMINDERS` are pending at
 * once, and a reminder firing changes none of the above, so the foreground
 * sync is what fills the slots fired reminders free. (With the app never
 * reopened, sessions past the cap get no reminder: the OS limit wins.)
 *
 * `ready` holds the sync until the list is authoritative: the empty list a
 * cold start renders before storage is read would otherwise cancel every
 * reminder and then schedule them all again.
 */
export function useReminderSync(
  sessions: SavedSession[],
  isSubscribed: boolean | null,
  ready: boolean,
): void {
  const runnerRef = useRef<ReminderSyncRunner | null>(null);
  runnerRef.current ??= createReminderSyncRunner();
  const runner = runnerRef.current;
  const [preferenceVersion, setPreferenceVersion] = useState(0);
  const [foregroundVersion, setForegroundVersion] = useState(0);

  useEffect(
    () => subscribeToReminderPreference(() => setPreferenceVersion((version) => version + 1)),
    [],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setForegroundVersion((version) => version + 1);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!ready) return;
    void runner.run(() => syncSessionReminders(sessions, isSubscribed));
  }, [foregroundVersion, isSubscribed, preferenceVersion, ready, runner, sessions]);
}
