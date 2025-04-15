# Notification Implementation Plan

## Overview
This document outlines the steps to implement notifications for calendar sessions using Expo Notifications, sending reminders 1 hour before the session start time.

## Step 1: Set Up Expo Notifications
- [ ] Install required dependencies:
  ```bash
  expo install expo-notifications
  expo install expo-device
  ```
- [ ] Configure app.json for notifications:
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
- [ ] Set up notification permissions handling
- [ ] Create notification service utilities

## Step 2: Database Modifications
- [ ] Add notification preferences table to Supabase
  - Fields needed:
    - user_id (foreign key)
    - notification_enabled (boolean)
    - notification_time_before (integer, default: 60 minutes)
    - expo_push_token (string, nullable)
- [ ] Create API endpoints for managing notification preferences

## Step 3: Notification Scheduling System
- [ ] Implement Expo notification scheduling:
  ```typescript
  // Example notification scheduling
  await Notifications.scheduleNotificationAsync({
    content: {
      title: "Upcoming Session",
      body: "Your session starts in 1 hour",
      data: { sessionId: "123" },
    },
    trigger: {
      hour: sessionStartHour,
      minute: sessionStartMinute,
      repeats: false,
    },
  });
  ```
- [ ] Create background task to:
  - Query sessions from Supabase
  - Filter sessions that are starting within the notification window
  - Schedule notifications for eligible sessions
- [ ] Handle edge cases:
  - Multiple sessions in the same time window
  - Cancelled sessions
  - Updated session times

## Step 4: User Interface
- [ ] Add notification settings to user profile
- [ ] Create UI components for:
  - Toggle notifications on/off
  - Set notification time preference
  - View scheduled notifications
- [ ] Implement Expo notification permission request flow:
  ```typescript
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  ```

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
- Implement proper error handling for notification scheduling

## Future Enhancements
- Custom notification sounds
- Different notification types (e.g., 30 minutes before, 15 minutes before)
- Notification grouping
- Rich notifications with session details
- Notification actions (e.g., "View Details", "Snooze")
- Background fetch for updating notifications
