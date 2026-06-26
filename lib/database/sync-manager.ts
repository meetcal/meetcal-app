import { getMeetData, saveMeetSchedule } from './offline-store';
import { fetchSchedule } from './queries';
import type { MeetData } from './offline-store';
import type { MeetName } from '@/data/types/meet';
import { isNetworkAvailable } from '@/lib/networkUtils';

const SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes

export class SyncManager {
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private isSyncing = false;
  private meetId: MeetName;

  constructor(meetId: MeetName) {
    this.meetId = meetId;
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
      console.log('Already syncing, skipping...');
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

  public async getMeetData(): Promise<MeetData> {
    try {
      // Always try to sync first
      await this.syncIfNeeded();
    } catch (error) {
      console.log('Sync failed, using cached data:', error);
    }

    // Get data from cache (whether sync succeeded or failed)
    const data = await getMeetData(this.meetId);
    return data;
  }

  public stopSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }
} 
