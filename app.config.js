/**
 * The iOS calendar permission prompt (iOS 17+ shows the full-access string;
 * the expo-calendar plugin sets it and the pre-17 key from this one value).
 * Accurate about reading: the export looks up the events MeetCal created so
 * it can update them instead of adding duplicates (`src/utils/calendar.ts`).
 */
const CALENDAR_PERMISSION =
  "MeetCal adds the sessions you choose to your calendar, with a reminder before each one, and updates those events when a session's time changes. MeetCal only reads back the events it created; it does not read your other events.";

export default ({ config }) => ({
  name: 'MeetCal',
  slug: 'meetcal',
  version: '6.2.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  splash: {
    image: './assets/images/MeetCal.png',
    resizeMode: 'contain',
    backgroundColor: '#ffffff'
  },
  assetBundlePatterns: [
    '**/*'
  ],
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.memohnsen.meetcal',
    appleTeamId: 'HCK9FFW6UX',
    buildNumber: '1',
    entitlements: {
      'aps-environment': 'production',
      'com.apple.security.application-groups': [
        'group.com.memohnsen.meetcal',
        'group.com.memohnsen.meetcal.onesignal'
      ]
    },
    config: {
      usesNonExemptEncryption: false
    },
    infoPlist: {
      NSLocationWhenInUseUsageDescription: "MeetCal does not use your location, but frameworks we use have location-related things so I have to include this.",
      UIBackgroundModes: ["remote-notification"],
      // Read by the Siri / App Intents client (plugins/ios-app-intents/MeetCalAPI.swift).
      MeetCalConvexURL: process.env.EXPO_PUBLIC_CONVEX_URL ?? '',
    },
    icon: './assets/images/liquid-glass.icon',
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/images/ic_launcher_foreground.png',
      backgroundColor: '#ffffff'
    },
    package: 'com.memohnsen.meetcal',
    versionCode: 1,
    permissions: [
      "READ_CALENDAR",
      "WRITE_CALENDAR",
      // Lets session reminders be exact alarms (src/utils/notifications.ts).
      // Without it Android 12+ schedules them inexactly and may deliver them
      // late, later still in Doze. Granted at install on Android 12-13;
      // denied by default for new installs on 14+, where the user allows it
      // under "Alarms & reminders".
      "android.permission.SCHEDULE_EXACT_ALARM",
    ]
  },
  web: {
    favicon: './assets/favicon.png'
  },
  plugins: [
    // Must be first: mods run in reverse plugin order, and this one has to run
    // after @bacons/apple-targets has created the extension targets.
    './plugins/withVersionSync',
    [
      'onesignal-expo-plugin',
      { mode: 'production', iPhoneDeploymentTarget: '18.0' }
    ],
    // Listed so its prompt uses CALENDAR_PERMISSION. Unlisted, prebuild still
    // applied it with Expo's generic "Allow MeetCal to access your calendars"
    // full-access string and added Reminders strings the app never uses
    // (`false` removes them).
    [
      'expo-calendar',
      { calendarPermission: CALENDAR_PERMISSION, remindersPermission: false },
    ],
    // The app's click listener opens a push's launch URL; OneSignal must not
    // open it a second time.
    './plugins/withOneSignalSuppressLaunchURLs',
    'expo-font',
    'expo-localization',
    'expo-router',
    'expo-secure-store',
    'expo-sharing',
    'expo-splash-screen',
    'expo-status-bar',
    'expo-web-browser',
    '@clerk/expo',
    '@clerk/expo-native-components',
    [
      'expo-build-properties',
      {
        ios: {
          deploymentTarget: '18.0',
          useFrameworks: 'static',
        },
        android: {
          compileSdkVersion: 37,
          targetSdkVersion: 36,
          buildToolsVersion: '37.0.0',
          minSdkVersion: 24,
          ndkVersion: '27.1.12297006',  // NDK version matching EAS Build
        },
      },
    ],
    [
      '@bacons/apple-targets/app.plugin',
      { root: 'targets' },
    ],
    './plugins/withAndroidSavedWidget',
    './plugins/withIOSSavedWidget',
    // Android AsyncStorage defaults to a 6 MB SQLite ceiling; downloaded
    // meets' athlete history does not fit. See the plugin for the budget.
    './plugins/withAsyncStorageDbSize',
    [
      '@sentry/react-native',
      {
        url: "https://sentry.io/",
        project: "react-native",
        organization: "meetcal-llc"
      }
    ],
    './plugins/withIOSAppIntents'
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    eas: {
      projectId: 'a0017b93-a31e-42b1-b36a-11cb5eedf11f'
    },
    EXPO_PUBLIC_REVENUECAT_API_KEY_IOS: undefined,
    EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID: undefined,
    EXPO_PUBLIC_ONESIGNAL_APP_ID: undefined,
  },
  scheme: 'meetcal',
  owner: 'memohnsen',
  runtimeVersion: { policy: "fingerprint" },
  updates: {
    url: 'https://u.expo.dev/a0017b93-a31e-42b1-b36a-11cb5eedf11f',
    enabled: true,
    fallbackToCacheTimeout: 0
  }
});
