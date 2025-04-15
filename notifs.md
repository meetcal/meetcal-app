# Notification Implementation Plan

## Overview
This document outlines the steps to implement notifications for calendar sessions using Expo Notifications, sending reminders 1 hour before the session start time.

## Step 1: Set Up Expo Notifications ✅
- [x] Install required dependencies:
  ```bash
  expo install expo-notifications
  expo install expo-device
  ```
- [x] Configure app.json for notifications:
  ```json
  {
    "expo": {
      "plugins": [
        [
          "expo-notifications",
          {
            "icon": "./assets/notification-icon.png",
            "color": "#ffffff",
            "sounds": ["./assets/notification-sound.wav"]
          }
        ]
      ]
    }
  }
  ```
- [x] Set up notification permissions handling
- [x] Create notification service utilities

## Step 2: Database Modifications ✅
- [x] Add notification preferences table to Supabase with Clerk user ID integration
  - Fields implemented:
    - user_id (TEXT, references Clerk user ID)
    - notification_enabled (boolean)
    - notification_time_before (integer, default: 60 minutes)
    - expo_push_token (string, nullable)
- [x] Create API endpoints for managing notification preferences:
  - getNotificationPreferences
  - updateNotificationPreferences
  - updateExpoPushToken
  - toggleNotifications
  - updateNotificationTimeBefore

## Step 3: Notification Scheduling System (In Progress)
- [x] Create notification scheduler service with core functionality:
  - Query sessions from Supabase
  - Filter sessions within notification window
  - Basic notification scheduling structure
- [x] Handle edge cases:
  - Multiple sessions in the same time window:
    - Group sessions by hour
    - Create combined notifications for overlapping sessions
    - Show platform information for multiple sessions
  - Cancelled sessions:
    - Added is_cancelled field to session tracking
    - Filter out cancelled sessions before scheduling
    - Reschedule notifications when sessions are cancelled
  - Updated session times:
    - Reschedule all notifications when any session is updated
    - Maintain proper ordering of notifications
  - Timezone considerations:
    - Use ISO string format for consistent time handling
    - Store notification times in UTC
- [ ] Resolve Expo Notifications TypeScript issues:
  - Properly type the notification trigger
  - Ensure compatibility with Expo's scheduling system
- [ ] Implement robust error handling:
  - Handle failed notification scheduling
  - Retry logic for failed attempts
  - Logging for debugging

## Step 4: User Interface (In Progress)
- [x] Add notification settings to user profile:
  - Created NotificationSettings component
  - Added toggle for enabling/disabling notifications
  - Added description of notification timing
  - Integrated with profile page layout
- [x] Implement Expo notification permission request flow:
  - Added permission request on toggle
  - Added fallback to device settings
  - Handle both iOS and Android platforms

## Step 5: Testing
- [ ] Test notification delivery in development
- [ ] Test notification scheduling
- [ ] Test notification cancellation
- [ ] Test with different time zones
- [ ] Test with multiple sessions
- [ ] Test with app in background/closed state
- [ ] Test on both iOS and Android

## Step 6: Deployment
- [ ] Update app.json for production
- [ ] Deploy database changes
- [ ] Test in production environment
- [ ] Monitor notification delivery rates

## Technical Considerations
- Handle timezone differences
- Implement proper error handling
- Ensure battery efficiency
- Consider offline scenarios
- Implement proper cleanup of old notifications
- Handle Expo push token updates

## Future Enhancements
- Custom notification sounds
- Different notification types (e.g., 30 minutes before, 15 minutes before)
- Notification grouping
- Rich notifications with session details
- Notification actions (e.g., "View Details", "Snooze")
- Background fetch for updating notifications
