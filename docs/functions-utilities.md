# Functions & Utilities ⚙️

This document provides comprehensive documentation for utility functions, helper methods, custom hooks, and shared business logic used throughout the MeetCal application.

## Function Categories

```
lib/
├── supabase.ts          # Database client configuration
├── notifications.ts     # Push notification utilities
├── authCache.ts        # Authentication caching
├── profile.ts          # User profile utilities
├── posthog.ts          # Analytics configuration
└── database/           # Database utilities
    ├── sync-manager.ts
    ├── cache-manager.ts
    ├── meet-manager.ts
    └── offline-store.ts

utils/
├── validation.ts       # Input validation utilities
├── formatting.ts       # Data formatting helpers
├── time.ts            # Time and date utilities
├── network.ts         # Network status utilities
└── performance.ts     # Performance monitoring

hooks/
├── useTheme.ts        # Theme management hook
├── useNetworkStatus.ts # Network connectivity
├── useAsyncStorage.ts # Storage utilities
└── useDebounce.ts     # Debounced values
```

## Database Utilities

### Supabase Client (`lib/supabase.ts`)

**Purpose**: Centralized Supabase client configuration and initialization

```typescript
import { createClient } from '@supabase/supabase-js'
import { Database } from './database.types'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: {
    headers: {
      'X-Client-Info': 'meetcal-mobile',
    },
  },
})

// Helper functions for common operations
export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function getCurrentUser() {
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error) throw error
  return user
}

export async function getCurrentSession() {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error) throw error
  return session
}
```

### Meet Manager (`lib/database/meet-manager.ts`)

**Purpose**: Centralized meet data management and operations

```typescript
import { supabase } from '../supabase'
import { Meet, MeetName } from '@/data/types/meet'

export class MeetManager {
  /**
   * Fetch all available meets
   */
  static async fetchMeets(): Promise<Meet[]> {
    const { data, error } = await supabase
      .from('meets')
      .select('*')
      .order('start_date', { ascending: true })

    if (error) throw error
    return data || []
  }

  /**
   * Fetch a specific meet by name
   */
  static async fetchMeetByName(name: MeetName): Promise<Meet> {
    const { data, error } = await supabase
      .from('meets')
      .select('*')
      .eq('name', name)
      .single()

    if (error) throw error
    if (!data) throw new Error(`Meet not found: ${name}`)
    
    return data
  }

  /**
   * Update meet access timestamp
   */
  static async updateMeetAccess(meetId: string): Promise<void> {
    const { error } = await supabase
      .from('meet_access_log')
      .insert({
        meet_id: meetId,
        user_id: (await getCurrentUser())?.id,
        accessed_at: new Date().toISOString(),
      })

    if (error) console.warn('Failed to log meet access:', error)
  }

  /**
   * Search meets by various criteria
   */
  static async searchMeets(query: string, filters?: {
    status?: 'upcoming' | 'ongoing' | 'completed'
    startDate?: string
    endDate?: string
    location?: string
  }): Promise<Meet[]> {
    let queryBuilder = supabase
      .from('meets')
      .select('*')

    // Text search across multiple fields
    if (query) {
      queryBuilder = queryBuilder.or(
        `name.ilike.%${query}%,venue_name.ilike.%${query}%,venue_city.ilike.%${query}%`
      )
    }

    // Apply filters
    if (filters?.status) {
      queryBuilder = queryBuilder.eq('status', filters.status)
    }

    if (filters?.startDate) {
      queryBuilder = queryBuilder.gte('start_date', filters.startDate)
    }

    if (filters?.endDate) {
      queryBuilder = queryBuilder.lte('end_date', filters.endDate)
    }

    if (filters?.location) {
      queryBuilder = queryBuilder.or(
        `venue_city.ilike.%${filters.location}%,venue_state.ilike.%${filters.location}%`
      )
    }

    const { data, error } = await queryBuilder
      .order('start_date', { ascending: true })

    if (error) throw error
    return data || []
  }

  /**
   * Get meet statistics
   */
  static async getMeetStats(meetId: string): Promise<{
    totalEvents: number
    totalAthletes: number
    completedEvents: number
    upcomingEvents: number
  }> {
    const [eventsResult, athletesResult] = await Promise.all([
      supabase
        .from('events')
        .select('id, status')
        .eq('meet_id', meetId),
      
      supabase
        .from('event_entries')
        .select('athlete_id')
        .eq('meet_id', meetId)
    ])

    if (eventsResult.error) throw eventsResult.error
    if (athletesResult.error) throw athletesResult.error

    const events = eventsResult.data || []
    const uniqueAthletes = new Set(athletesResult.data?.map(e => e.athlete_id) || [])

    return {
      totalEvents: events.length,
      totalAthletes: uniqueAthletes.size,
      completedEvents: events.filter(e => e.status === 'completed').length,
      upcomingEvents: events.filter(e => e.status === 'upcoming').length,
    }
  }
}
```

