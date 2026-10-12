import { useEffect, useRef, useState } from 'react';

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
 * sign-out (an empty list cancels them all).
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

  useEffect(
    () => subscribeToReminderPreference(() => setPreferenceVersion((version) => version + 1)),
    [],
  );

  useEffect(() => {
    if (!ready) return;
    void runner.run(() => syncSessionReminders(sessions, isSubscribed));
  }, [isSubscribed, preferenceVersion, ready, runner, sessions]);
}
