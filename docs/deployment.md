# Deployment 🚀

This document covers the build process, environment configuration, and deployment procedures for distributing the MeetCal application to iOS and Android app stores.

## Deployment Overview

MeetCal uses **Expo Application Services (EAS)** for building and deploying applications to both iOS and Android platforms.

```
Deployment Pipeline:
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ Development │───►│   Staging   │───►│ Production  │───►│ App Stores  │
│   Branch    │    │    Build    │    │    Build    │    │   Release   │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
       │                   │                   │                   │
       ▼                   ▼                   ▼                   ▼
  Local Testing     Preview Builds    Store Builds    Live Updates
  Metro Bundler     Internal Testing   App Review     OTA Updates
```

## EAS Configuration

### EAS CLI Setup

```bash
# Install EAS CLI globally
npm install -g eas-cli

# Login to your Expo account
eas login

# Initialize EAS in your project
eas build:configure
```

### EAS Build Configuration

**File**: `eas.json`

```json
{
  "cli": {
    "version": ">= 3.0.0"
  },
  "build": {
    "development": {
      "development": true,
      "distribution": "internal",
      "env": {
        "NODE_ENV": "development"
      },
      "ios": {
        "simulator": true,
        "buildConfiguration": "Debug"
      },
      "android": {
        "buildType": "apk"
      }
    },
    "staging": {
      "distribution": "internal",
      "env": {
        "NODE_ENV": "staging"
      },
      "ios": {
        "buildConfiguration": "Release"
      },
      "android": {
        "buildType": "apk"
      }
    },
    "production": {
      "env": {
        "NODE_ENV": "production"
      },
      "ios": {
        "buildConfiguration": "Release"
      },
      "android": {
        "buildType": "aab"
      }
    }
  },
  "submit": {
    "production": {
      "ios": {
        "appleId": "your-apple-id@example.com",
        "ascAppId": "your-app-store-connect-app-id",
        "appleTeamId": "your-apple-team-id"
      },
      "android": {
        "serviceAccountKeyPath": "./android/service-account-key.json",
        "track": "internal"
      }
    }
  }
}
```

## Environment Configuration

### Environment Variables

Create environment-specific configuration files:

#### Production Environment (`.env.production`)

```bash
# Supabase Production
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-production-anon-key

# Clerk Production
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_your-production-key

# RevenueCat Production
EXPO_PUBLIC_REVENUECAT_API_KEY_IOS=your-production-ios-key
EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID=your-production-android-key

# PostHog Production
EXPO_PUBLIC_POSTHOG_API_KEY=your-production-posthog-key
EXPO_PUBLIC_POSTHOG_HOST=https://app.posthog.com

# App Configuration
EXPO_PUBLIC_PROJECT_ID=your-expo-project-id
EXPO_PUBLIC_API_URL=https://api.meetcal.app
```

#### Staging Environment (`.env.staging`)

```bash
# Supabase Staging
EXPO_PUBLIC_SUPABASE_URL=https://your-staging-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-staging-anon-key

# Clerk Staging
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_your-staging-key

# Other staging environment variables...
```

### App Configuration

**File**: `app.config.js`

```javascript
const IS_DEV = process.env.NODE_ENV === 'development'
const IS_STAGING = process.env.NODE_ENV === 'staging'

export default {
  expo: {
    name: IS_STAGING ? 'MeetCal (Staging)' : 'MeetCal',
    slug: 'meetcal',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/icon.png',
    scheme: 'meetcal',
    userInterfaceStyle: 'automatic',
    splash: {
      image: './assets/images/splash.png',
      resizeMode: 'contain',
      backgroundColor: '#ffffff'
    },
    assetBundlePatterns: [
      '**/*'
    ],
    ios: {
      supportsTablet: true,
      bundleIdentifier: IS_STAGING 
        ? 'com.meetcal.app.staging' 
        : 'com.meetcal.app',
      buildNumber: '1',
      infoPlist: {
        UIBackgroundModes: ['background-fetch'],
        NSCameraUsageDescription: 'This app uses the camera to scan QR codes.',
        NSLocationWhenInUseUsageDescription: 'This app uses location to find nearby meets.'
      }
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/images/adaptive-icon.png',
        backgroundColor: '#ffffff'
      },
      package: IS_STAGING 
        ? 'com.meetcal.app.staging' 
        : 'com.meetcal.app',
      versionCode: 1,
      permissions: [
        'CAMERA',
        'ACCESS_FINE_LOCATION',
        'ACCESS_COARSE_LOCATION',
        'RECEIVE_BOOT_COMPLETED',
        'WAKE_LOCK'
      ]
    },
    web: {
      bundler: 'metro',
      output: 'static',
      favicon: './assets/images/favicon.png'
    },
    plugins: [
      'expo-router',
      '@react-native-async-storage/async-storage',
      [
        'expo-notifications',
        {
          icon: './assets/images/notification-icon.png',
          color: '#ffffff',
          sounds: ['./assets/sounds/notification.wav']
        }
      ],
      [
        'expo-image-picker',
        {
          photosPermission: 'The app accesses your photos to let you share them.'
        }
      ]
    ],
    experiments: {
      typedRoutes: true
    },
    extra: {
      router: {
        origin: false
      },
      eas: {
        projectId: process.env.EXPO_PUBLIC_PROJECT_ID
      }
    }
  }
}
```

