# Data Management 📊

This document covers all aspects of data management in the MeetCal application, including database design, data synchronization, offline storage, and data flow patterns.

## Data Sources Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Data Architecture                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │  Supabase   │◄──►│    App      │◄──►│ AsyncStorage│         │
│  │ (PostgreSQL)│    │   Context   │    │  (Local)    │         │
│  │             │    │   State     │    │             │         │
│  └─────────────┘    └─────────────┘    └─────────────┘         │
│         ▲                   ▲                   ▲               │
│         │                   │                   │               │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │   Real-time │    │    Sync     │    │   Cache     │         │
│  │Subscriptions│    │  Manager    │    │ Management  │         │
│  └─────────────┘    └─────────────┘    └─────────────┘         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Database Schema (Supabase)

### Core Tables

#### 1. `meets` Table
```sql
CREATE TABLE meets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  venue_name TEXT NOT NULL,
  venue_street TEXT NOT NULL,
  venue_city TEXT NOT NULL,
  venue_state TEXT NOT NULL,
  venue_zip TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  start_date TIMESTAMP WITH TIME ZONE NOT NULL,
  end_date TIMESTAMP WITH TIME ZONE NOT NULL,
  status TEXT CHECK (status IN ('upcoming', 'ongoing', 'completed')) DEFAULT 'upcoming',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### 2. `user_profiles` Table
```sql
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT CHECK (role IN ('Athlete', 'Coach', 'Spectator', 'Official', 'Vendor', 'Media')) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Database Types (TypeScript)

```typescript
// lib/database.types.ts
export interface Database {
  public: {
    Tables: {
      meets: {
        Row: {
          id: string
          name: string
          venue_name: string
          venue_street: string
          venue_city: string
          venue_state: string
          venue_zip: string
          time_zone: string
          start_date: string
          end_date: string
          status: 'upcoming' | 'ongoing' | 'completed'
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          venue_name: string
          // ... other required fields
        }
        Update: {
          name?: string
          venue_name?: string
          // ... optional fields for updates
        }
      }
      user_profiles: {
        Row: {
          id: string
          name: string
          email: string
          role: 'Athlete' | 'Coach' | 'Spectator' | 'Official' | 'Vendor' | 'Media'
          created_at: string
        }
        // ... Insert and Update types
      }
    }
  }
}
```

## Supabase Configuration

### Client Setup
```typescript
// lib/supabase.ts
import { createClient } from '@supabase/supabase-js'
import { Database } from './database.types'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Custom auth configuration
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})
```

### Row Level Security (RLS)

```sql
-- Enable RLS on tables
ALTER TABLE meets ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Example policies
CREATE POLICY "Users can view all meets" ON meets
  FOR SELECT USING (true);

CREATE POLICY "Users can update their own profile" ON user_profiles
  FOR UPDATE USING (auth.uid() = id);
```

## Data Synchronization

### Sync Manager Architecture

```typescript
// lib/database/sync-manager.ts
export class SyncManager {
  private meetId: string
  private isOnline: boolean = true
  private syncInterval: NodeJS.Timeout | null = null

  constructor(meetId: string) {
    this.meetId = meetId
    this.setupNetworkListener()
    this.startPeriodicSync()
  }

  async syncData(): Promise<void> {
    try {
      const localData = await this.getLocalData()
      const remoteData = await this.fetchRemoteData()
      
      const conflicts = this.detectConflicts(localData, remoteData)
      const resolved = await this.resolveConflicts(conflicts)
      
      await this.updateLocalStorage(resolved)
      await this.pushToRemote(resolved)
      
      this.notifyContexts('sync_complete')
    } catch (error) {
      this.handleSyncError(error)
    }
  }

  private async resolveConflicts(conflicts: DataConflict[]): Promise<any> {
    // Last-write-wins strategy with user preference for manual resolution
    return conflicts.map(conflict => {
      if (conflict.type === 'user_preference') {
        return conflict.remote // Server wins for user preferences
      }
      return conflict.local.updated_at > conflict.remote.updated_at 
        ? conflict.local 
        : conflict.remote
    })
  }
}
```

### Real-time Subscriptions

```typescript
// Real-time data updates
export function setupRealtimeSubscription(meetId: string, onUpdate: (data: any) => void) {
  return supabase
    .channel(`meet_${meetId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'meets',
        filter: `id=eq.${meetId}`
      },
      (payload) => {
        console.log('Real-time update:', payload)
        onUpdate(payload.new)
      }
    )
    .subscribe()
}
```

## Local Storage (AsyncStorage)

### Storage Structure

```typescript
// Local storage keys and structure
const STORAGE_KEYS = {
  SELECTED_MEET: '@selected_meet',
  MEET_DATA: '@meet_data_',
  USER_PREFERENCES: '@user_preferences',
  OFFLINE_QUEUE: '@offline_queue',
  SYNC_STATUS: '@sync_status',
  CACHED_ATHLETES: '@cached_athletes_',
  CACHED_EVENTS: '@cached_events_',
} as const

