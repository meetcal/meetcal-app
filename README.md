# MeetCal 📅

- iOS: https://apps.apple.com/us/app/meetcal/id6741133286

- Android: https://play.google.com/store/apps/details?id=com.memohnsen.meetcal

A React Native application built with Expo for managing athletic schedules and meet calendars.

All live data comes from Convex (`convex/` in this repo): the app's queries, the materialized views that make them fast, and the scheduled scrapers that keep the data current (`convex/crons.ts`, `convex/cronJobs.ts`).

[![MeetCal Demo](https://youtube.com/shorts/4xoIoYox3C0?feature=share)](https://youtube.com/shorts/4xoIoYox3C0?feature=share)

## Features

- Schedule management for athletes and meets
- Athlete data management
- Convex backend with offline-first app caching
- Cross-platform support (iOS, Android)

## Tech Stack

| Category | Technology |
|---|---|
| **Framework** | React Native 0.88, React 19 |
| **Platform** | Expo SDK 58 (preview), Expo Router |
| **Language** | TypeScript |
| **Backend** | Convex (queries, materialized views, scheduled scrapers) |
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

Copy `.env.example` to `.env.local` and fill in values. `EXPO_PUBLIC_CONVEX_URL` is the data backend:

- **Local development:** run `npx convex dev`; it writes the dev deployment's URL (`CONVEX_DEPLOYMENT`, `EXPO_PUBLIC_CONVEX_URL`) into `.env.local`.
- **EAS builds:** `eas.json` sets it per profile: the dev deployment for `development*`, production for `preview` and `production*`.

Convex deployment variables (set with `npx convex env set … --prod`): `ALERT_EMAIL` (scheduled-job failure emails), `URLWATCH_EMAIL` (usamasters.net page changes), `ONESIGNAL_APP_ID` and `ONESIGNAL_REST_API_KEY` (how those emails are sent), and the Clerk variables for signed-in calls.

## Native API Integration

The app leverages several native device capabilities through Expo modules:

- **expo-calendar** — Add sessions directly to the device calendar
- **expo-haptics** — Tactile feedback on tab interactions
- **expo-secure-store** — Encrypted credential and token storage
- **expo-file-system** — Local file operations for caching
- **expo-notifications** — Local and scheduled notification handling
- **expo-updates** — Over-the-air updates via EAS
- **expo-blur / expo-glass-effect** — Native blur and liquid glass UI effects

## iPhone Duo

The app targets the iOS 27.1 SDK so it runs in full compatibility mode on iPhone Duo's
inner display. Building it requires Xcode 27.1 locally — see [docs/iphone-duo.md](docs/iphone-duo.md).