## Build Process

### Development Builds

```bash
# Build for iOS simulator (development)
eas build --platform ios --profile development --local

# Build for Android emulator (development)
eas build --platform android --profile development --local

# Build for physical devices (development)
eas build --platform all --profile development
```

### Staging Builds

```bash
# Build staging version for internal testing
eas build --platform all --profile staging

# Build with specific version
eas build --platform all --profile staging --auto-submit
```

### Production Builds

```bash
# Build production version for app stores
eas build --platform all --profile production

# Build and submit to app stores
eas build --platform all --profile production --auto-submit
```

## iOS Deployment

### Apple Developer Setup

1. **Apple Developer Account**
   - Enroll in Apple Developer Program
   - Create App Store Connect app record
   - Configure app identifier and capabilities

2. **Certificates and Profiles**
   ```bash
   # Let EAS handle certificates automatically
   eas build --platform ios --profile production
   
   # Or manage manually in Apple Developer Portal
   ```

3. **App Store Connect Configuration**
   - App information and metadata
   - Pricing and availability
   - App Review information
   - Version information

### iOS Build Configuration

**File**: `ios/MeetCal/Info.plist` (if ejected)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDisplayName</key>
    <string>MeetCal</string>
    <key>CFBundleExecutable</key>
    <string>$(EXECUTABLE_NAME)</string>
    <key>CFBundleIdentifier</key>
    <string>com.meetcal.app</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>UIBackgroundModes</key>
    <array>
        <string>background-fetch</string>
        <string>remote-notification</string>
    </array>
    <key>NSCameraUsageDescription</key>
    <string>This app uses the camera to scan QR codes for quick event access.</string>
    <key>NSLocationWhenInUseUsageDescription</key>
    <string>This app uses location to find nearby athletic meets.</string>
</dict>
</plist>
```

### iOS Submission Process

```bash
# Build and submit to App Store
eas submit --platform ios --profile production

# Or submit manually
eas build --platform ios --profile production
# Then upload .ipa file through Xcode or Application Loader
```

### iOS App Store Metadata

Required information for App Store submission:

- **App Name**: MeetCal
- **Description**: Athletic meet scheduling and management app
- **Keywords**: athletics, swimming, track, field, sports, schedule
- **Category**: Sports
- **Age Rating**: 4+ (suitable for all ages)
- **Screenshots**: Required for all supported device sizes
- **App Icon**: 1024x1024 pixels, no transparency

## Android Deployment

### Google Play Console Setup

1. **Google Play Console Account**
   - Create developer account
   - Pay one-time registration fee
   - Create new application

2. **App Signing**
   ```bash
   # Generate upload key (if not using EAS)
   keytool -genkey -v -keystore upload-keystore.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
   
   # Configure gradle.properties
   UPLOAD_STORE_FILE=upload-keystore.jks
   UPLOAD_KEY_ALIAS=upload
   UPLOAD_STORE_PASSWORD=your-password
   UPLOAD_KEY_PASSWORD=your-password
   ```

3. **Service Account for API Access**
   ```bash
   # Create service account in Google Cloud Console
   # Download service account key JSON
   # Place in android/service-account-key.json
   ```

### Android Build Configuration

**File**: `android/app/build.gradle` (if ejected)

```gradle
android {
    compileSdkVersion 34
    
    defaultConfig {
        applicationId "com.meetcal.app"
        minSdkVersion 21
        targetSdkVersion 34
        versionCode 1
        versionName "1.0.0"
        multiDexEnabled true
    }
    
    signingConfigs {
        release {
            storeFile file(UPLOAD_STORE_FILE)
            storePassword UPLOAD_STORE_PASSWORD
            keyAlias UPLOAD_KEY_ALIAS
            keyPassword UPLOAD_KEY_PASSWORD
        }
    }
    
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled true
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }
}
```

### Android Submission Process

```bash
# Build and submit to Google Play
eas submit --platform android --profile production

# Or submit manually
eas build --platform android --profile production
# Then upload .aab file through Google Play Console
```

### Google Play Store Metadata

Required information for Google Play submission:

- **App Title**: MeetCal
- **Short Description**: Athletic meet schedules and results
- **Full Description**: Comprehensive description with features
- **App Category**: Sports
- **Content Rating**: Everyone
- **Screenshots**: Required for phone and tablet
- **Feature Graphic**: 1024x500 pixels

## Over-The-Air (OTA) Updates

### EAS Update Configuration

```bash
# Configure EAS Update
eas update:configure

# Create and publish update
eas update --branch production --message "Bug fixes and improvements"

# Create channel-specific update
eas update --channel staging --message "Staging update"
```

### Update Strategies

#### Automatic Updates

```typescript
// app/_layout.tsx
import * as Updates from 'expo-updates'

