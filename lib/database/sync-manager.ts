import { isOnline } from './network-status';
import { getMeetData, saveMeetSchedule, saveMeetAthletes, getLastSyncTime, needsSync } from './offline-store';
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
    if (this.isSyncing || !isOnline() || !await needsSync(this.meetId)) {
      return;
    }

    try {
      this.isSyncing = true;
      
      const [schedule, athletes] = await Promise.all([
        fetchSchedule(),
        fetchAthletes()
      ]);

      await Promise.all([
        saveMeetSchedule(this.meetId, schedule),
        saveMeetAthletes(this.meetId, athletes)
      ]);

    } catch (error) {
      console.error('Sync failed:', error);
    } finally {
      this.isSyncing = false;
    }
  }

  public async forceSync(): Promise<void> {
    if (this.isSyncing || !isOnline()) {
      return;
    }

    try {
      this.isSyncing = true;
      
      const [schedule, athletes] = await Promise.all([
        fetchSchedule(),
        fetchAthletes()
      ]);

      await Promise.all([
        saveMeetSchedule(this.meetId, schedule),
        saveMeetAthletes(this.meetId, athletes)
      ]);

    } catch (error) {
      console.error('Force sync failed:', error);
      throw error;
    } finally {
      this.isSyncing = false;
    }
  }

  public async getMeetData(): Promise<MeetData> {
    await this.syncIfNeeded();
    return getMeetData(this.meetId);
  }

  public stopSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }
} 