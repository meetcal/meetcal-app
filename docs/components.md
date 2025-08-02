# Components 🧩

This document provides comprehensive documentation for all reusable UI components in the MeetCal application, including their props, usage examples, and styling patterns.

## Component Architecture

```
components/
├── UI Components           # Basic building blocks
│   ├── ThemedText         # Styled text component
│   ├── ThemedView         # Themed container
│   ├── Button             # Custom button
│   └── ui/               # Additional UI components
├── Navigation Components   # Navigation-specific
│   ├── HapticTab         # Tab with haptic feedback
│   └── PageIndicator     # Page indicators
├── Interaction Components  # User interaction
│   ├── Collapsible       # Expandable content
│   ├── ExternalLink      # External link handler
│   └── HelloWave         # Animated greeting
├── Layout Components      # Layout and structure
│   └── ParallaxScrollView # Parallax scroll container
└── Business Components    # App-specific logic
    └── NotificationSettings # Notification preferences
```

## UI Components

### ThemedText

**Purpose**: Text component that adapts to the app's theme

**Location**: `components/ThemedText.tsx`

**Props**:
```typescript
interface ThemedTextProps {
  lightColor?: string        // Text color for light theme
  darkColor?: string         // Text color for dark theme
  type?: 'default' | 'title' | 'defaultSemiBold' | 'subtitle' | 'link'
  style?: TextStyle         // Additional styles
  children: React.ReactNode // Text content
}
```

**Usage**:
```typescript
// Basic usage
<ThemedText>Hello World</ThemedText>

// With type
<ThemedText type="title">Page Title</ThemedText>

// With custom colors
<ThemedText 
  lightColor="#000" 
  darkColor="#fff"
  type="subtitle"
>
  Custom themed text
</ThemedText>

// With additional styles
<ThemedText 
  style={{ fontSize: 18, fontWeight: 'bold' }}
>
  Styled text
</ThemedText>
```

**Theme Integration**:
```typescript
export function ThemedText({
  style,
  lightColor,
  darkColor,
  type = 'default',
  ...rest
}: ThemedTextProps) {
  const color = useThemeColor({ light: lightColor, dark: darkColor }, 'text')

  return (
    <Text
      style={[
        { color },
        type === 'default' ? styles.default : undefined,
        type === 'title' ? styles.title : undefined,
        type === 'defaultSemiBold' ? styles.defaultSemiBold : undefined,
        type === 'subtitle' ? styles.subtitle : undefined,
        type === 'link' ? styles.link : undefined,
        style,
      ]}
      {...rest}
    />
  )
}
```

### ThemedView

**Purpose**: Container component with theme-aware background

**Location**: `components/ThemedView.tsx`

**Props**:
```typescript
interface ThemedViewProps extends ViewProps {
  lightColor?: string  // Background color for light theme
  darkColor?: string   // Background color for dark theme
}
```

**Usage**:
```typescript
// Basic container
<ThemedView>
  <ThemedText>Content inside themed container</ThemedText>
</ThemedView>

// With custom background colors
<ThemedView 
  lightColor="#f0f0f0" 
  darkColor="#1a1a1a"
>
  <ThemedText>Custom themed container</ThemedText>
</ThemedView>
```

### Button

**Purpose**: Custom button component with consistent styling

**Location**: `components/Button.tsx`

**Props**:
```typescript
interface ButtonProps {
  title: string                    // Button text
  onPress: () => void             // Press handler
  variant?: 'primary' | 'secondary' | 'outline'
  size?: 'small' | 'medium' | 'large'
  disabled?: boolean              // Disabled state
  loading?: boolean               // Loading state
  icon?: React.ReactNode          // Optional icon
  style?: ViewStyle              // Additional styles
}
```

**Usage**:
```typescript
// Primary button
<Button 
  title="Save Changes" 
  onPress={handleSave}
  variant="primary"
/>

// Secondary button with icon
<Button 
  title="Share"
  onPress={handleShare}
  variant="secondary"
  icon={<ShareIcon />}
/>

// Loading state
<Button 
  title="Submitting..."
  onPress={handleSubmit}
  loading={isSubmitting}
  disabled={isSubmitting}
/>

// Outlined button
<Button 
  title="Cancel"
  onPress={handleCancel}
  variant="outline"
  size="small"
/>
```