### Cache Manager (`lib/database/cache-manager.ts`)

**Purpose**: Local data caching and management

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage'

export interface CacheOptions {
  ttl?: number          // Time to live in milliseconds
  version?: string      // Cache version for invalidation
  compress?: boolean    // Compress large data
}

export class CacheManager {
  private static readonly DEFAULT_TTL = 60 * 60 * 1000 // 1 hour
  private static readonly VERSION_KEY = '@cache_version'

  /**
   * Store data in cache with optional TTL
   */
  static async set<T>(
    key: string, 
    data: T, 
    options: CacheOptions = {}
  ): Promise<void> {
    try {
      const cacheItem = {
        data,
        timestamp: Date.now(),
        ttl: options.ttl || this.DEFAULT_TTL,
        version: options.version || '1.0',
      }

      const serialized = JSON.stringify(cacheItem)
      
      // Compress if data is large and compression is enabled
      const finalData = options.compress && serialized.length > 10000
        ? await this.compress(serialized)
        : serialized

      await AsyncStorage.setItem(key, finalData)
    } catch (error) {
      console.error('Cache write error:', error)
      throw new Error(`Failed to cache data for key: ${key}`)
    }
  }

  /**
   * Retrieve data from cache
   */
  static async get<T>(key: string): Promise<T | null> {
    try {
      const cached = await AsyncStorage.getItem(key)
      if (!cached) return null

      // Handle compressed data
      const decompressed = cached.startsWith('{') 
        ? cached 
        : await this.decompress(cached)

      const cacheItem = JSON.parse(decompressed)

      // Check if cache is expired
      if (this.isExpired(cacheItem)) {
        await AsyncStorage.removeItem(key)
        return null
      }

      return cacheItem.data
    } catch (error) {
      console.error('Cache read error:', error)
      await AsyncStorage.removeItem(key) // Clean up corrupted cache
      return null
    }
  }

  /**
   * Check if cache item is expired
   */
  private static isExpired(cacheItem: any): boolean {
    const now = Date.now()
    const expiry = cacheItem.timestamp + cacheItem.ttl
    return now > expiry
  }

  /**
   * Clear all cached data
   */
  static async clearAll(): Promise<void> {
    try {
      const keys = await AsyncStorage.getAllKeys()
      const cacheKeys = keys.filter(key => key.startsWith('@cache_'))
      await AsyncStorage.multiRemove(cacheKeys)
    } catch (error) {
      console.error('Cache clear error:', error)
    }
  }

  /**
   * Get cache statistics
   */
  static async getStats(): Promise<{
    totalItems: number
    totalSize: number
    expiredItems: number
  }> {
    try {
      const keys = await AsyncStorage.getAllKeys()
      const cacheKeys = keys.filter(key => key.startsWith('@cache_'))
      
      let totalSize = 0
      let expiredItems = 0

      for (const key of cacheKeys) {
        const item = await AsyncStorage.getItem(key)
        if (item) {
          totalSize += item.length
          
          try {
            const cacheItem = JSON.parse(item)
            if (this.isExpired(cacheItem)) {
              expiredItems++
            }
          } catch {
            // Ignore malformed cache items
          }
        }
      }

      return {
        totalItems: cacheKeys.length,
        totalSize,
        expiredItems,
      }
    } catch (error) {
      console.error('Cache stats error:', error)
      return { totalItems: 0, totalSize: 0, expiredItems: 0 }
    }
  }

  /**
   * Compress data for storage
   */
  private static async compress(data: string): Promise<string> {
    // Implementation would use a compression library like pako
    // For now, return as-is
    return data
  }

  /**
   * Decompress stored data
   */
  private static async decompress(data: string): Promise<string> {
    // Implementation would use a decompression library
    // For now, return as-is
    return data
  }
}
```

## Notification Utilities (`lib/notifications.ts`)

**Purpose**: Push notification management and utilities

```typescript
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import { Platform } from 'react-native'

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

export interface NotificationData {
  title: string
  body: string
  data?: Record<string, any>
  categoryId?: string
}

