# MeetCal 📅

A React Native application built with Expo for managing athletic schedules and meet calendars.

[![MeetCal Demo](https://youtube.com/shorts/4xoIoYox3C0?feature=share)](https://youtube.com/shorts/4xoIoYox3C0?feature=share)

## Features

- Schedule management for athletes and meets
- Athlete data management
- Real-time data synchronization with Supabase
- Cross-platform support (iOS, Android)

## Tech Stack

| Category | Technology |
|---|---|
| **Framework** | React Native 0.81, React 19 |
| **Platform** | Expo SDK, Expo Router |
| **Language** | TypeScript |
| **Backend** | Supabase (PostgreSQL) |
| **Authentication** | Clerk (JWT, secure token storage) |
| **Subscriptions** | RevenueCat (in-app purchases, subscription tiers) |
| **Analytics** | PostHog & Sentry (event tracking, remote config) |
| **Animations** | React Native Reanimated, Gesture Handler |
| **Notifications** | Expo Notifications (scheduled local + remote push) |
| **Build & Deploy** | EAS Build, EAS Update (OTA) |

## Architecture

- **Offline-first data layer** — Multi-layer caching (in-memory, AsyncStorage, Supabase) with network-aware sync and graceful degradation when offline
- **Context-based state management** — Custom providers and hooks for theme, subscriptions, saved sessions, and selected meet state
- **File-based routing** — Expo Router with feature-grouped folders, tab navigation, and modal screen stacks
- **Push notification system** — Scheduled reminders for weigh-ins and competition sessions with user-configurable timing
- **Home screen widgets** — Native iOS and Android widget support with app group data sharing

## Key Features

- Competition schedule browsing with timezone-aware session times
- Athlete start list lookup with real-time updates
- National and international rankings and records
- Save and track sessions across meets
- Device calendar integration for session reminders
- Dark mode support with system theme detection
- Subscription management (free, quarterly, lifetime tiers)

## Native API Integration

The app leverages several native device capabilities through Expo modules:

- **expo-calendar** — Add sessions directly to the device calendar
- **expo-haptics** — Tactile feedback on tab interactions
- **expo-secure-store** — Encrypted credential and token storage
- **expo-file-system** — Local file operations for caching
- **expo-notifications** — Local and remote push notification scheduling
- **expo-updates** — Over-the-air updates via EAS
- **expo-blur / expo-glass-effect** — Native blur and liquid glass UI effects