**Button Variants**:
```typescript
const buttonStyles = {
  primary: {
    backgroundColor: '#007AFF',
    color: '#FFFFFF',
  },
  secondary: {
    backgroundColor: '#F2F2F7',
    color: '#000000',
  },
  outline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#007AFF',
    color: '#007AFF',
  }
}
```

## Navigation Components

### HapticTab

**Purpose**: Tab component with haptic feedback on press

**Location**: `components/HapticTab.tsx`

**Props**:
```typescript
interface HapticTabProps extends PressableProps {
  children: React.ReactNode
  hapticType?: 'light' | 'medium' | 'heavy' | 'selection'
}
```

**Usage**:
```typescript
<HapticTab 
  onPress={handleTabPress}
  hapticType="selection"
>
  <TabIcon name="schedule" />
  <Text>Schedule</Text>
</HapticTab>
```

**Implementation**:
```typescript
export function HapticTab({ 
  children, 
  hapticType = 'light',
  onPress,
  ...rest 
}: HapticTabProps) {
  const handlePress = (event: GestureResponderEvent) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle[hapticType])
    onPress?.(event)
  }

  return (
    <Pressable onPress={handlePress} {...rest}>
      {children}
    </Pressable>
  )
}
```

### PageIndicator

**Purpose**: Visual indicator for pagination and carousels

**Location**: `components/PageIndicator.tsx`

**Props**:
```typescript
interface PageIndicatorProps {
  currentPage: number        // Current active page
  totalPages: number         // Total number of pages
  dotSize?: number          // Size of indicator dots
  activeDotColor?: string   // Color of active dot
  inactiveDotColor?: string // Color of inactive dots
  style?: ViewStyle         // Container styles
}
```

**Usage**:
```typescript
// Basic page indicator
<PageIndicator 
  currentPage={currentIndex}
  totalPages={images.length}
/>

// Customized indicator
<PageIndicator 
  currentPage={activeSlide}
  totalPages={slides.length}
  dotSize={12}
  activeDotColor="#007AFF"
  inactiveDotColor="#C7C7CC"
/>
```

## Interaction Components

### Collapsible

**Purpose**: Expandable/collapsible content container

**Location**: `components/Collapsible.tsx`

**Props**:
```typescript
interface CollapsibleProps {
  title: string              // Header text
  children: React.ReactNode  // Collapsible content
  collapsed?: boolean        // Initial state
  onToggle?: (collapsed: boolean) => void
  icon?: React.ReactNode     // Custom icon
  style?: ViewStyle         // Container styles
}
```

**Usage**:
```typescript
// Basic collapsible
<Collapsible title="Event Details">
  <ThemedText>Event information goes here</ThemedText>
</Collapsible>

// Controlled collapsible
<Collapsible 
  title="Advanced Settings"
  collapsed={isAdvancedCollapsed}
  onToggle={setIsAdvancedCollapsed}
>
  <SettingsForm />
</Collapsible>

// With custom icon
<Collapsible 
  title="Warmup Routine"
  icon={<ExerciseIcon />}
>
  <WarmupSteps />
</Collapsible>
```

**Animation**:
```typescript
const animatedHeight = useRef(new Animated.Value(0)).current

const toggleCollapse = () => {
  const toValue = collapsed ? 0 : 1
  Animated.timing(animatedHeight, {
    toValue,
    duration: 300,
    useNativeDriver: false,
  }).start()
  setCollapsed(!collapsed)
}
```

### ExternalLink

**Purpose**: Safe external link handling with proper validation

**Location**: `components/ExternalLink.tsx`

**Props**:
```typescript
interface ExternalLinkProps {
  href: string              // URL to open
  children: React.ReactNode // Link content
  style?: TextStyle        // Text styles
  onPress?: () => void     // Additional press handler
}
```

**Usage**:
```typescript
// Basic external link
<ExternalLink href="https://example.com">
  Visit our website
</ExternalLink>

// With custom styling
<ExternalLink 
  href="mailto:support@meetcal.app"
  style={{ color: '#007AFF', textDecorationLine: 'underline' }}
>
  Contact Support
</ExternalLink>

// With press callback
<ExternalLink 
  href="https://sponsor.com"
  onPress={() => trackSponsorClick('sponsor-name')}
>
  <SponsorLogo />
</ExternalLink>
```