// Example: Meet data storage
interface CachedMeetData {
  meet: Meet
  athletes: Athlete[]
  events: Event[]
  schedules: Schedule[]
  lastUpdated: number
  version: string
}
```

### Cache Management

```typescript
// lib/database/cache-manager.ts
export class CacheManager {
  static async cacheMeetData(meetId: string, data: CachedMeetData): Promise<void> {
    const key = `${STORAGE_KEYS.MEET_DATA}${meetId}`
    await AsyncStorage.setItem(key, JSON.stringify({
      ...data,
      lastUpdated: Date.now(),
      version: '1.0'
    }))
  }

  static async getCachedMeetData(meetId: string): Promise<CachedMeetData | null> {
    try {
      const key = `${STORAGE_KEYS.MEET_DATA}${meetId}`
      const cached = await AsyncStorage.getItem(key)
      
      if (!cached) return null
      
      const data = JSON.parse(cached) as CachedMeetData
      
      // Check if cache is stale (older than 1 hour)
      if (Date.now() - data.lastUpdated > 60 * 60 * 1000) {
        return null
      }
      
      return data
    } catch (error) {
      console.error('Cache retrieval error:', error)
      return null
    }
  }

  static async invalidateCache(meetId?: string): Promise<void> {
    if (meetId) {
      const key = `${STORAGE_KEYS.MEET_DATA}${meetId}`
      await AsyncStorage.removeItem(key)
    } else {
      // Clear all cached meet data
      const keys = await AsyncStorage.getAllKeys()
      const meetDataKeys = keys.filter(key => key.startsWith(STORAGE_KEYS.MEET_DATA))
      await AsyncStorage.multiRemove(meetDataKeys)
    }
  }
}
```

## Data Context Management

### SelectedMeetContext

```typescript
// contexts/SelectedMeetContext.tsx
interface SelectedMeetContextType {
  selectedMeet: MeetName | null
  meetDetails: Meet | null
  availableMeets: Meet[]
  setSelectedMeet: (meet: MeetName) => Promise<void>
  isLoading: boolean
  isSyncing: boolean
  lastSynced: number | null
  syncStatus: 'idle' | 'syncing' | 'error'
  forceSync: () => Promise<void>
}

export function SelectedMeetProvider({ children }: { children: React.ReactNode }) {
  const [selectedMeet, setSelectedMeetState] = useState<MeetName | null>(null)
  const [meetDetails, setMeetDetails] = useState<Meet | null>(null)
  const [syncManager, setSyncManager] = useState<SyncManager | null>(null)

  const setSelectedMeet = async (meet: MeetName) => {
    try {
      setIsSyncing(true)
      
      // Clear existing data
      setSelectedMeetState(null)
      setMeetDetails(null)
      
      // Update storage
      await AsyncStorage.setItem('@selected_meet', meet)
      
      // Initialize sync manager
      const manager = new SyncManager(meet)
      setSyncManager(manager)
      
      // Fetch/sync data
      await manager.syncData()
      
      setSelectedMeetState(meet)
      setIsSyncing(false)
    } catch (error) {
      console.error('Meet selection error:', error)
      setIsSyncing(false)
    }
  }
}
```

## Offline Support

### Offline Queue System

```typescript
// lib/database/offline-store.ts
interface OfflineAction {
  id: string
  type: 'CREATE' | 'UPDATE' | 'DELETE'
  table: string
  data: any
  timestamp: number
  retryCount: number
}

export class OfflineStore {
  static async queueAction(action: Omit<OfflineAction, 'id' | 'timestamp' | 'retryCount'>): Promise<void> {
    const queuedAction: OfflineAction = {
      ...action,
      id: generateId(),
      timestamp: Date.now(),
      retryCount: 0
    }

    const queue = await this.getQueue()
    queue.push(queuedAction)
    await AsyncStorage.setItem(STORAGE_KEYS.OFFLINE_QUEUE, JSON.stringify(queue))
  }

  static async processQueue(): Promise<void> {
    const queue = await this.getQueue()
    
    for (const action of queue) {
      try {
        await this.executeAction(action)
        await this.removeFromQueue(action.id)
      } catch (error) {
        await this.incrementRetryCount(action.id)
        if (action.retryCount >= 3) {
          console.error('Action failed after 3 retries:', action)
          await this.removeFromQueue(action.id)
        }
      }
    }
  }

