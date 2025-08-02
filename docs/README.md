# MeetCal Documentation 📚

Welcome to the MeetCal documentation! This directory contains comprehensive documentation for the MeetCal React Native application - an athletic meet scheduling and management platform.

## Documentation Overview

### 📁 [File Structure](./file-structure.md)
Complete overview of the project's directory structure, file organization, and architectural patterns.

### 🏗️ [Architecture](./architecture.md)
High-level architecture overview, design patterns, and system components including navigation, state management, and data flow.

### 📊 [Data Management](./data-management.md)
Comprehensive guide to data sources, Supabase integration, offline storage, and data synchronization patterns.

### 📱 [Screens & Navigation](./screens-navigation.md)
Detailed documentation of all app screens, their purposes, navigation flows, and user journeys.

### 🧩 [Components](./components.md)
Documentation of reusable UI components, their props, usage examples, and styling patterns.

### ⚙️ [Functions & Utilities](./functions-utilities.md)
Reference for utility functions, helper methods, custom hooks, and shared business logic.

### 🔐 [Authentication & Security](./authentication.md)
Authentication flow, user management, role-based access, and security considerations.

### 📬 [Notifications & Push](./notifications.md)
Push notification setup, handling, and notification management features.

### 🛠️ [Development Guide](./development.md)
Setup instructions, development workflow, debugging tips, and contribution guidelines.

### 🚀 [Deployment](./deployment.md)
Build process, environment configuration, and deployment procedures for iOS and Android.

## Quick Start

For new developers joining the project:

1. Read the [File Structure](./file-structure.md) to understand the codebase layout
2. Review the [Architecture](./architecture.md) to understand system design
3. Follow the [Development Guide](./development.md) for local setup
4. Explore [Screens & Navigation](./screens-navigation.md) to understand user flows

## App Overview

MeetCal is a React Native application built with Expo that helps athletes, coaches, and meet organizers manage athletic schedules and competitions. Key features include:

- 📅 **Schedule Management**: View and manage athletic meet schedules
- 🏃‍♂️ **Athlete Tracking**: Track athlete performance and results
- 📊 **Real-time Data**: Live synchronization with Supabase backend
- 📱 **Cross-platform**: iOS and Android support
- 🔄 **Offline Support**: Local data caching and sync capabilities
- 🏆 **Results & Records**: Track performance records and rankings

## Tech Stack Summary

- **Framework**: Expo / React Native with TypeScript
- **Navigation**: Expo Router (file-based routing)
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Clerk
- **State Management**: React Context + AsyncStorage
- **Notifications**: Expo Notifications
- **Analytics**: PostHog
- **Subscriptions**: RevenueCat

## Contributing

When updating documentation:
1. Keep each file focused on its specific topic
2. Use clear headings and code examples
3. Update this README when adding new documentation files
4. Include relevant links between related documentation sections

---

*For technical support or questions about this documentation, please refer to the development team.*