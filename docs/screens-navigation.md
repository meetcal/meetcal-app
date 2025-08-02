# Screens & Navigation 📱

This document provides detailed information about all screens in the MeetCal application, their purposes, navigation flows, and user experience considerations.

## Navigation Structure Overview

```
MeetCal App
├── Authentication Flow
│   ├── Sign In Screen
│   └── Sign Up Screen
├── Main Tab Navigation
│   ├── Schedule Tab
│   ├── Start List Tab
│   ├── Saved Sessions Tab
│   ├── Info Tab
│   └── Sponsors Tab
└── Modal Screens
    ├── Profile & Settings
    ├── Records & Rankings
    ├── Training & Warmups
    └── Event Details
```

## Authentication Flow

### Sign In Screen (`app/(auth)/sign-in.tsx`)

**Purpose**: User authentication entry point

**Features**:
- Email/password login
- Social authentication options
- "Forgot password" functionality
- Redirect to sign-up for new users

**Navigation**:
- **From**: App launch (if not authenticated)
- **To**: Main app (after successful authentication) or Sign Up

**User Roles**: All users (Athlete, Coach, Spectator, Official, Vendor, Media)

```typescript
// Key functionality
const handleSignIn = async (email: string, password: string) => {
  try {
    await signIn.create({ identifier: email, password })
    await setActive({ session: signIn.createdSessionId })
    router.replace('/(tabs)/schedule')
  } catch (error) {
    // Handle authentication errors
  }
}
```

### Sign Up Screen (`app/(auth)/sign-up.tsx`)

**Purpose**: New user registration

**Features**:
- Email/password registration
- Role selection (Athlete, Coach, etc.)
- Email verification flow
- Terms of service acceptance

**Navigation**:
- **From**: Sign In screen
- **To**: Profile setup or Main app

**Form Fields**:
- Name
- Email
- Password
- Role selection
- Optional: Team/organization affiliation

## Main Tab Navigation

### 1. Schedule Tab (`app/(tabs)/schedule.tsx`)

**Purpose**: Main screen showing meet schedules and events

**Features**:
- Current meet information
- Event schedule with real-time updates
- Event status indicators (upcoming, ongoing, completed)
- Quick access to event details
- Meet selection dropdown

**Key Components**:
- Meet header with venue information
- Scrollable event timeline
- Event cards with time, venue, and participants
- Refresh functionality for real-time updates

**Navigation To**:
- Event Info (`event-info`) - Tap on event
- Schedule Details (`schedule-details`) - Detailed view
- Meet selection modal

**Data Sources**:
- SelectedMeetContext for current meet
- Real-time Supabase subscriptions
- Cached event data

### 2. Start List Tab (`app/(tabs)/start-list.tsx`)

**Purpose**: Comprehensive event start lists and participant information

**Features**:
- Event-specific start lists
- Athlete search and filtering
- Heat/section organization
- Seed times and rankings
- Real-time updates during events

**Key Sections**:
- Event selection dropdown
- Search/filter controls
- Sortable athlete lists
- Heat assignments
- Performance predictions

**Navigation To**:
- Athlete Results (`athlete-results`) - Tap on athlete
- Event Info (`event-info`) - Event details
- Rankings (`rankings`) - Performance comparisons

### 3. Saved Sessions Tab (`app/(tabs)/saved.tsx`)

**Purpose**: Personal training sessions and saved data

**Features**:
- Saved training sessions
- Warmup routines
- Personal records
- Session history
- Offline access

**Categories**:
- **Training Sessions**: Saved workout templates
- **Warmups**: Pre-competition routines
- **Personal Records**: Best performances
- **Session History**: Past training data

**Navigation To**:
- Create Session (`create-session`) - New training session
- Create Warmup (`create-warmup`) - New warmup routine
- Warmup Details (`warmup-details`) - View/edit warmup
- Session playback and analysis

### 4. Info Tab (`app/(tabs)/info.tsx`)

**Purpose**: General information, settings, and app details

**Features**:
- App information and version
- User guide and help
- Settings and preferences
- About the app
- Contact information

**Sections**:
- **Getting Started**: User onboarding
- **Features Overview**: App capabilities
- **Support**: Help and contact
- **Settings**: App preferences
- **About**: Version and credits

**Navigation To**:
- Profile (`profile`) - User settings
- Feedback (`feedback`) - User feedback form
- Notification Settings
- Terms of Service / Privacy Policy

### 5. Sponsors Tab (`app/(tabs)/sponsors.tsx`)

**Purpose**: Sponsor information and promotional content

**Features**:
- Sponsor listings
- Promotional banners
- Sponsor details and links
- Special offers

**Layout**:
- Featured sponsors carousel
- Sponsor grid/list view
- Category filtering
- External link handling

## Modal Screens

### Profile & Settings

#### Profile Screen (`app/(screens)/profile.tsx`)

**Purpose**: User profile management and app settings

**Features**:
- Personal information editing
- Role and affiliation management
- Privacy settings
- Account preferences
- Subscription status

**Sections**:
- **Personal Info**: Name, email, photo
- **Athletic Info**: Events, PRs, team
- **Preferences**: Notifications, theme
- **Account**: Subscription, privacy
- **Support**: Help and feedback

**Navigation From**: Info tab, user avatar, settings menu

#### Notification Settings (`components/NotificationSettings.tsx`)

**Purpose**: Configure push notification preferences

**Features**:
- Event reminders
- Schedule updates
- Personal records notifications
- Team/coach updates
- System announcements

### Records & Performance

#### Records Screen (`app/(screens)/records.tsx`)

