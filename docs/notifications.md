# Notifications & Push 📬

This document covers push notification setup, handling, notification management features, and the complete notification system implementation in the MeetCal application.

## Notification System Overview

MeetCal uses **Expo Notifications** for cross-platform push notification handling, with different notification types for various app events and user preferences.

```
Notification Architecture:
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Expo Push     │───►│   MeetCal App   │───►│     User        │
│   Notification  │    │   Notification  │    │   Experience    │
│     Service     │    │    Handler      │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
          │                        │                        │
          ▼                        ▼                        ▼
  Server-side Push        Local Notifications    Notification UI
  Event Triggers          Scheduled Reminders    In-app Badges
  Real-time Updates       Offline Notifications  User Preferences
```

## Notification Types

### 1. Event Reminders
- **Purpose**: Remind users of upcoming events
- **Trigger**: 30 minutes, 1 hour, or custom time before event
- **Content**: Event name, time, venue
- **Action**: Opens event details screen

### 2. Schedule Updates
- **Purpose**: Notify when event times change
- **Trigger**: Real-time when schedule is modified
- **Content**: What changed and new time
- **Action**: Opens updated schedule

### 3. Results Notifications
- **Purpose**: Notify of new results and records
- **Trigger**: When results are posted
- **Content**: Event name and notable results
- **Action**: Opens results screen

### 4. Team Updates
- **Purpose**: Coach/team specific communications
- **Trigger**: Coach sends team message
- **Content**: Message from coach
- **Action**: Opens team communication

### 5. System Announcements
- **Purpose**: App updates and important announcements
- **Trigger**: Manual from admin
- **Content**: Announcement text
- **Action**: Opens announcement or relevant screen

## Setup and Configuration

### Expo Notifications Setup

**Installation**: Already included in the project dependencies

**Configuration**: Located in `lib/notifications.ts`

```typescript
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import { Platform } from 'react-native'

// Global notification handler configuration
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const { data } = notification.request.content
    
    return {
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      priority: data?.priority || Notifications.AndroidNotificationPriority.DEFAULT,
    }
  },
})

export class NotificationManager {
  private static instance: NotificationManager
  private pushToken: string | null = null
  private listeners: { [key: string]: any } = {}

  static getInstance(): NotificationManager {
    if (!NotificationManager.instance) {
      NotificationManager.instance = new NotificationManager()
    }
    return NotificationManager.instance
  }

  /**
   * Initialize notification system
   */
  async initialize(): Promise<void> {
    if (!Device.isDevice) {
      console.warn('Push notifications only work on physical devices')
      return
    }

    try {
      // Register for push notifications
      this.pushToken = await this.registerForPushNotifications()
      
      // Setup notification channels (Android)
      if (Platform.OS === 'android') {
        await this.setupAndroidChannels()
      }

      // Setup notification categories (iOS)
      if (Platform.OS === 'ios') {
        await this.setupNotificationCategories()
      }

      // Setup notification listeners
      this.setupNotificationListeners()

      console.log('Notification system initialized successfully')
    } catch (error) {
      console.error('Failed to initialize notifications:', error)
    }
  }

  /**
   * Register for push notifications and get token
   */
  private async registerForPushNotifications(): Promise<string | null> {
    const { status: existingStatus } = await Notifications.getPermissionsAsync()
    let finalStatus = existingStatus

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync()
      finalStatus = status
    }

    if (finalStatus !== 'granted') {
      throw new Error('Permission not granted for push notifications')
    }

    const token = await Notifications.getExpoPushTokenAsync({
      projectId: process.env.EXPO_PUBLIC_PROJECT_ID,
    })

    return token.data
  }
}
```

### Android Notification Channels

