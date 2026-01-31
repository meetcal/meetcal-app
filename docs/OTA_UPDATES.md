# Over-The-Air (OTA) Updates Setup

This document outlines the OTA update implementation for the MeetCal app using Expo Updates.

## Overview

The app is configured to automatically check for and download over-the-air updates, allowing users to receive new features and bug fixes without going through the app store update process.

## Configuration

### 1. Update Configuration in `app.json` & `app.config.js`

```json
{
  "updates": {
    "url": "https://u.expo.dev/a0017b93-a31e-42b1-b36a-11cb5eedf11f",
    "enabled": true,
    "fallbackToCacheTimeout": 0
  },
  "runtimeVersion": "3.2.4"
}
```

- **url**: The EAS Updates endpoint for this project
- **enabled**: Enables OTA updates. Production and preview builds must have this set to `true` (or `!IS_DEV` in app.config.js so only non-development builds receive updates). Development builds can leave it disabled if desired.
- **fallbackToCacheTimeout**: Immediate fallback to cache if update fails
- **runtimeVersion**: Controls compatibility between app and updates

### 2. EAS Update Configuration in `eas.json`

```json
{
  "update": {
    "development": {
      "distribution": "internal",
      "channel": "development"
    },
    "preview": {
      "distribution": "internal", 
      "channel": "preview"
    },
    "production": {
      "channel": "production"
    }
  }
}
```

This configuration defines different update channels for different environments.

## Implementation

### 1. `useOTAUpdates` Hook

Located in `hooks/useOTAUpdates.ts`, this custom hook manages the entire OTA update lifecycle:

- **Automatic checking**: Checks for updates when the app becomes active
- **Download management**: Handles update downloads with error handling
- **User consent**: Provides user control over when to apply updates
- **Error handling**: Graceful error handling and recovery

Key features:
- Skips update checks in development mode
- Only checks when updates are enabled
- Provides loading states for UI feedback
- Handles app restart after update download

### 2. `UpdateNotification` Component

Located in `components/UpdateNotification.tsx`, this component provides the user interface for OTA updates:

- **Update notifications**: Shows when updates are available
- **Progress indicators**: Displays download progress
- **User actions**: "Update Now" and "Later" options
- **Error display**: Shows error messages when updates fail
- **Theme support**: Adapts to light/dark themes

### 3. Integration in Main App

The `UpdateNotification` component is integrated into the main app layout (`app/_layout.tsx`) to ensure updates are handled globally across all screens.

## Usage

### For Developers

#### Publishing Updates

```bash
# Development channel
npx eas update --branch development --message "Development update"

# Preview channel  
npx eas update --branch preview --message "Preview update"

# Production channel
npx eas update --branch production --message "Production update"
```

#### Testing Updates on Android (dev build)

1. **Enable updates for dev** (optional): In `app.config.js` set `updates.enabled: true` temporarily so the development build receives OTA. With `enabled: !IS_DEV`, development builds have updates disabled by design.
2. Build the Android dev client:  
   `eas build --profile development --platform android`
3. Install the build from the EAS link (internal distribution) on your device or emulator.
4. Publish an update to the development channel:  
   `eas update --channel development --message "Test update"`
5. Open the app (or bring it to foreground). The app checks for updates and should show the "Update Available" banner.
6. Tap "Update Now" and confirm restart to apply the update.
7. If you changed `enabled` for testing, set it back to `!IS_DEV` when done.

### For Users

1. **Automatic checks**: The app automatically checks for updates when opened
2. **User notification**: When an update is available, a notification card appears
3. **User choice**: Users can choose to update immediately or defer
4. **Seamless updates**: Updates download in the background and apply with a restart

## Update Flow

```
App Start → Check for Updates → Update Available? → Download → User Consent → Restart
     ↓              ↓                    ↓              ↓            ↓
 No Update    Show Progress        Update Later?    Background    Apply Update
     ↓              ↓                    ↓         Download           ↓
Continue App   Hide Notification   Dismiss Card      ↓          App Restart
                                                     ↓
                                              Show Restart
                                              Confirmation
```

## Error Handling

The implementation includes comprehensive error handling:

- **Network errors**: Graceful handling of connectivity issues
- **Download failures**: Retry logic and user feedback
- **Update errors**: Clear error messages and recovery options
- **Fallback**: App continues to work even if updates fail

## Best Practices

1. **Runtime Version**: Update the runtime version when making native changes
2. **Testing**: Always test updates in development/preview before production
3. **Gradual rollout**: Consider gradual rollouts for major updates
4. **Error monitoring**: Monitor update success rates and error logs
5. **User communication**: Provide clear messaging about what's new in updates

## Monitoring

Monitor OTA update performance using:

- EAS Console for update deployment status
- App analytics for update adoption rates
- Error reporting for update failures
- User feedback for update experience

## Troubleshooting

### Common Issues

1. **Updates not appearing**: Check runtime version compatibility
2. **Download failures**: Verify network connectivity and EAS service status
3. **App crashes**: Ensure native dependencies match between app and updates
4. **Slow updates**: Consider update size and user's connection speed

### Debug Commands

```bash
# Check current update status
npx expo install --check

# View update info in development
console.log(Updates.updateId, Updates.channel);

# Clear update cache (iOS Simulator)
npx expo start --clear
```

## Security

- Updates are signed and verified by Expo
- Only published updates from your EAS project can be applied
- Runtime version matching prevents incompatible updates
- HTTPS encryption for all update traffic