**Safety Features**:
```typescript
const handlePress = async () => {
  // Validate URL
  if (!isValidUrl(href)) {
    Alert.alert('Invalid URL', 'The link appears to be invalid.')
    return
  }

  // Check if URL can be opened
  const canOpen = await Linking.canOpenURL(href)
  if (canOpen) {
    await Linking.openURL(href)
    onPress?.()
  } else {
    Alert.alert('Error', 'Unable to open this link.')
  }
}
```

### HelloWave

**Purpose**: Animated wave emoji component

**Location**: `components/HelloWave.tsx`

**Props**:
```typescript
interface HelloWaveProps {
  style?: ViewStyle  // Container styles
  size?: number     // Emoji size
}
```

**Usage**:
```typescript
// Basic wave animation
<HelloWave />

// Custom sized wave
<HelloWave size={32} />

// With container styles
<HelloWave style={{ marginRight: 10 }} />
```

**Animation**:
```typescript
const rotateAnimation = useRef(new Animated.Value(0)).current

useEffect(() => {
  Animated.loop(
    Animated.sequence([
      Animated.timing(rotateAnimation, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(rotateAnimation, {
        toValue: -1,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(rotateAnimation, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
    ]),
    { iterations: 3 }
  ).start()
}, [])
```

## Layout Components

### ParallaxScrollView

**Purpose**: Scroll view with parallax header effect

**Location**: `components/ParallaxScrollView.tsx`

**Props**:
```typescript
interface ParallaxScrollViewProps {
  headerBackgroundColor?: { dark: string; light: string }
  headerImage?: React.ReactElement  // Header content
  headerHeight?: number            // Header height
  children: React.ReactNode       // Scrollable content
}
```

**Usage**:
```typescript
// With image header
<ParallaxScrollView
  headerBackgroundColor={{ light: '#A1CEDC', dark: '#1D3D47' }}
  headerImage={<Image source={meetImage} />}
  headerHeight={200}
>
  <ThemedText type="title">Meet Information</ThemedText>
  <MeetDetails />
</ParallaxScrollView>

// With custom header content
<ParallaxScrollView
  headerBackgroundColor={{ light: '#F0F0F0', dark: '#2A2A2A' }}
  headerImage={
    <View style={styles.headerContent}>
      <ThemedText type="title">Welcome</ThemedText>
      <HelloWave />
    </View>
  }
>
  <WelcomeContent />
</ParallaxScrollView>
```

**Parallax Effect**:
```typescript
const scrollY = useRef(new Animated.Value(0)).current

const headerTranslateY = scrollY.interpolate({
  inputRange: [0, headerHeight],
  outputRange: [0, -headerHeight / 2],
  extrapolate: 'clamp',
})

const headerOpacity = scrollY.interpolate({
  inputRange: [0, headerHeight / 2, headerHeight],
  outputRange: [1, 0.5, 0],
  extrapolate: 'clamp',
})
```

## Business Components

### NotificationSettings

**Purpose**: Comprehensive notification preference management

**Location**: `components/NotificationSettings.tsx`

**Props**:
```typescript
interface NotificationSettingsProps {
  onSettingsChange: (settings: NotificationPreferences) => void
  initialSettings?: NotificationPreferences
  style?: ViewStyle
}

interface NotificationPreferences {
  eventReminders: boolean
  scheduleUpdates: boolean
  resultsNotifications: boolean
  teamUpdates: boolean
  systemAnnouncements: boolean
  quietHours: {
    enabled: boolean
    start: string  // "22:00"
    end: string    // "08:00"
  }
}
```

**Usage**:
```typescript
// Basic notification settings
<NotificationSettings 
  onSettingsChange={handleSettingsUpdate}
  initialSettings={userPreferences.notifications}
/>

// In a modal or settings screen
<Modal visible={showNotificationModal}>
  <View style={styles.modalContent}>
    <ThemedText type="title">Notification Settings</ThemedText>
    <NotificationSettings 
      onSettingsChange={updateNotificationSettings}
      initialSettings={currentSettings}
    />
    <Button 
      title="Save" 
      onPress={saveAndClose}
      variant="primary" 
    />
  </View>
</Modal>
```

**Features**:
- Toggle switches for each notification type
- Quiet hours configuration
- Notification preview
- Platform-specific permission handling