```typescript
/**
 * Setup Android notification channels
 */
private async setupAndroidChannels(): Promise<void> {
  // Default channel
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Default',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#007AFF',
    sound: 'default',
  })

  // Event reminders channel
  await Notifications.setNotificationChannelAsync('event_reminders', {
    name: 'Event Reminders',
    description: 'Notifications for upcoming events',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#FF6B35',
    sound: 'event_reminder.wav',
  })

  // Schedule updates channel
  await Notifications.setNotificationChannelAsync('schedule_updates', {
    name: 'Schedule Updates',
    description: 'Notifications when schedules change',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 250],
    lightColor: '#28A745',
  })

  // Results channel
  await Notifications.setNotificationChannelAsync('results', {
    name: 'Results & Records',
    description: 'Notifications for new results',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: 'results_notification.wav',
  })

  // Team updates channel
  await Notifications.setNotificationChannelAsync('team_updates', {
    name: 'Team Updates',
    description: 'Messages from coaches and team notifications',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 100, 100, 100],
  })

  // System announcements channel
  await Notifications.setNotificationChannelAsync('system', {
    name: 'System Announcements',
    description: 'Important app updates and announcements',
    importance: Notifications.AndroidImportance.LOW,
  })
}
```

### iOS Notification Categories

```typescript
/**
 * Setup iOS notification categories with actions
 */
private async setupNotificationCategories(): Promise<void> {
  await Notifications.setNotificationCategoryAsync('event_reminder', [
    {
      identifier: 'view_event',
      buttonTitle: 'View Event',
      options: { opensAppToForeground: true },
    },
    {
      identifier: 'snooze',
      buttonTitle: 'Remind Later',
      options: { opensAppToForeground: false },
    },
  ])

  await Notifications.setNotificationCategoryAsync('schedule_update', [
    {
      identifier: 'view_schedule',
      buttonTitle: 'View Schedule',
      options: { opensAppToForeground: true },
    },
  ])

  await Notifications.setNotificationCategoryAsync('results', [
    {
      identifier: 'view_results',
      buttonTitle: 'View Results',
      options: { opensAppToForeground: true },
    },
  ])

  await Notifications.setNotificationCategoryAsync('team_message', [
    {
      identifier: 'reply',
      buttonTitle: 'Reply',
      options: { 
        opensAppToForeground: true,
        isDestructive: false,
      },
    },
    {
      identifier: 'mark_read',
      buttonTitle: 'Mark as Read',
      options: { opensAppToForeground: false },
    },
  ])
}
```

## Notification Handling

### Notification Listeners

```typescript
/**
 * Setup notification event listeners
 */
private setupNotificationListeners(): void {
  // Handle notification received while app is in foreground
  this.listeners.notificationReceived = Notifications.addNotificationReceivedListener(
    this.handleNotificationReceived.bind(this)
  )

  // Handle notification tapped/responded to
  this.listeners.notificationResponse = Notifications.addNotificationResponseReceivedListener(
    this.handleNotificationResponse.bind(this)
  )
}

/**
 * Handle notification received while app is running
 */
private handleNotificationReceived(notification: Notifications.Notification): void {
  const { request } = notification
  const { content, identifier } = request
  
  console.log('Notification received:', content.title, content.body)

  // Show in-app notification banner if needed
  if (content.data?.showInApp) {
    this.showInAppNotification(content)
  }

  // Update badge count
  this.updateBadgeCount(content.data?.type)
}

/**
 * Handle notification tap/action
 */
private handleNotificationResponse(response: Notifications.NotificationResponse): void {
  const { notification, actionIdentifier } = response
  const { content } = notification.request
  const { data } = content

  console.log('Notification tapped:', actionIdentifier, data)

  // Handle different action types
  switch (actionIdentifier) {
    case 'view_event':
      this.navigateToEvent(data.eventId)
      break
    
    case 'view_schedule':
      this.navigateToSchedule(data.meetId)
      break
    
    case 'view_results':
      this.navigateToResults(data.eventId)
      break
    
    case 'snooze':
      this.snoozeEventReminder(data.eventId, 15) // Snooze for 15 minutes
      break
    
    case 'reply':
      this.navigateToTeamChat(data.teamId)
      break
    
    case 'mark_read':
      this.markTeamMessageRead(data.messageId)
      break
    
    default:
      // Default tap action
      this.handleDefaultNotificationTap(data)
      break
  }

  // Track notification interaction
  this.trackNotificationInteraction(actionIdentifier, data)
}
```

