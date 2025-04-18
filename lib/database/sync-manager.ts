import { getMeetData, saveMeetSchedule, saveMeetAthletes, clearMeetData } from './offline-store';
import { fetchSchedule, fetchAthletes } from './queries';
import type { MeetData } from './offline-store';
import type { MeetName } from '@/data/types/meet';

const SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes

export class SyncManager {
  private syncInterval: NodeJS.Timeout | null = null;
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
      this.syncIfNeeded();
    }, SYNC_INTERVAL);
  }

  public async syncIfNeeded(): Promise<void> {
    if (this.isSyncing) {
      console.log('Already syncing, skipping...');
      return;
    }

    try {
      this.isSyncing = true;
      
      // Clear existing data first
      await clearMeetData(this.meetId);
      
      const [schedule, athletes] = await Promise.all([
        fetchSchedule(this.meetId),
        fetchAthletes(this.meetId)
      ]);

      
      // Only save if we have data
      if (schedule.length > 0) {
        await saveMeetSchedule(this.meetId, schedule);
      }

      // Save athletes even if empty (to clear old cache)
      await saveMeetAthletes(this.meetId, athletes);

    } catch (error) {
      console.error('Sync failed:', error);
      // Clear data on error
      await clearMeetData(this.meetId);
    } finally {
      this.isSyncing = false;
    }
  }

  public async getMeetData(): Promise<MeetData> {
    try {
      // Always try to sync first
      await this.syncIfNeeded();
    } catch (error) {
      console.log('Sync failed:', error);
      // Clear data on error
      await clearMeetData(this.meetId);
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