**Implementation Details**:
```typescript
const NotificationSettings: React.FC<NotificationSettingsProps> = ({
  onSettingsChange,
  initialSettings,
  style
}) => {
  const [settings, setSettings] = useState(initialSettings || defaultSettings)

  const updateSetting = (key: keyof NotificationPreferences, value: any) => {
    const newSettings = { ...settings, [key]: value }
    setSettings(newSettings)
    onSettingsChange(newSettings)
  }

  return (
    <View style={style}>
      <SettingSection title="Event Notifications">
        <ToggleSwitch 
          value={settings.eventReminders}
          onValueChange={(value) => updateSetting('eventReminders', value)}
          label="Event Reminders"
        />
        <ToggleSwitch 
          value={settings.scheduleUpdates}
          onValueChange={(value) => updateSetting('scheduleUpdates', value)}
          label="Schedule Updates"
        />
      </SettingSection>
      
      <SettingSection title="Performance Notifications">
        <ToggleSwitch 
          value={settings.resultsNotifications}
          onValueChange={(value) => updateSetting('resultsNotifications', value)}
          label="Results & Records"
        />
      </SettingSection>
      
      <SettingSection title="Quiet Hours">
        <QuietHoursSelector 
          settings={settings.quietHours}
          onUpdate={(quietHours) => updateSetting('quietHours', quietHours)}
        />
      </SettingSection>
    </View>
  )
}
```

## Component Testing

### Testing Patterns

```typescript
// Component test example
import { render, fireEvent } from '@testing-library/react-native'
import { Button } from '../Button'

describe('Button Component', () => {
  it('renders with correct title', () => {
    const { getByText } = render(
      <Button title="Test Button" onPress={() => {}} />
    )
    expect(getByText('Test Button')).toBeTruthy()
  })

  it('calls onPress when tapped', () => {
    const mockPress = jest.fn()
    const { getByText } = render(
      <Button title="Test Button" onPress={mockPress} />
    )
    
    fireEvent.press(getByText('Test Button'))
    expect(mockPress).toHaveBeenCalledTimes(1)
  })

  it('shows loading state correctly', () => {
    const { getByTestId } = render(
      <Button 
        title="Test Button" 
        onPress={() => {}}
        loading={true}
        testID="button"
      />
    )
    
    expect(getByTestId('button')).toHaveStyle({ opacity: 0.6 })
  })
})
```

## Styling Patterns

### Theme Integration

```typescript
// Using theme colors in components
import { useThemeColor } from '@/hooks/useThemeColor'

const MyComponent = () => {
  const backgroundColor = useThemeColor(
    { light: '#ffffff', dark: '#000000' }, 
    'background'
  )
  const textColor = useThemeColor(
    { light: '#000000', dark: '#ffffff' }, 
    'text'
  )

  return (
    <View style={{ backgroundColor }}>
      <Text style={{ color: textColor }}>Themed content</Text>
    </View>
  )
}
```

### Responsive Design

```typescript
// Screen size adaptations
import { Dimensions } from 'react-native'

const { width: screenWidth } = Dimensions.get('window')

const ResponsiveComponent = () => {
  const isTablet = screenWidth > 768
  const buttonSize = isTablet ? 'large' : 'medium'
  
  return (
    <Button 
      title="Adaptive Button"
      size={buttonSize}
      onPress={handlePress}
    />
  )
}
```

## Performance Considerations

### Memoization

```typescript
// Optimize re-renders with memo
export const ThemedText = React.memo<ThemedTextProps>(({
  style,
  lightColor,
  darkColor,
  type = 'default',
  ...rest
}) => {
  // Component implementation
})

// Custom comparison function
export const Button = React.memo<ButtonProps>(ButtonComponent, (prevProps, nextProps) => {
  return (
    prevProps.title === nextProps.title &&
    prevProps.disabled === nextProps.disabled &&
    prevProps.loading === nextProps.loading
  )
})
```

### Lazy Loading

```typescript
// Lazy load heavy components
const HeavyComponent = React.lazy(() => import('./HeavyComponent'))

const ParentComponent = () => {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <HeavyComponent />
    </Suspense>
  )
}
```

---

*These components provide a consistent, accessible, and performant foundation for the MeetCal user interface.*