export class NotificationManager {
  /**
   * Register for push notifications and get token
   */
  static async registerForPushNotifications(): Promise<string | null> {
    if (!Device.isDevice) {
      console.warn('Push notifications only work on physical devices')
      return null
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync()
    let finalStatus = existingStatus

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync()
      finalStatus = status
    }

    if (finalStatus !== 'granted') {
      console.warn('Failed to get push token for push notification!')
      return null
    }

    try {
      const token = await Notifications.getExpoPushTokenAsync({
        projectId: process.env.EXPO_PUBLIC_PROJECT_ID,
      })
      
      // Configure notification channels for Android
      if (Platform.OS === 'android') {
        await this.setupAndroidChannels()
      }

      return token.data
    } catch (error) {
      console.error('Error getting push token:', error)
      return null
    }
  }

  /**
   * Schedule a local notification
   */
  static async scheduleNotification(
    notification: NotificationData,
    trigger: Notifications.NotificationTriggerInput
  ): Promise<string> {
    return await Notifications.scheduleNotificationAsync({
      content: {
        title: notification.title,
        body: notification.body,
        data: notification.data || {},
        categoryIdentifier: notification.categoryId,
      },
      trigger,
    })
  }

  /**
   * Schedule event reminder
   */
  static async scheduleEventReminder(
    eventId: string,
    eventName: string,
    eventTime: Date,
    reminderMinutes: number = 30
  ): Promise<string> {
    const reminderTime = new Date(eventTime.getTime() - reminderMinutes * 60 * 1000)
    
    return await this.scheduleNotification(
      {
        title: 'Event Reminder',
        body: `${eventName} starts in ${reminderMinutes} minutes`,
        data: { eventId, type: 'event_reminder' },
        categoryId: 'event_reminder',
      },
      {
        date: reminderTime,
      }
    )
  }

  /**
   * Cancel scheduled notification
   */
  static async cancelNotification(notificationId: string): Promise<void> {
    await Notifications.cancelScheduledNotificationAsync(notificationId)
  }

  /**
   * Cancel all scheduled notifications
   */
  static async cancelAllNotifications(): Promise<void> {
    await Notifications.cancelAllScheduledNotificationsAsync()
  }

  /**
   * Get all scheduled notifications
   */
  static async getScheduledNotifications(): Promise<Notifications.NotificationRequest[]> {
    return await Notifications.getAllScheduledNotificationsAsync()
  }

  /**
   * Handle notification response
   */
  static setupNotificationResponseHandler(
    handler: (response: Notifications.NotificationResponse) => void
  ): void {
    Notifications.addNotificationResponseReceivedListener(handler)
  }

  /**
   * Handle received notifications
   */
  static setupNotificationReceivedHandler(
    handler: (notification: Notifications.Notification) => void
  ): void {
    Notifications.addNotificationReceivedListener(handler)
  }

  /**
   * Setup Android notification channels
   */
  private static async setupAndroidChannels(): Promise<void> {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    })

    await Notifications.setNotificationChannelAsync('event_reminders', {
      name: 'Event Reminders',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    })

    await Notifications.setNotificationChannelAsync('results', {
      name: 'Results & Records',
      importance: Notifications.AndroidImportance.DEFAULT,
    })
  }
}
```

## Validation Utilities (`utils/validation.ts`)

**Purpose**: Input validation and data sanitization

```typescript
import { z } from 'zod'

// Common validation schemas
export const emailSchema = z.string().email('Invalid email address')
export const passwordSchema = z.string().min(8, 'Password must be at least 8 characters')
export const nameSchema = z.string().min(1, 'Name is required').max(100, 'Name too long')

// Meet validation
export const meetSchema = z.object({
  name: z.string().min(1, 'Meet name is required'),
  venue_name: z.string().min(1, 'Venue name is required'),
  venue_street: z.string().min(1, 'Street address is required'),
  venue_city: z.string().min(1, 'City is required'),
  venue_state: z.string().length(2, 'State must be 2 characters'),
  venue_zip: z.string().regex(/^\d{5}(-\d{4})?$/, 'Invalid ZIP code'),
  time_zone: z.string().min(1, 'Time zone is required'),
  start_date: z.string().datetime('Invalid start date'),
  end_date: z.string().datetime('Invalid end date'),
  status: z.enum(['upcoming', 'ongoing', 'completed']),
}).refine((data) => {
  return new Date(data.start_date) <= new Date(data.end_date)
}, {
  message: 'End date must be after start date',
  path: ['end_date'],
})

