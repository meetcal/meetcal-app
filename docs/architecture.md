# Architecture 🏗️

This document provides an in-depth overview of the MeetCal application architecture, design patterns, and system components.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Presentation Layer                       │
├─────────────────────────────────────────────────────────────────┤
│  React Native Screens & Components (app/, components/)          │
│  • Tab Navigation (Schedule, Saved, Info, Sponsors, Start List) │
│  • Modal Screens (Profile, Records, Rankings, etc.)             │
│  • Authentication Screens (Sign In/Up)                          │
└─────────────────────────────────────────────────────────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────┐
│                      State Management Layer                     │
├─────────────────────────────────────────────────────────────────┤
│  React Context Providers (contexts/)                            │
│  • SelectedMeetContext - Current meet and sync state           │
│  • SubscriptionContext - Payment and subscription state        │
│  • ThemeContext - UI theme management                          │
│  • SavedSessionsContext - Cached training sessions             │
└─────────────────────────────────────────────────────────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────┐
│                       Business Logic Layer                      │
├─────────────────────────────────────────────────────────────────┤
│  Services & Utilities (lib/, utils/, hooks/)                   │
│  • Database Managers - Data CRUD operations                    │
│  • Sync Manager - Offline/online data synchronization         │
│  • Notification Service - Push notification handling          │
│  • Authentication Cache - User session management             │
└─────────────────────────────────────────────────────────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────┐
│                        Data Access Layer                        │
├─────────────────────────────────────────────────────────────────┤
│  External Services & Storage                                    │
│  • Supabase - Primary database and real-time subscriptions    │
│  • AsyncStorage - Local data persistence                       │
│  • Clerk - Authentication and user management                  │
│  • RevenueCat - Subscription and payment processing           │
│  • PostHog - Analytics and user tracking                      │
└─────────────────────────────────────────────────────────────────┘
```

## Design Patterns

### 1. Provider Pattern
The app uses React Context extensively for state management:

```typescript
// Root layout wraps app with providers
<ClerkProvider>
  <PostHogProvider>
    <SubscriptionProvider>
      <SelectedMeetProvider>
        <SavedSessionsProvider>
          <CustomThemeProvider>
            {/* App content */}
          </CustomThemeProvider>
        </SavedSessionsProvider>
      </SelectedMeetProvider>
    </SubscriptionProvider>
  </PostHogProvider>
</ClerkProvider>
```

### 2. Repository Pattern
Data access is abstracted through manager classes:

```typescript
// Example: Meet data access
class MeetManager {
  static async fetchMeets(): Promise<Meet[]>
  static async fetchMeetByName(name: string): Promise<Meet>
  static async updateMeetAccess(meetId: string): Promise<void>
}
```

### 3. Observer Pattern
Real-time updates using Supabase subscriptions:

```typescript
// Real-time data synchronization
supabase
  .channel('meets')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'meets' }, 
    (payload) => handleMeetUpdate(payload)
  )
  .subscribe()
```

### 4. Singleton Pattern
Shared service instances:

```typescript
// Supabase client singleton
export const supabase = createClient(url, key)

// PostHog analytics singleton
export const posthog = new PostHog(apiKey, options)
```

## Navigation Architecture

### Expo Router Structure
The app uses file-based routing with a hierarchical structure:

```
app/
├── _layout.tsx              # Root layout with providers
├── (tabs)/                  # Main tab navigation
│   ├── _layout.tsx         # Tab configuration
│   └── [tab-screens]       # Individual tab screens
├── (screens)/              # Modal/stack screens
├── (auth)/                 # Authentication flow
└── +not-found.tsx          # Error handling
```

### Navigation Flow

1. **Authentication Check**: Root layout redirects based on auth state
2. **Tab Navigation**: Main app uses bottom tabs for primary features
3. **Modal Screens**: Secondary screens present as modals or stack navigation
4. **Deep Linking**: Expo Router handles URL-based navigation

## State Management Architecture

### Context Hierarchy

```typescript
// State flow from top to bottom
ClerkProvider                 // User authentication
├── SubscriptionProvider      // Payment status
├── SelectedMeetProvider      // Current meet selection
├── SavedSessionsProvider     // Cached training data
└── ThemeProvider            // UI theme state
```

### State Synchronization

```typescript
// Example: SelectedMeetContext flow
1. User selects meet → setSelectedMeet()
2. Context validates and caches selection
3. SyncManager fetches fresh data
4. Local storage updated
5. UI components re-render with new data
```

## Data Flow Architecture

### Offline-First Approach

```
User Action → Context Update → Local Storage → Background Sync → Supabase
     ↑                                                              ↓
