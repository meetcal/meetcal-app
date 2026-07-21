export default ({ config }) => ({
  name: 'MeetCal',
  slug: 'meetcal',
  version: '6.1.0',
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
      NSCalendarsUsageDescription: "MeetCal needs calendar access to add weightlifting competition sessions to your calendar. This allows you to receive reminders for your weigh-in and competition times. MeetCal will only ever write new events on your calendar, it will not read your current events.",
      NSLocationWhenInUseUsageDescription: "MeetCal does not use your location, but frameworks we use have location-related things so I have to include this.",
      UIBackgroundModes: ["remote-notification"],
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
    permissions: ["READ_CALENDAR", "WRITE_CALENDAR"]
  },
  web: {
    favicon: './assets/favicon.png'
  },
  plugins: [
    // Must be first: mods run in reverse plugin order, and this one has to run
    // after @bacons/apple-targets has created the extension targets.
    './config/withVersionSync',
    [
      'onesignal-expo-plugin',
      { mode: 'production', iPhoneDeploymentTarget: '18.0' }
    ],
    'expo-font',
    'expo-localization',
    'expo-router',
    'expo-secure-store',
    'expo-sharing',
    'expo-splash-screen',
    'expo-status-bar',
    'expo-web-browser',
    '@clerk/expo',
    [
      'expo-build-properties',
      {
        ios: {
          deploymentTarget: '18.0',
          useFrameworks: 'static',
        },
        android: {
          compileSdkVersion: 36,
          targetSdkVersion: 36,
          buildToolsVersion: '36.1.0',
          minSdkVersion: 24,
          ndkVersion: '27.1.12297006',  // NDK version matching EAS Build
        },
      },
    ],
    [
      '@bacons/apple-targets/app.plugin',
      { root: 'targets' },
    ],
    './config/withAndroidSavedWidget',
    './config/withIOSSavedWidget',
    [
      '@sentry/react-native',
      {
        url: "https://sentry.io/",
        project: "react-native",
        organization: "meetcal-llc"
      }
    ],
    './config/withIOSAppIntents'
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
  runtimeVersion: "6.1.0",
  updates: {
    url: 'https://u.expo.dev/a0017b93-a31e-42b1-b36a-11cb5eedf11f',
    enabled: true,
    fallbackToCacheTimeout: 0
  }
});
