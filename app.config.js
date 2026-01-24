export default ({ config }) => ({
  name: 'MeetCal',
  slug: 'meetcal',
  version: '4.1.0',
  orientation: 'portrait',
  icon: './assets/images/MeetCal.png',
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
    buildNumber: '1',
    infoPlist: {
      NSCalendarsUsageDescription: "MeetCal needs calendar access to add weightlifting competition sessions to your calendar. This allows you to receive reminders for your weigh-in and competition times. MeetCal will only ever write new events on your calendar, it will not read your current events.",
      UIBackgroundModes: ["remote-notification"],
    },
    icon: {
      light: './assets/images/MeetCal.png',
      dark: './assets/images/MeetCal-no-bg.png'
    }
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
    'expo-router',
    [
      'expo-build-properties',
      {
        ios: {
          deploymentTarget: '17.0',
          useFrameworks: 'static',
        },
        android: {
          compileSdkVersion: 35,
          targetSdkVersion: 35,
          buildToolsVersion: '36.1.0',
          minSdkVersion: 24,
          ndkVersion: '27.0.12077973',  // NDK r27b - EAS Build available version, AGP 8.6 handles 16KB alignment
        },
      },
    ],
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
  },
  scheme: 'meetcal',
  owner: 'memohnsen',
  runtimeVersion: "4.1.0",
  updates: {
    url: 'https://u.expo.dev/a0017b93-a31e-42b1-b36a-11cb5eedf11f',
    enabled: false,
    fallbackToCacheTimeout: 0
  }
}); 