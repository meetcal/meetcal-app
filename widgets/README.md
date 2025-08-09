# MeetCal Widgets

This directory contains the implementation for MeetCal's home screen widgets for both iOS and Android platforms.

## Features

### Small Widget
- **Purpose**: Quick meet selection
- **Size**: 2x2 grid (iOS: systemSmall, Android: 110x110dp)
- **Functionality**: 
  - Displays the currently selected meet
  - Taps open the app to the main schedule screen
  - Shows app icon and "MeetCal" branding

### Medium Widget
- **Purpose**: View upcoming saved sessions
- **Size**: 4x2 grid (iOS: systemMedium, Android: 250x110dp)
- **Functionality**:
  - Shows the selected meet name
  - Lists up to 3 upcoming saved sessions with:
    - Session number and platform
    - Weight class
    - Start time
    - Platform color indicator
  - Shows "X more" if there are additional sessions
  - Taps open the app to saved sessions

## Setup Instructions

### Prerequisites
1. Expo SDK 50+ (for proper widget support)
2. Apple Developer Account (for iOS widgets)
3. Replace `REPLACE_WITH_YOUR_TEAM_ID` in `app.config.js` with your actual Apple Developer Team ID

### Configuration

The widgets are configured in `app.config.js` with the `@bittingz/expo-widgets` plugin:

```js
[
  '@bittingz/expo-widgets',
  {
    ios: {
      src: './widgets/ios',
      devTeamId: 'YOUR_TEAM_ID', // Replace this!
      mode: 'production',
      moduleDependencies: [],
      useLiveActivities: false,
      frequentUpdates: true,
      entitlements: {
        'com.apple.security.application-groups': ['group.com.memohnsen.meetcal.widgets']
      }
    },
    android: {
      src: './widgets/android',
      widgets: [
        {
          name: 'MeetCalSmallWidgetProvider',
          resourceName: '@xml/meetcal_small_widget_info'
        },
        {
          name: 'MeetCalMediumWidgetProvider', 
          resourceName: '@xml/meetcal_medium_widget_info'
        }
      ]
    }
  }
]
```

### Building

1. Update your Apple Developer Team ID in `app.config.js`
2. Run prebuild to generate native files:
   ```bash
   npx expo prebuild --clean
   ```
3. Build for your target platform:
   ```bash
   npx expo run:ios
   # or
   npx expo run:android
   ```

## Data Flow

### iOS
- Uses App Groups (`group.com.memohnsen.meetcal.widgets`) to share data
- Data is stored in `UserDefaults` with suite name
- Widget timeline updates every 15 minutes
- Manual updates triggered via `WidgetCenter.shared.reloadAllTimelines()`

### Android
- Uses `SharedPreferences` with group name for data sharing
- Widget updates triggered by broadcast intents
- Update period set to 15 minutes (900,000ms)

### Data Structure

The app shares the following data with widgets:

```json
{
  "selected_meet": "2024 National Championships",
  "available_meets": [
    {
      "name": "2024 National Championships",
      "status": "upcoming"
    }
  ],
  "saved_sessions": [
    {
      "id": "session-id",
      "meet": "2024 National Championships",
      "sessionNumber": 1,
      "platform": "Red",
      "weightClass": "Women 55kg A",
      "startTime": "9:00 AM",
      "date": "2024-12-20",
      "athleteNames": ["Alice Smith"]
    }
  ]
}
```

## Deep Linking

Widgets use custom URL schemes to communicate with the app:

- `meetcal://select-meet` - Opens app to main schedule (for meet selection)
- `meetcal://saved-sessions` - Opens app to saved sessions screen

The deep link handling is implemented in `app/_layout.tsx` and processes these URLs when the app is launched from a widget.

## File Structure

```
widgets/
├── ios/                              # iOS widget implementation
│   ├── MeetCalWidgets.swift         # Widget bundle
│   ├── MeetCalSmallWidget.swift     # Small widget implementation
│   ├── MeetCalMediumWidget.swift    # Medium widget implementation
│   └── Module.swift                 # Expo module for data sharing
├── android/                         # Android widget implementation
│   ├── main/java/com/memohnsen/meetcal/
│   │   ├── MeetCalSmallWidgetProvider.kt
│   │   └── MeetCalMediumWidgetProvider.kt
│   └── res/
│       ├── xml/                     # Widget configurations
│       ├── layout/                  # Widget layouts
│       ├── drawable/                # Icons and backgrounds
│       └── values/                  # String resources
└── README.md                        # This file
```

## Troubleshooting

### iOS
1. **Build errors**: Ensure your Apple Developer Team ID is correct
2. **Widgets not updating**: Check App Groups entitlement is properly configured
3. **No data in widget**: Verify the app has written data to UserDefaults at least once

### Android
1. **Resource errors**: Run `npx expo prebuild --clean` to regenerate resources
2. **Widget not appearing**: Check the widget provider is properly registered in AndroidManifest.xml
3. **Data not syncing**: Verify SharedPreferences are being written with correct keys

### General
1. **Deep links not working**: Ensure the custom URL scheme `meetcal://` is properly configured
2. **Widget data stale**: Widgets update every 15 minutes automatically, or when the app updates the data

## Testing

### iOS Simulator
1. Build and install the app on iOS Simulator (iPad recommended for widget testing)
2. Long press on home screen → tap "+" → search for "MeetCal"
3. Add widgets to home screen
4. Test widget functionality

### Android Emulator
1. Build and install the app on Android Emulator
2. Long press on home screen → tap "Widgets" → find "MeetCal"
3. Drag widgets to home screen
4. Test widget functionality

## Future Enhancements

- **Live Activities** (iOS 16+): Real-time updates for active competition sessions
- **Widget Configuration**: Allow users to customize which data appears in widgets
- **Larger Widgets**: Support for large/extra-large widget sizes
- **Complications**: Apple Watch complications for quick meet access