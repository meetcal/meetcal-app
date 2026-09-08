# MeetCal 📅

- iOS: https://apps.apple.com/us/app/meetcal/id6741133286

- Android: https://play.google.com/store/apps/details?id=com.memohnsen.meetcal

A React Native application built with Expo for managing athletic schedules and meet calendars.

All live data goes through the MeetCal backend API (PostgreSQL via the Rust service in [meetcal-backend](https://github.com/meetcal/meetcal-backend)). Scraper ingestion also lives there — this repo is the mobile client only.

[![MeetCal Demo](https://youtube.com/shorts/4xoIoYox3C0?feature=share)](https://youtube.com/shorts/4xoIoYox3C0?feature=share)

## Features

- Schedule management for athletes and meets
- Athlete data management
- Self-hosted MeetCal API (`https://api.meetcal.app`) with offline-first app caching
- Cross-platform support (iOS, Android)

## Tech Stack

| Category | Technology |
|---|---|
| **Framework** | React Native 0.83, React 19 |
| **Platform** | Expo SDK ~55, Expo Router |
| **Language** | TypeScript |
| **Backend** | Self-hosted Rust API, PostgreSQL |
| **Authentication** | Clerk (JWT, secure token storage) |
| **Subscriptions** | RevenueCat (in-app purchases, subscription tiers) |
| **Analytics** | PostHog & Sentry (event tracking, remote config) |
| **Animations** | React Native Reanimated, Gesture Handler |
| **Notifications** | Expo Notifications (local + scheduled), OneSignal (remote push) |
| **Build & Deploy** | EAS Build, EAS Update (OTA) |

## Architecture

- **Offline-first data layer** — Multi-layer caching (in-memory, AsyncStorage) with API-backed sync when online and graceful degradation when offline
- **Context-based state management** — Custom providers and hooks for theme, subscriptions, saved sessions, and selected meet state
- **File-based routing** — Expo Router with feature-grouped folders, tab navigation, and modal screen stacks
- **Push notification system** — Scheduled reminders for weigh-ins and competition sessions with user-configurable timing; remote messaging via OneSignal
- **Home screen widgets** — Native iOS and Android widget support with app group data sharing

## Key Features

- Competition schedule browsing with timezone-aware session times
- Athlete start list lookup with real-time updates
- National and international rankings and records
- Save and track sessions across meets
- Device calendar integration for session reminders
- Dark mode support with system theme detection
- Subscription management (free, quarterly, lifetime tiers)

## Environment

Copy `.env.example` to `.env.local` and fill in values. The app never talks to Convex; `EXPO_PUBLIC_MEETCAL_API_URL` is the only data-backend URL.

## Native API Integration

The app leverages several native device capabilities through Expo modules:

- **expo-calendar** — Add sessions directly to the device calendar
- **expo-haptics** — Tactile feedback on tab interactions
- **expo-secure-store** — Encrypted credential and token storage
- **expo-file-system** — Local file operations for caching
- **expo-notifications** — Local and scheduled notification handling
- **expo-updates** — Over-the-air updates via EAS
- **expo-blur / expo-glass-effect** — Native blur and liquid glass UI effects
