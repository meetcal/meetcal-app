import { saveMeetSchedule } from './offline-store';
import { fetchSchedule } from './queries';
import type { MeetName } from '@/data/types/meet';
import { isNetworkAvailable } from '@/lib/networkUtils';
import { devLog } from '../logger';

const SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes

export class SyncManager {
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private isSyncing = false;
  private meetId: MeetName;

  constructor(meetId: MeetName) {
    this.meetId = meetId;
  }

  /**
   * Starts the 5-minute refresh loop. Deliberately not done in the
   * constructor: constructing a manager has to be free of side effects,
   * because callers do construct them speculatively. `SelectedMeetContext`
   * used to build one inside a `setState` updater, and React re-runs updaters
   * (StrictMode double-invocation, and any render the update is replayed in)
   * with the same pre-update `current` value — so the first instance's timer
   * ran for the rest of the session with no reference left to stop it.
   * Start/stop now belong to one effect.
   */
  public start() {
    this.startPeriodicSync();
  }

  private startPeriodicSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    this.syncInterval = setInterval(() => {
      // Fire-and-forget timer: syncIfNeeded() re-throws on failure, so we must
      // catch here. Otherwise a cancelled/aborted background fetch (e.g. the app
      // is backgrounded mid-request) escapes as an unhandled promise rejection.
      this.syncIfNeeded().catch((error) => {
        console.error('Periodic sync failed:', error);
      });
    }, SYNC_INTERVAL);
  }

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

      // Fetch only the schedule - athletes and results are fetched on-demand
      const schedule = await fetchSchedule(this.meetId);

      // Only save if we have data
      if (schedule.length > 0) {
        await saveMeetSchedule(this.meetId, schedule);
      }

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
  }
} 