### Navigation Handling

```typescript
/**
 * Navigate to specific screens based on notification data
 */
private navigateToEvent(eventId: string): void {
  const router = require('expo-router').router
  router.push({
    pathname: '/(screens)/event-info',
    params: { eventId }
  })
}

private navigateToSchedule(meetId?: string): void {
  const router = require('expo-router').router
  if (meetId) {
    // Navigate to specific meet schedule
    router.push({
      pathname: '/(screens)/schedule-details',
      params: { meetId }
    })
  } else {
    // Navigate to main schedule tab
    router.push('/(tabs)/schedule')
  }
}

private navigateToResults(eventId: string): void {
  const router = require('expo-router').router
  router.push({
    pathname: '/(screens)/athlete-results',
    params: { eventId }
  })
}

private handleDefaultNotificationTap(data: any): void {
  const router = require('expo-router').router
  
  // Navigate based on notification type
  switch (data?.type) {
    case 'event_reminder':
      if (data.eventId) {
        this.navigateToEvent(data.eventId)
      } else {
        router.push('/(tabs)/schedule')
      }
      break
    
    case 'schedule_update':
      this.navigateToSchedule(data.meetId)
      break
    
    case 'results':
      if (data.eventId) {
        this.navigateToResults(data.eventId)
      } else {
        router.push('/(tabs)/schedule')
      }
      break
    
    case 'team_update':
      router.push({
        pathname: '/(screens)/team-chat',
        params: { teamId: data.teamId }
      })
      break
    
    default:
      router.push('/(tabs)/schedule')
      break
  }
}
```

## Local Notifications

### Scheduling Event Reminders

```typescript
/**
 * Schedule event reminder notification
 */
async scheduleEventReminder(
  eventId: string,
  eventName: string,
  eventTime: Date,
  reminderMinutes: number = 30
): Promise<string> {
  const reminderTime = new Date(eventTime.getTime() - reminderMinutes * 60 * 1000)
  
  // Don't schedule if reminder time is in the past
  if (reminderTime <= new Date()) {
    throw new Error('Reminder time cannot be in the past')
  }

  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Event Reminder',
      body: `${eventName} starts in ${reminderMinutes} minutes`,
      data: {
        type: 'event_reminder',
        eventId,
        eventName,
        reminderMinutes,
      },
      categoryIdentifier: 'event_reminder',
      sound: 'event_reminder.wav',
    },
    trigger: {
      date: reminderTime,
    },
  })

  // Store notification ID for later cancellation
  await this.storeNotificationId(eventId, notificationId, 'event_reminder')
  
  return notificationId
}

/**
 * Schedule warmup reminder
 */
async scheduleWarmupReminder(
  warmupId: string,
  warmupName: string,
  eventTime: Date,
  warmupDuration: number = 45 // minutes
): Promise<string> {
  const warmupTime = new Date(eventTime.getTime() - warmupDuration * 60 * 1000)
  
  if (warmupTime <= new Date()) {
    throw new Error('Warmup time cannot be in the past')
  }

  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Warmup Reminder',
      body: `Time to start your warmup: ${warmupName}`,
      data: {
        type: 'warmup_reminder',
        warmupId,
        warmupName,
        eventTime: eventTime.toISOString(),
      },
      categoryIdentifier: 'warmup_reminder',
    },
    trigger: {
      date: warmupTime,
    },
  })

  await this.storeNotificationId(warmupId, notificationId, 'warmup_reminder')
  
  return notificationId
}
```

### Notification Management

