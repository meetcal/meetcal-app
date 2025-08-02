# File Structure 📁

This document outlines the complete file structure of the MeetCal React Native application and explains the purpose of each directory and key files.

## Root Directory Overview

```
meetcal/
├── docs/                    # 📚 Documentation files
├── app/                     # 📱 Main application code (Expo Router)
├── components/              # 🧩 Reusable UI components
├── lib/                     # 📚 Core libraries and utilities
├── contexts/                # 🔄 React Context providers
├── hooks/                   # 🎣 Custom React hooks
├── utils/                   # 🛠️ Utility functions
├── config/                  # ⚙️ Configuration files
├── constants/               # 📋 App constants
├── types/                   # 📝 TypeScript type definitions
├── data/                    # 📊 Static data and types
├── assets/                  # 🖼️ Images, fonts, and static assets
├── supabase/                # 🗄️ Database configuration
├── android/                 # 🤖 Android-specific code
├── ios/                     # 🍎 iOS-specific code
└── Configuration files...   # ⚙️ Build and config files
```

## Detailed Structure

### `/app` - Main Application (Expo Router)

The `app` directory uses Expo Router's file-based routing system:

```
app/
├── _layout.tsx              # Root layout with providers
├── +not-found.tsx          # 404 error page
├── (tabs)/                 # Tab navigation screens
│   ├── _layout.tsx         # Tab layout configuration
│   ├── info.tsx            # Information/about screen
│   ├── saved.tsx           # Saved sessions screen
│   ├── schedule.tsx        # Main schedule screen
│   ├── sponsors.tsx        # Sponsors screen
│   └── start-list.tsx      # Event start lists
├── (screens)/              # Additional screens
│   ├── athlete-results.tsx # Athlete performance results
│   ├── create-session.tsx  # Create training session
│   ├── create-warmup.tsx   # Create warmup routine
│   ├── event-info.tsx      # Event information
│   ├── feedback.tsx        # User feedback
│   ├── profile.tsx         # User profile management
│   ├── rankings.tsx        # Performance rankings
│   ├── records.tsx         # Meet records
│   ├── schedule-details.tsx # Detailed schedule view
│   ├── warmup-details.tsx  # Warmup routine details
│   └── warmups.tsx         # Warmup routines list
├── (auth)/                 # Authentication screens
│   ├── _layout.tsx         # Auth layout
│   ├── sign-in.tsx         # Sign in screen
│   └── sign-up.tsx         # Registration screen
└── api/                    # API routes (if any)
```

### `/components` - Reusable UI Components

```
components/
├── ui/                     # Base UI components
├── Button.tsx              # Custom button component
├── Collapsible.tsx         # Collapsible content
├── ExternalLink.tsx        # External link wrapper
├── HapticTab.tsx           # Tab with haptic feedback
├── HelloWave.tsx           # Animated wave component
├── NotificationSettings.tsx # Notification preferences
├── PageIndicator.tsx       # Page indicator for carousels
├── ParallaxScrollView.tsx  # Parallax scroll container
├── ThemedText.tsx          # Themed text component
└── ThemedView.tsx          # Themed view component
```

### `/lib` - Core Libraries

```
lib/
├── database/               # Database-related utilities
├── authCache.ts           # Authentication caching
├── database.types.ts      # Database TypeScript types
├── notifications.ts       # Notification utilities
├── posthog.ts            # Analytics configuration
├── profile.ts            # User profile utilities
└── supabase.ts           # Supabase client configuration
```

### `/contexts` - State Management

```
contexts/
├── SavedSessionsContext.tsx    # Manages saved training sessions
├── SelectedMeetContext.tsx     # Current meet selection state
├── SubscriptionContext.tsx     # Subscription/payment state
└── ThemeContext.tsx           # App theme management
```

### `/hooks` - Custom React Hooks

```
hooks/
└── [Custom hooks for reusable logic]
```

### `/utils` - Utility Functions

```
utils/
└── [Helper functions and utilities]
```

### `/config` - Configuration

```
config/
└── [App configuration files]
```

### `/constants` - App Constants

```
constants/
└── [App-wide constants and enums]
```

### `/types` - TypeScript Types

```
types/
└── [Global TypeScript type definitions]
```

### `/data` - Static Data

```
data/
├── types/                 # Data type definitions
└── [Static data files]
```

### `/supabase` - Database Configuration

```
supabase/
├── config.toml           # Supabase configuration
└── .gitignore           # Git ignore for database files
```

## Key Configuration Files

### Root Level Files

- **`package.json`** - Dependencies and scripts
- **`app.json`** - Expo app configuration
- **`app.config.js`** - Dynamic Expo configuration
- **`tsconfig.json`** - TypeScript configuration
- **`babel.config.js`** - Babel transpiler configuration
- **`metro.config.js`** - Metro bundler configuration
- **`eas.json`** - Expo Application Services configuration
- **`.gitignore`** - Git ignore patterns
- **`README.md`** - Project documentation

## File Naming Conventions

### Screens (in `/app`)
- Use kebab-case: `athlete-results.tsx`
- Group related screens in folders with parentheses: `(tabs)`, `(screens)`, `(auth)`

### Components
- Use PascalCase: `ThemedText.tsx`
- Group by functionality in subdirectories

### Utilities and Libraries
- Use camelCase: `authCache.ts`
- Use descriptive names that indicate purpose

### Contexts
- End with "Context": `SelectedMeetContext.tsx`
- Use PascalCase

## Directory Organization Principles

1. **Feature-based grouping**: Related functionality is grouped together
2. **Layer separation**: UI components, business logic, and data access are separated
3. **Shared utilities**: Common functionality is extracted to shared directories
4. **Configuration centralization**: All configuration is in dedicated files/directories
5. **Type safety**: TypeScript types are organized and easily discoverable

## Navigation Structure

The app uses Expo Router's file-based routing:

- Files in `/app` become routes
- Folders with parentheses `()` don't affect the route
- `_layout.tsx` files define nested layouts
- Tab navigation is configured in `(tabs)/_layout.tsx`

## Best Practices

1. **Keep components small and focused** - Each component should have a single responsibility
2. **Use TypeScript strictly** - All files should be properly typed
3. **Follow the established patterns** - Match existing naming and organization conventions
4. **Separate concerns** - Keep UI, logic, and data access separate
5. **Document complex components** - Add JSDoc comments for complex components and functions

---

*This file structure supports scalability while maintaining clarity and organization for the MeetCal application.*