export default function RootLayout() {
  useEffect(() => {
    async function checkForUpdates() {
      try {
        const update = await Updates.checkForUpdateAsync()
        
        if (update.isAvailable) {
          await Updates.fetchUpdateAsync()
          await Updates.reloadAsync()
        }
      } catch (error) {
        console.error('Update check failed:', error)
      }
    }

    // Check for updates when app starts
    if (!__DEV__) {
      checkForUpdates()
    }
  }, [])

  // ... rest of component
}
```

#### Manual Updates

```typescript
// components/UpdateChecker.tsx
export function UpdateChecker() {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [updating, setUpdating] = useState(false)

  const checkForUpdate = async () => {
    try {
      const update = await Updates.checkForUpdateAsync()
      setUpdateAvailable(update.isAvailable)
    } catch (error) {
      console.error('Update check failed:', error)
    }
  }

  const applyUpdate = async () => {
    setUpdating(true)
    try {
      await Updates.fetchUpdateAsync()
      await Updates.reloadAsync()
    } catch (error) {
      console.error('Update failed:', error)
      setUpdating(false)
    }
  }

  if (updateAvailable) {
    return (
      <View style={styles.updateBanner}>
        <Text>A new update is available!</Text>
        <Button 
          title={updating ? 'Updating...' : 'Update Now'}
          onPress={applyUpdate}
          disabled={updating}
        />
      </View>
    )
  }

  return null
}
```

## CI/CD Pipeline

### GitHub Actions Configuration

**File**: `.github/workflows/deploy.yml`

```yaml
name: Deploy App

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        cache: 'npm'
    
    - name: Install dependencies
      run: npm ci
    
    - name: Run tests
      run: npm test
    
    - name: Run linting
      run: npm run lint
    
    - name: TypeScript check
      run: npm run type-check

  deploy-staging:
    needs: build
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/develop'
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        cache: 'npm'
    
    - name: Install dependencies
      run: npm ci
    
    - name: Setup EAS
      uses: expo/expo-github-action@v8
      with:
        eas-version: latest
        token: ${{ secrets.EXPO_TOKEN }}
    
    - name: Build staging
      run: eas build --platform all --profile staging --non-interactive

  deploy-production:
    needs: build
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        cache: 'npm'
    
    - name: Install dependencies
      run: npm ci
    
    - name: Setup EAS
      uses: expo/expo-github-action@v8
      with:
        eas-version: latest
        token: ${{ secrets.EXPO_TOKEN }}
    
    - name: Build and submit production
      run: eas build --platform all --profile production --auto-submit --non-interactive
```

### Required Secrets

Configure these secrets in your GitHub repository:

- `EXPO_TOKEN`: Expo access token
- `APPLE_ID`: Apple ID for App Store submission
- `APPLE_APP_SPECIFIC_PASSWORD`: App-specific password
- `GOOGLE_SERVICE_ACCOUNT_KEY`: Google Play service account JSON

## Release Management

### Version Management

```bash
# Update version in package.json and app.config.js
npm version patch  # 1.0.0 -> 1.0.1
npm version minor  # 1.0.1 -> 1.1.0
npm version major  # 1.1.0 -> 2.0.0

# Build with new version
eas build --platform all --profile production
```

### Release Notes

Maintain a `CHANGELOG.md` file:

```markdown
# Changelog

## [1.1.0] - 2024-02-01

### Added
- New warmup routine builder
- Offline mode support
- Dark theme option

### Fixed
- Schedule sync issues
- Memory leak in athlete results
- Push notification handling

### Changed
- Improved performance for large meets
- Updated UI design system
```

### App Store Submission Checklist

#### Pre-submission
- [ ] App builds successfully
- [ ] All tests pass
- [ ] No critical bugs in staging
- [ ] App Store metadata complete
- [ ] Screenshots updated
- [ ] Privacy policy updated
- [ ] Terms of service current

#### iOS Specific
- [ ] App Store Connect app record created
- [ ] Certificates and provisioning profiles valid
- [ ] App Review information complete
- [ ] Export compliance documentation
- [ ] Content rights documentation

#### Android Specific
- [ ] Google Play Console app created
- [ ] App signing configured
- [ ] Content rating questionnaire complete
- [ ] Target audience and content settings
- [ ] Data safety form completed

## Monitoring and Analytics

### Production Monitoring

```typescript
// Monitor app performance and errors
import { posthog } from '@/lib/posthog'

// Track app launches
posthog?.capture('app_launched', {
  version: Constants.expoConfig?.version,
  platform: Platform.OS,
})

// Track errors
export function trackError(error: Error, context?: any) {
  posthog?.capture('error', {
    error: error.message,
    stack: error.stack,
    context,
  })
}

// Track user actions
export function trackUserAction(action: string, properties?: any) {
  posthog?.capture(action, properties)
}
```

### Release Health Metrics

Monitor these key metrics:

- **Crash Rate**: < 0.1%
- **ANR Rate**: < 0.5%
- **App Load Time**: < 3 seconds
- **API Response Time**: < 1 second
- **User Retention**: 
  - Day 1: > 80%
  - Day 7: > 60%
  - Day 30: > 40%

---

*This deployment guide ensures reliable, automated delivery of the MeetCal application to production environments.*