```typescript
/**
 * Cancel scheduled notification
 */
async cancelNotification(notificationId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(notificationId)
}

/**
 * Cancel all notifications for an event
 */
async cancelEventNotifications(eventId: string): Promise<void> {
  const notificationIds = await this.getStoredNotificationIds(eventId)
  
  for (const notificationId of notificationIds) {
    await this.cancelNotification(notificationId)
  }
  
  await this.clearStoredNotificationIds(eventId)
}

/**
 * Update existing notification
 */
async updateEventReminder(
  eventId: string,
  newEventName: string,
  newEventTime: Date,
  reminderMinutes: number = 30
): Promise<void> {
  // Cancel existing notifications
  await this.cancelEventNotifications(eventId)
  
  // Schedule new notification
  await this.scheduleEventReminder(eventId, newEventName, newEventTime, reminderMinutes)
}

/**
 * Get all scheduled notifications
 */
async getScheduledNotifications(): Promise<Notifications.NotificationRequest[]> {
  return await Notifications.getAllScheduledNotificationsAsync()
}
```

## User Notification Preferences

### Notification Settings Component

The `NotificationSettings` component (documented in [Components](./components.md)) provides a comprehensive interface for users to manage their notification preferences.

### Preference Storage

```typescript
// utils/notificationPreferences.ts
export interface NotificationPreferences {
  eventReminders: boolean
  eventReminderTime: number // minutes before event
  scheduleUpdates: boolean
  resultsNotifications: boolean
  teamUpdates: boolean
  systemAnnouncements: boolean
  quietHours: {
    enabled: boolean
    start: string // "22:00"
    end: string   // "08:00"
  }
  soundEnabled: boolean
  vibrationEnabled: boolean
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  eventReminders: true,
  eventReminderTime: 30,
  scheduleUpdates: true,
  resultsNotifications: true,
  teamUpdates: true,
  systemAnnouncements: false,
  quietHours: {
    enabled: false,
    start: '22:00',
    end: '08:00',
  },
  soundEnabled: true,
  vibrationEnabled: true,
}

export class NotificationPreferencesManager {
  private static readonly STORAGE_KEY = '@notification_preferences'

  /**
   * Load user notification preferences
   */
  static async loadPreferences(): Promise<NotificationPreferences> {
    try {
      const stored = await AsyncStorage.getItem(this.STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        return { ...DEFAULT_PREFERENCES, ...parsed }
      }
    } catch (error) {
      console.error('Failed to load notification preferences:', error)
    }
    
    return DEFAULT_PREFERENCES
  }

  /**
   * Save user notification preferences
   */
  static async savePreferences(preferences: NotificationPreferences): Promise<void> {
    try {
      await AsyncStorage.setItem(this.STORAGE_KEY, JSON.stringify(preferences))
      
      // Apply preferences to notification system
      await this.applyPreferences(preferences)
    } catch (error) {
      console.error('Failed to save notification preferences:', error)
      throw error
    }
  }

  /**
   * Apply preferences to notification system
   */
  private static async applyPreferences(preferences: NotificationPreferences): Promise<void> {
    const notificationManager = NotificationManager.getInstance()
    
    // Update default reminder time
    notificationManager.setDefaultReminderTime(preferences.eventReminderTime)
    
    // Enable/disable quiet hours
    if (preferences.quietHours.enabled) {
      notificationManager.setQuietHours(
        preferences.quietHours.start,
        preferences.quietHours.end
      )
    } else {
      notificationManager.disableQuietHours()
    }
    
    // Update sound and vibration settings
    notificationManager.setSoundEnabled(preferences.soundEnabled)
    notificationManager.setVibrationEnabled(preferences.vibrationEnabled)
  }

  /**
   * Check if notifications should be shown based on preferences and quiet hours
   */
  static async shouldShowNotification(
    notificationType: string,
    scheduledTime?: Date
  ): Promise<boolean> {
    const preferences = await this.loadPreferences()
    
    // Check if notification type is enabled
    switch (notificationType) {
      case 'event_reminder':
        if (!preferences.eventReminders) return false
        break
      case 'schedule_update':
        if (!preferences.scheduleUpdates) return false
        break
      case 'results':
        if (!preferences.resultsNotifications) return false
        break
      case 'team_update':
        if (!preferences.teamUpdates) return false
        break
      case 'system':
        if (!preferences.systemAnnouncements) return false
        break
    }
    
    // Check quiet hours
    if (preferences.quietHours.enabled && scheduledTime) {
      const isInQuietHours = this.isInQuietHours(
        scheduledTime,
        preferences.quietHours.start,
        preferences.quietHours.end
      )
      
      if (isInQuietHours) {
        // For important notifications, schedule after quiet hours
        if (notificationType === 'event_reminder') {
          return false // Will be rescheduled
        }
        return false
      }
    }
    
    return true
  }

  /**
   * Check if time is within quiet hours
   */
  private static isInQuietHours(
    time: Date,
    startTime: string,
    endTime: string
  ): boolean {
    const timeStr = time.toTimeString().substr(0, 5) // "HH:MM"
    
    // Handle quiet hours spanning midnight
    if (startTime > endTime) {
      return timeStr >= startTime || timeStr <= endTime
    } else {
      return timeStr >= startTime && timeStr <= endTime
    }
  }
}
```

