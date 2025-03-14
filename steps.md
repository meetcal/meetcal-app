# Migration Plan: Database-Driven with Robust Offline Support

## Phase 1: Database and Local Storage Setup ✅
1. Create Supabase tables
   - Add version tracking columns
     ```sql
     - last_updated TIMESTAMP
     - version INTEGER
     ```

2. Create Local Storage Structure ✅
   ```typescript
   interface LocalStorageSchema {
     meets: {
       [meetName: string]: {
         schedule: Schedule;
         athletes: LiftResult[];
         lastSynced: number;
         version: number;
       }
     }
     savedSessions: SavedSession[];
     preferences: UserPreferences;
   }
   ```

## Phase 2: Offline-First Data Layer ✅
1. Create `lib/database/offline-store.ts` ✅
   - initStore() ✅
   - getMeetData(meet: MeetName) ✅
   - saveMeetSchedule(meet: MeetName, schedule: Schedule) ✅
   - saveMeetAthletes(meet: MeetName, athletes: LiftResult[]) ✅
   - getLastSyncTime(meet: MeetName) ✅
   - needsSync(meet: MeetName) ✅

2. Create `lib/database/sync-manager.ts` ✅
   - syncIfNeeded() ✅
   - forceSync() ✅
   - startPeriodicSync() ✅
   - stopSync() ✅

3. Create `lib/database/network-status.ts` ✅
   - isOnline(): boolean ✅
   - onNetworkStatusChange(callback) ✅

## Phase 3: Enhanced Data Access Layer (In Progress)
1. Update `lib/database/queries.ts` (Partially Complete)
   ```typescript
   - getScheduleByMeet(meet: MeetName, forceRefresh?: boolean) ❌
   - getAthletesByMeet(meet: MeetName, forceRefresh?: boolean) ❌
   - getSessionDetails(meet: MeetName, sessionId: number) ❌
   ```

2. Create Background Sync Service ✅
   - Implemented within SyncManager class
   - setupPeriodicSync() ✅
   - syncWhenOnline() ✅
   - handleSyncErrors() ✅

## Phase 4: UI Components for Offline Status ✅
1. Create offline indicators ✅
   ```typescript
   - OfflineIndicator ✅
   - LastSyncedIndicator ✅
   - SyncStatusBadge ✅
   ```

2. Create sync controls ✅
   ```typescript
   - ManualSyncButton ✅
   - SyncSettingsPanel ✅
   ```

## Phase 5: Update Components with Offline Support (In Progress) 🔄
1. Update schedule.tsx ✅
   ```typescript
   - Use offline-first data fetching ✅
   - Add sync status indicator ✅
   - Add pull-to-refresh with offline awareness ✅
   - Show last synced timestamp ✅
   ```

2. Update schedule-details.tsx ✅
   ```typescript
   - Cache session details locally ✅
   - Show offline indicator when using cached data ✅
   - Enable manual refresh when online ✅
   - Add pull-to-refresh functionality ✅
   - Show loading states appropriately ✅
   ```

3. Update saved.tsx ✅
   ```typescript
   - Store complete session data locally ✅
   - Work entirely offline ✅
   - Sync new saves when online ✅
   ```

4. Update start-list.tsx ✅
   ```typescript
   - Cache athlete data locally ✅
   - Show loading states ✅
   - Enable offline-first data fetching ✅
   - Add pull-to-refresh functionality ✅
   - Handle empty data states ✅
   ```

## Phase 6: Meet Switching with Offline Support ✅
1. Update SelectedMeetContext ✅
   ```typescript
   - Preload and cache meet data ✅
   - Handle meet switching offline ✅
   - Queue data sync for new meet when online ✅
   ```

2. Create Meet Data Prefetch ✅
   ```typescript
   - prefetchMeetData(meetName: MeetName) ✅
   - cleanupOldMeetData() ✅
   - manageCacheSize() ✅
   ```

Implementation Details:
- Created meet-manager.ts for cache management
- Set 50MB cache size limit
- Keep max 3 recent meets
- Track meet data sizes and access times
- Auto-cleanup of old meet data
- Integrated with SelectedMeetContext
- Added sync status tracking
- Enhanced error handling

## Phase 7: Storage Management ✅
1. Create storage cleanup utilities ✅
   ```typescript
   - cleanupOldData() ✅
   - calculateStorageUsage() ✅
   - optimizeCacheSize() ✅
   ```

2. Implement data retention policies ✅
   ```typescript
   - keepLastNMeets(n: number) ✅
   - removeOldVersions() ✅
   - compressOldData() ✅
   ```

Implementation Details:
- Created storage-manager.ts for comprehensive storage management
- Added version tracking for meet data
- Implemented data compression for old/large data
- Set up automatic cleanup policies:
  - Keep max 2 versions per meet
  - Remove versions older than 1 week
  - Compress data older than 1 day
  - Maintain total storage under limits
- Added storage usage tracking
- Integrated with meet-manager.ts
- Enhanced error handling and logging

## Phase 8: Testing with Network Conditions
1. Test offline scenarios
   - Complete offline usage
   - Intermittent connectivity
   - Slow network conditions
   - Data sync conflicts
   - Storage limits

2. Test sync functionality
   - Background sync
   - Manual sync
   - Conflict resolution
   - Data versioning
   - Error recovery

## Phase 9: User Experience Enhancements
1. Add offline mode indicators
   - Sync status in UI
   - Last synced timestamp
   - Network status
   - Data freshness badges

2. Add sync controls
   - Manual sync option
   - Sync preferences
   - Storage management
   - Data usage settings

## Phase 10: Deployment with Offline Support
1. Deploy database changes
2. Implement data migration
3. Add analytics for sync issues
4. Monitor offline usage
5. Track sync success rates

## Notes:
- Always prefer local data first, then fetch updates
- Show clear indicators for data freshness
- Implement progressive enhancement
- Handle storage limitations gracefully
- Provide manual sync options
- Consider battery and data usage
- Implement proper error recovery
- Use service workers for web version
- Consider implementing conflict resolution UI
- Add proper logging for sync issues