UI Update ← Context Notification ← Sync Complete ← Real-time Updates
```

### Data Layers

1. **UI Layer**: React components consume context state
2. **Context Layer**: Manages local state and coordinates updates
3. **Storage Layer**: AsyncStorage for persistence
4. **Sync Layer**: Manages online/offline data synchronization
5. **Backend Layer**: Supabase for authoritative data

## Component Architecture

### Component Hierarchy

```
Screen Components (app/)
├── Layout Components (_layout.tsx files)
├── Page Components (individual screens)
└── Shared Components (components/)
    ├── UI Components (buttons, inputs, etc.)
    ├── Business Components (NotificationSettings, etc.)
    └── Utility Components (ThemedText, ParallaxScrollView)
```

### Component Patterns

1. **Themed Components**: Components that adapt to app theme
2. **Compound Components**: Complex components with multiple parts
3. **Higher-Order Components**: Wrappers for common functionality
4. **Render Props**: Flexible component composition

## Security Architecture

### Authentication Flow

```
1. User opens app
2. Clerk checks authentication status
3. If authenticated: → Main app
4. If not authenticated: → Auth screens
5. After successful auth: → Profile setup → Main app
```

### Data Security

- **Authentication**: Clerk handles secure user authentication
- **Authorization**: Role-based access control through user profiles
- **API Security**: Supabase Row Level Security (RLS) policies
- **Local Storage**: Sensitive data encrypted in secure storage

## Performance Architecture

### Optimization Strategies

1. **Lazy Loading**: Screens and components loaded on demand
2. **Data Caching**: AsyncStorage for offline capability
3. **Image Optimization**: Expo image caching and optimization
4. **Bundle Splitting**: Dynamic imports for large features
5. **Memory Management**: Proper cleanup of subscriptions and listeners

### Sync Strategy

```typescript
// Background sync with conflict resolution
class SyncManager {
  async syncData(meetId: string) {
    const localData = await getLocalData(meetId)
    const remoteData = await fetchRemoteData(meetId)
    
    const merged = await resolveConflicts(localData, remoteData)
    await updateLocalStorage(merged)
    await updateRemoteData(merged)
  }
}
```

## Error Handling Architecture

### Error Boundaries

```typescript
// Global error boundary
<ErrorBoundary fallback={<ErrorScreen />}>
  <App />
</ErrorBoundary>
```

### Error Types

1. **Network Errors**: Handled by sync manager with retry logic
2. **Authentication Errors**: Redirect to sign-in flow
3. **Data Errors**: Graceful degradation with cached data
4. **UI Errors**: Error boundaries prevent app crashes

## Monitoring & Analytics

### Analytics Pipeline

```
User Interaction → PostHog Capture → Analytics Dashboard
                ↓
            Crash Reporting → Error Tracking → Developer Alerts
```

### Tracked Events

- Screen views and navigation
- User actions (button clicks, form submissions)
- Performance metrics
- Error occurrences
- Subscription events

## Deployment Architecture

### Build Pipeline

```
Code Changes → GitHub → EAS Build → App Store/Play Store
             ↓
        Development → Staging → Production
```

### Environment Management

- **Development**: Local Expo dev server
- **Staging**: EAS Preview builds
- **Production**: App store distributions

## Scalability Considerations

### Horizontal Scaling

- **Supabase**: Auto-scaling database
- **CDN**: Asset delivery optimization
- **Caching**: Multi-layer caching strategy

### Code Scalability

- **Modular Architecture**: Feature-based organization
- **Type Safety**: Comprehensive TypeScript usage
- **Testing**: Unit and integration tests
- **Documentation**: Comprehensive code documentation

---

*This architecture supports the current needs while providing flexibility for future growth and feature additions.*