// User profile validation
export const userProfileSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  role: z.enum(['Athlete', 'Coach', 'Spectator', 'Official', 'Vendor', 'Media']),
  team: z.string().optional(),
  bio: z.string().max(500, 'Bio too long').optional(),
})

/**
 * Validate email format
 */
export function validateEmail(email: string): boolean {
  return emailSchema.safeParse(email).success
}

/**
 * Validate password strength
 */
export function validatePassword(password: string): {
  isValid: boolean
  errors: string[]
} {
  const errors: string[] = []

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters')
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter')
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter')
  }

  if (!/\d/.test(password)) {
    errors.push('Password must contain at least one number')
  }

  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push('Password must contain at least one special character')
  }

  return {
    isValid: errors.length === 0,
    errors,
  }
}

/**
 * Sanitize user input
 */
export function sanitizeInput(input: string): string {
  return input
    .trim()
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .replace(/[^\w\s\-.,!?@]/g, '') // Allow only safe characters
}

/**
 * Validate URL format
 */
export function validateUrl(url: string): boolean {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

/**
 * Validate phone number (US format)
 */
export function validatePhoneNumber(phone: string): boolean {
  const phoneRegex = /^(\+1[-.\s]?)?(\([0-9]{3}\)|[0-9]{3})[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}$/
  return phoneRegex.test(phone)
}

/**
 * Validate time format (HH:MM or HH:MM:SS)
 */
export function validateTime(time: string): boolean {
  const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/
  return timeRegex.test(time)
}
```

## Time Utilities (`utils/time.ts`)

**Purpose**: Time and date formatting and manipulation

```typescript
import { format, parseISO, isValid, differenceInMinutes, addMinutes, isSameDay } from 'date-fns'

/**
 * Format date for display
 */
export function formatDate(date: string | Date, formatStr: string = 'MMM d, yyyy'): string {
  try {
    const dateObj = typeof date === 'string' ? parseISO(date) : date
    if (!isValid(dateObj)) throw new Error('Invalid date')
    return format(dateObj, formatStr)
  } catch (error) {
    console.error('Date formatting error:', error)
    return 'Invalid Date'
  }
}

/**
 * Format time for display
 */
export function formatTime(date: string | Date, use24Hour: boolean = false): string {
  try {
    const dateObj = typeof date === 'string' ? parseISO(date) : date
    if (!isValid(dateObj)) throw new Error('Invalid date')
    return format(dateObj, use24Hour ? 'HH:mm' : 'h:mm a')
  } catch (error) {
    console.error('Time formatting error:', error)
    return 'Invalid Time'
  }
}

/**
 * Format date and time together
 */
export function formatDateTime(
  date: string | Date, 
  dateFormat: string = 'MMM d', 
  timeFormat: string = 'h:mm a'
): string {
  try {
    const dateObj = typeof date === 'string' ? parseISO(date) : date
    if (!isValid(dateObj)) throw new Error('Invalid date')
    
    const formattedDate = format(dateObj, dateFormat)
    const formattedTime = format(dateObj, timeFormat)
    
    return `${formattedDate} at ${formattedTime}`
  } catch (error) {
    console.error('DateTime formatting error:', error)
    return 'Invalid DateTime'
  }
}

/**
 * Get relative time (e.g., "in 2 hours", "3 minutes ago")
 */
export function getRelativeTime(date: string | Date): string {
  try {
    const dateObj = typeof date === 'string' ? parseISO(date) : date
    if (!isValid(dateObj)) throw new Error('Invalid date')
    
    const now = new Date()
    const diffMinutes = differenceInMinutes(dateObj, now)
    
    if (Math.abs(diffMinutes) < 1) {
      return 'now'
    } else if (diffMinutes > 0) {
      // Future
      if (diffMinutes < 60) {
        return `in ${diffMinutes} minute${diffMinutes === 1 ? '' : 's'}`
      } else if (diffMinutes < 1440) { // 24 hours
        const hours = Math.floor(diffMinutes / 60)
        return `in ${hours} hour${hours === 1 ? '' : 's'}`
      } else {
        const days = Math.floor(diffMinutes / 1440)
        return `in ${days} day${days === 1 ? '' : 's'}`
      }
    } else {
      // Past
      const absDiffMinutes = Math.abs(diffMinutes)
      if (absDiffMinutes < 60) {
        return `${absDiffMinutes} minute${absDiffMinutes === 1 ? '' : 's'} ago`
      } else if (absDiffMinutes < 1440) {
        const hours = Math.floor(absDiffMinutes / 60)
        return `${hours} hour${hours === 1 ? '' : 's'} ago`
      } else {
        const days = Math.floor(absDiffMinutes / 1440)
        return `${days} day${days === 1 ? '' : 's'} ago`
      }
    }
  } catch (error) {
    console.error('Relative time error:', error)
    return 'Unknown time'
  }
}

/**
 * Convert swimming time to milliseconds
 */
export function parseSwimTime(timeStr: string): number | null {
  try {
    const timeRegex = /^(?:(\d+):)?(\d{1,2})\.(\d{2})$/
    const match = timeStr.trim().match(timeRegex)
    
    if (!match) return null
    
    const minutes = parseInt(match[1] || '0', 10)
    const seconds = parseInt(match[2], 10)
    const centiseconds = parseInt(match[3], 10)
    
    return (minutes * 60 + seconds) * 1000 + centiseconds * 10
  } catch (error) {
    console.error('Swim time parsing error:', error)
    return null
  }
}

/**
 * Format swimming time from milliseconds
 */
export function formatSwimTime(milliseconds: number): string {
  try {
    const totalCentiseconds = Math.round(milliseconds / 10)
    const minutes = Math.floor(totalCentiseconds / 6000)
    const seconds = Math.floor((totalCentiseconds % 6000) / 100)
    const centiseconds = totalCentiseconds % 100
    
    if (minutes > 0) {
      return `${minutes}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`
    } else {
      return `${seconds}.${centiseconds.toString().padStart(2, '0')}`
    }
  } catch (error) {
    console.error('Swim time formatting error:', error)
    return 'Invalid time'
  }
}

/**
 * Check if event is happening today
 */
export function isToday(date: string | Date): boolean {
  try {
    const dateObj = typeof date === 'string' ? parseISO(date) : date
    return isSameDay(dateObj, new Date())
  } catch (error) {
    return false
  }
}

/**
 * Get event status based on current time
 */
export function getEventStatus(startTime: string | Date, endTime?: string | Date): 'upcoming' | 'ongoing' | 'completed' {
  try {
    const now = new Date()
    const start = typeof startTime === 'string' ? parseISO(startTime) : startTime
    
    if (now < start) return 'upcoming'
    
    if (endTime) {
      const end = typeof endTime === 'string' ? parseISO(endTime) : endTime
      if (now > end) return 'completed'
    }
    
    return 'ongoing'
  } catch (error) {
    console.error('Event status error:', error)
    return 'upcoming'
  }
}
```

## Custom Hooks

### useTheme Hook (`hooks/useTheme.ts`)

```typescript
import { useContext } from 'react'
import { ThemeContext } from '@/contexts/ThemeContext'

export function useTheme() {
  const context = useContext(ThemeContext)
  
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  
  return context
}

export function useThemeColor(
  props: { light?: string; dark?: string },
  colorName: keyof typeof Colors.light & keyof typeof Colors.dark
) {
  const { theme } = useTheme()
  const colorFromProps = props[theme]
  
  if (colorFromProps) {
    return colorFromProps
  } else {
    return Colors[theme][colorName]
  }
}
```

### useDebounce Hook (`hooks/useDebounce.ts`)

```typescript
import { useState, useEffect } from 'react'

export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])

  return debouncedValue
}

// Usage example:
// const debouncedSearchTerm = useDebounce(searchTerm, 300)
```

### useAsyncStorage Hook (`hooks/useAsyncStorage.ts`)

```typescript
import { useState, useEffect, useCallback } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

export function useAsyncStorage<T>(
  key: string,
  defaultValue: T
): [T, (value: T) => Promise<void>, boolean] {
  const [storedValue, setStoredValue] = useState<T>(defaultValue)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadStoredValue() {
      try {
        const item = await AsyncStorage.getItem(key)
        if (item !== null) {
          setStoredValue(JSON.parse(item))
        }
      } catch (error) {
        console.error(`Error loading ${key} from AsyncStorage:`, error)
      } finally {
        setLoading(false)
      }
    }

    loadStoredValue()
  }, [key])

  const setValue = useCallback(async (value: T) => {
    try {
      setStoredValue(value)
      await AsyncStorage.setItem(key, JSON.stringify(value))
    } catch (error) {
      console.error(`Error saving ${key} to AsyncStorage:`, error)
    }
  }, [key])

  return [storedValue, setValue, loading]
}
```

---

*These utilities provide robust, reusable functionality that powers the core features of the MeetCal application.*