## Push Notification Server Integration

### Token Management

```typescript
/**
 * Send push token to server
 */
async sendTokenToServer(token: string, userId: string): Promise<void> {
  try {
    const response = await fetch(`${API_BASE_URL}/notifications/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${await getAuthToken()}`,
      },
      body: JSON.stringify({
        userId,
        pushToken: token,
        platform: Platform.OS,
        appVersion: Constants.expoConfig?.version,
      }),
    })

    if (!response.ok) {
      throw new Error('Failed to register push token')
    }

    console.log('Push token registered successfully')
  } catch (error) {
    console.error('Failed to send token to server:', error)
    throw error
  }
}

/**
 * Remove token from server (on logout)
 */
async removeTokenFromServer(token: string): Promise<void> {
  try {
    const response = await fetch(`${API_BASE_URL}/notifications/unregister`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${await getAuthToken()}`,
      },
      body: JSON.stringify({
        pushToken: token,
      }),
    })

    if (!response.ok) {
      throw new Error('Failed to unregister push token')
    }

    console.log('Push token removed successfully')
  } catch (error) {
    console.error('Failed to remove token from server:', error)
  }
}
```

### Server-Side Push Notifications

Example server implementation for sending push notifications:

```javascript
// server/notifications.js (Node.js example)
const { Expo } = require('expo-server-sdk')

const expo = new Expo()

async function sendPushNotification(tokens, message) {
  const messages = []
  
  for (const pushToken of tokens) {
    if (!Expo.isExpoPushToken(pushToken)) {
      console.error(`Push token ${pushToken} is not a valid Expo push token`)
      continue
    }

    messages.push({
      to: pushToken,
      sound: message.sound || 'default',
      title: message.title,
      body: message.body,
      data: message.data || {},
      categoryId: message.categoryId,
      priority: message.priority || 'default',
      ttl: message.ttl || 3600, // 1 hour
    })
  }

  const chunks = expo.chunkPushNotifications(messages)
  const tickets = []

  for (const chunk of chunks) {
    try {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk)
      tickets.push(...ticketChunk)
    } catch (error) {
      console.error('Error sending push notifications:', error)
    }
  }

  return tickets
}