  private static async executeAction(action: OfflineAction): Promise<void> {
    switch (action.type) {
      case 'CREATE':
        await supabase.from(action.table).insert(action.data)
        break
      case 'UPDATE':
        await supabase.from(action.table).update(action.data).eq('id', action.data.id)
        break
      case 'DELETE':
        await supabase.from(action.table).delete().eq('id', action.data.id)
        break
    }
  }
}
```

### Network Status Detection

```typescript
// utils/network.ts
import NetInfo from '@react-native-community/netinfo'

export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(true)

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsOnline(state.isConnected ?? false)
      
      // Process offline queue when coming back online
      if (state.isConnected) {
        OfflineStore.processQueue()
      }
    })

    return unsubscribe
  }, [])

  return isOnline
}
```

## Data Validation

### Input Validation

```typescript
// utils/validation.ts
import { z } from 'zod'

export const MeetSchema = z.object({
  name: z.string().min(1, 'Meet name is required'),
  venue_name: z.string().min(1, 'Venue name is required'),
  venue_city: z.string().min(1, 'City is required'),
  venue_state: z.string().length(2, 'State must be 2 characters'),
  start_date: z.string().datetime('Invalid start date'),
  end_date: z.string().datetime('Invalid end date'),
  status: z.enum(['upcoming', 'ongoing', 'completed'])
})

export function validateMeetData(data: unknown): Meet {
  return MeetSchema.parse(data)
}
```

## Performance Optimizations

### Data Prefetching

```typescript
// lib/database/prefetch.ts
export async function prefetchMeetData(meetName: string): Promise<void> {
  try {
    // Fetch essential data in parallel
    const [meet, athletes, events] = await Promise.all([
      fetchMeetByName(meetName),
      fetchAthletesByMeet(meetName),
      fetchEventsByMeet(meetName)
    ])

    // Cache the data
    await CacheManager.cacheMeetData(meet.id, {
      meet,
      athletes,
      events,
      schedules: [],
      lastUpdated: Date.now(),
      version: '1.0'
    })
  } catch (error) {
    console.error('Prefetch failed:', error)
  }
}
```

### Pagination

```typescript
// Data pagination for large datasets
export async function fetchAthletesWithPagination(
  meetId: string, 
  page: number = 1, 
  limit: number = 50
): Promise<{ data: Athlete[], hasMore: boolean }> {
  const offset = (page - 1) * limit
  
  const { data, error } = await supabase
    .from('athletes')
    .select('*')
    .eq('meet_id', meetId)
    .range(offset, offset + limit - 1)
    .order('name')

  if (error) throw error

  return {
    data: data || [],
    hasMore: data?.length === limit
  }
}
```

## Error Handling

### Data Error Recovery

```typescript
// Error handling strategies
export class DataErrorHandler {
  static async handleDataError(error: any, context: string): Promise<void> {
    console.error(`Data error in ${context}:`, error)

    switch (error.code) {
      case 'PGRST301': // Database connection error
        await this.handleConnectionError()
        break
      case 'PGRST116': // Row not found
        await this.handleMissingData(context)
        break
      default:
        await this.handleGenericError(error, context)
    }
  }

  private static async handleConnectionError(): Promise<void> {
    // Switch to offline mode
    await AsyncStorage.setItem('@offline_mode', 'true')
    // Notify user
    Alert.alert('Offline Mode', 'Using cached data until connection is restored.')
  }

  private static async handleMissingData(context: string): Promise<void> {
    // Try to recover from cache
    const cached = await CacheManager.getCachedMeetData(context)
    if (cached) {
      // Use cached data
      return
    }
    
    // Fallback to empty state
    throw new Error(`No data available for ${context}`)
  }
}
```

## Data Migration

### Version Management

```typescript
// Data migration system
export class DataMigration {
  private static readonly CURRENT_VERSION = '1.2.0'

  static async migrateIfNeeded(): Promise<void> {
    const currentVersion = await AsyncStorage.getItem('@data_version')
    
    if (!currentVersion || this.isNewerVersion(currentVersion)) {
      await this.runMigrations(currentVersion || '1.0.0')
      await AsyncStorage.setItem('@data_version', this.CURRENT_VERSION)
    }
  }

  private static async runMigrations(fromVersion: string): Promise<void> {
    const migrations = [
      { version: '1.1.0', migrate: this.migrateTo110 },
      { version: '1.2.0', migrate: this.migrateTo120 },
    ]

    for (const migration of migrations) {
      if (this.isNewerVersion(fromVersion, migration.version)) {
        await migration.migrate()
      }
    }
  }
}
```

---

*This data management system provides robust, scalable data handling with offline support and real-time synchronization capabilities.*