**Purpose**: Meet records and historical performance data

**Features**:
- Meet records by event
- Historical data comparison
- Record progression charts
- Filter by category/division
- Search functionality

**Data Organization**:
- Current meet records
- All-time records
- Age group records
- Team/school records

#### Rankings Screen (`app/(screens)/rankings.tsx`)

**Purpose**: Performance rankings and comparisons

**Features**:
- Event-specific rankings
- Seasonal/annual rankings
- Percentage-based comparisons
- Prediction algorithms
- Historical trends

#### WSO Records Screen (`app/(screens)/wso-records.tsx`)

**Purpose**: World Swimming Organization records

**Features**:
- Official world records
- Continental records
- National records
- Age group records
- Record comparisons

### Training & Warmups

#### Warmups Screen (`app/(screens)/warmups.tsx`)

**Purpose**: Warmup routine library and management

**Features**:
- Pre-built warmup templates
- Custom warmup creation
- Event-specific routines
- Timing and pacing guidance
- Favorite routines

**Categories**:
- Sprint events
- Distance events
- Stroke-specific
- Custom routines

#### Create Warmup Screen (`app/(screens)/create-warmup.tsx`)

**Purpose**: Create custom warmup routines

**Features**:
- Drag-and-drop routine builder
- Exercise library
- Timing configuration
- Notes and instructions
- Template saving

#### Warmup Details Screen (`app/(screens)/warmup-details.tsx`)

**Purpose**: View and execute warmup routines

**Features**:
- Step-by-step routine display
- Timer integration
- Progress tracking
- Modification options
- Sharing capabilities

#### Create Session Screen (`app/(screens)/create-session.tsx`)

**Purpose**: Create training session templates

**Features**:
- Workout builder
- Set/rep configuration
- Rest intervals
- Intensity zones
- Session goals

### Event Information

#### Event Info Screen (`app/(screens)/event-info.tsx`)

**Purpose**: Detailed event information

**Features**:
- Event details (time, venue, distance)
- Participant lists
- Qualifying standards
- Event history
- Live updates during competition

#### Schedule Details Screen (`app/(screens)/schedule-details.tsx`)

**Purpose**: Comprehensive schedule view

**Features**:
- Full meet schedule
- Multi-day event planning
- Session organization
- Venue maps
- Transportation info

#### Athlete Results Screen (`app/(screens)/athlete-results.tsx`)

**Purpose**: Individual athlete performance and results

**Features**:
- Recent results
- Personal records
- Performance trends
- Event history
- Comparison tools

### Administrative

#### Feedback Screen (`app/(screens)/feedback.tsx`)

**Purpose**: User feedback and support

**Features**:
- Bug reporting
- Feature requests
- General feedback
- Rating system
- Contact information

#### Paywall Screen (`app/(screens)/paywall.tsx`)

**Purpose**: Subscription and premium features

**Features**:
- Feature comparison
- Subscription plans
- Payment processing
- Free trial offers
- Restore purchases

#### Qualifying Standards Screens
- `new-qualifying-totals.tsx` - Add qualifying times
- `new-standards.tsx` - Manage time standards

## Navigation Patterns

### Tab Navigation
```typescript
// Main tab structure
<Tabs
  screenOptions={{
    tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
    headerShown: false,
  }}>
  <Tabs.Screen name="schedule" options={{ title: 'Schedule' }} />
  <Tabs.Screen name="start-list" options={{ title: 'Start List' }} />
  <Tabs.Screen name="saved" options={{ title: 'Saved' }} />
  <Tabs.Screen name="info" options={{ title: 'Info' }} />
  <Tabs.Screen name="sponsors" options={{ title: 'Sponsors' }} />
</Tabs>
```

### Modal Navigation
```typescript
// Modal screen presentation
router.push({
  pathname: '/(screens)/profile',
  params: { userId: user.id }
})

// Stack navigation with parameters
router.push({
  pathname: '/(screens)/athlete-results',
  params: { 
    athleteId: athlete.id,
    meetId: currentMeet.id 
  }
})
```

### Deep Linking
```typescript
// URL scheme handling
// meetcal://schedule/event/123
// meetcal://athlete/456/results
// meetcal://warmup/789

const linking = {
  prefixes: ['meetcal://'],
  config: {
    screens: {
      '(tabs)': {
        screens: {
          schedule: 'schedule',
          'start-list': 'start-list',
        }
      },
      '(screens)': {
        screens: {
          'athlete-results': 'athlete/:athleteId/results',
          'event-info': 'event/:eventId',
        }
      }
    }
  }
}
```

## User Experience Patterns

### Loading States
- Skeleton screens for data loading
- Pull-to-refresh functionality
- Progressive data loading
- Offline indicators

### Error Handling
- Graceful error messages
- Retry mechanisms
- Fallback to cached data
- Network status awareness

### Accessibility
- Screen reader support
- High contrast themes
- Large text options
- Voice control compatibility

### Performance Optimizations
- Lazy loading of screens
- Image optimization
- Data prefetching
- Memory management

## Screen State Management

### Context Integration
```typescript
// Example: Schedule screen using contexts
function ScheduleScreen() {
  const { selectedMeet, meetDetails, isLoading } = useSelectedMeet()
  const { theme } = useTheme()
  const { subscription } = useSubscription()

  // Screen logic using context data
}
```

### Navigation State
```typescript
// Track navigation state
const [navigationState, setNavigationState] = useState({
  currentTab: 'schedule',
  modalStack: [],
  history: []
})
```

---

*This navigation structure provides intuitive user flows while maintaining performance and accessibility across all device types.*