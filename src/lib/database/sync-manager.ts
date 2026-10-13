import { AppState, type NativeEventSubscription } from 'react-native';
import type { MeetName } from '@/data/types/meet';
import { markMeetScheduleVerified } from '@/lib/database/offline-store';
import { scheduleResource } from '@/lib/database/schedule-resource';
import { isNetworkAvailable } from '@/lib/networkUtils';
import { devLog } from '../logger';

/** How often the selected meet's schedule is re-fetched while the app is open. */
export const SYNC_INTERVAL_MS = 5 * 60 * 1000;

export class SyncManager {
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private appStateSubscription: NativeEventSubscription | null = null;
  private isSyncing = false;
  /** When the last sync started; a foreground sync waits out the interval. */
  private lastSyncStartedAt: number | null = null;
  private meetId: MeetName;

  constructor(meetId: MeetName) {
    this.meetId = meetId;
  }

  /**
   * Starts the 5-minute refresh loop, and a refresh on returning to the
   * foreground once the last one is that old (timers do not run while iOS
   * keeps the app suspended, which during a meet can be days). Deliberately
   * not done in the constructor: constructing a manager has to be free of
   * side effects, because callers do construct them speculatively.
   * `SelectedMeetContext` used to build one inside a `setState` updater, and
   * React re-runs updaters (StrictMode double-invocation, and any render the
   * update is replayed in) with the same pre-update `current` value — so the
   * first instance's timer ran for the rest of the session with no reference
   * left to stop it. Start/stop now belong to one effect.
   */
  public start() {
    this.startPeriodicSync();
    this.appStateSubscription?.remove();
    this.appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !this.isSyncDue()) return;
      this.runInBackground();
    });
  }

  private isSyncDue(now: number = Date.now()): boolean {
    if (this.lastSyncStartedAt === null) return true;
    const elapsed = now - this.lastSyncStartedAt;
    return elapsed < 0 || elapsed >= SYNC_INTERVAL_MS;
  }

  private runInBackground() {
    // Fire-and-forget: syncIfNeeded() re-throws on failure, so we must catch
    // here. Otherwise a cancelled/aborted background fetch (e.g. the app is
    // backgrounded mid-request) escapes as an unhandled promise rejection.
    this.syncIfNeeded().catch((error) => {
      console.error('Periodic sync failed:', error);
    });
  }

  private startPeriodicSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    this.syncInterval = setInterval(() => this.runInBackground(), SYNC_INTERVAL_MS);
  }

  /**
   * Re-fetch the schedule through the same resource every screen reads, so
   * the answer reaches the Schedule tab, the Saved tab's cards and Next
   * Session card, the session reminders and the widget, not only the disk.
   * The resource writes the offline copy only when the schedule changed, and
   * never replaces it with an empty one.
   */
  public async syncIfNeeded(): Promise<void> {
    if (this.isSyncing) {
      devLog('Already syncing, skipping...');
      return;
    }

    try {
      this.isSyncing = true;
      const hasNetwork = await isNetworkAvailable();
      if (!hasNetwork) {
        return;
      }
      // Only an attempt that can reach the server holds off the next one.
      this.lastSyncStartedAt = Date.now();

      // Only the schedule - athletes and results are fetched on-demand.
      const result = await scheduleResource.revalidate(this.meetId);
      // A changed schedule was saved, which stamps the sync time; an
      // unchanged one still counts as checked for the offline banner.
      if (!result.changed) await markMeetScheduleVerified(this.meetId);
    } catch (error) {
      console.error('Sync failed:', error);
      throw error;
    } finally {
      this.isSyncing = false;
    }
  }

  public stopSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    this.appStateSubscription?.remove();
    this.appStateSubscription = null;
  }
}