// Example usage
async function notifyEventReminder(eventId, eventName, eventTime) {
  const tokens = await getUserPushTokensForEvent(eventId)
  
  await sendPushNotification(tokens, {
    title: 'Event Reminder',
    body: `${eventName} starts in 30 minutes`,
    data: {
      type: 'event_reminder',
      eventId,
      eventName,
      eventTime,
    },
    categoryId: 'event_reminder',
    sound: 'event_reminder.wav',
  })
}
```

## Testing Notifications

### Testing Tools

```typescript
// utils/notificationTesting.ts
export class NotificationTester {
  /**
   * Send test notification
   */
  static async sendTestNotification(type: string): Promise<void> {
    const testNotifications = {
      event_reminder: {
        title: 'Test Event Reminder',
        body: 'Your event starts in 30 minutes',
        data: { type: 'event_reminder', eventId: 'test-123' },
      },
      schedule_update: {
        title: 'Schedule Updated',
        body: 'Event time has been changed',
        data: { type: 'schedule_update', meetId: 'test-meet' },
      },
      results: {
        title: 'New Results Available',
        body: 'Results have been posted for your event',
        data: { type: 'results', eventId: 'test-456' },
      },
    }

    const notification = testNotifications[type]
    if (!notification) {
      throw new Error(`Unknown test notification type: ${type}`)
    }

    await Notifications.scheduleNotificationAsync({
      content: notification,
      trigger: { seconds: 2 },
    })
  }

  /**
   * Test notification permissions
   */
  static async testPermissions(): Promise<void> {
    const { status } = await Notifications.getPermissionsAsync()
    console.log('Current notification permission:', status)

    if (status !== 'granted') {
      const { status: newStatus } = await Notifications.requestPermissionsAsync()
      console.log('New notification permission:', newStatus)
    }
  }

  /**
   * List all scheduled notifications
   */
  static async listScheduledNotifications(): Promise<void> {
    const notifications = await Notifications.getAllScheduledNotificationsAsync()
    console.log('Scheduled notifications:', notifications.length)
    
    notifications.forEach((notification, index) => {
      console.log(`${index + 1}:`, {
        id: notification.identifier,
        title: notification.content.title,
        trigger: notification.trigger,
      })
    })
  }
}
```

### Development Testing

```typescript
// Enable notification testing in development
if (__DEV__) {
  // Add test buttons to development menu
  const DevMenu = require('react-native-dev-menu')
  
  DevMenu.addItem('Test Event Reminder', () => {
    NotificationTester.sendTestNotification('event_reminder')
  })
  
  DevMenu.addItem('Test Schedule Update', () => {
    NotificationTester.sendTestNotification('schedule_update')
  })
  
  DevMenu.addItem('List Scheduled', () => {
    NotificationTester.listScheduledNotifications()
  })
}
```

## Analytics and Monitoring

### Notification Analytics

```typescript
/**
 * Track notification interactions
 */
private trackNotificationInteraction(actionIdentifier: string, data: any): void {
  const { posthog } = require('@/lib/posthog')
  
  posthog?.capture('notification_interaction', {
    action: actionIdentifier,
    notification_type: data?.type,
    event_id: data?.eventId,
    meet_id: data?.meetId,
    platform: Platform.OS,
  })
}

/**
 * Track notification delivery
 */
static async trackNotificationDelivery(notificationId: string, type: string): Promise<void> {
  const { posthog } = require('@/lib/posthog')
  
  posthog?.capture('notification_sent', {
    notification_id: notificationId,
    notification_type: type,
    platform: Platform.OS,
  })
}

/**
 * Track notification settings changes
 */
static trackPreferencesChange(oldPrefs: any, newPrefs: any): void {
  const { posthog } = require('@/lib/posthog')
  
  const changes = {}
  Object.keys(newPrefs).forEach(key => {
    if (oldPrefs[key] !== newPrefs[key]) {
      changes[key] = { from: oldPrefs[key], to: newPrefs[key] }
    }
  })
  
  if (Object.keys(changes).length > 0) {
    posthog?.capture('notification_preferences_changed', { changes })
  }
}
```

---

*This notification system provides comprehensive, user-friendly push notification management with robust customization options and reliable delivery.*