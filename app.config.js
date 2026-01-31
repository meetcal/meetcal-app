const IS_DEV = process.env.APP_VARIANT === 'development';

export default ({ config }) => ({
  name: IS_DEV ? 'MeetCalDev' : 'MeetCal',
  slug: 'meetcal',
  version: '5.2.5',
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
    bundleIdentifier: IS_DEV ? 'com.memohnsen.meetcal.dev' : 'com.memohnsen.meetcal',
    appleTeamId: 'HCK9FFW6UX',
    buildNumber: '1',
    entitlements: {
      'com.apple.security.application-groups': [
        'group.com.memohnsen.meetcal'
      ]
    },
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
    package: IS_DEV ? 'com.memohnsen.meetcal.dev' : 'com.memohnsen.meetcal',
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
    '@bacons/apple-targets',
    './config/withAndroidSavedWidget',
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
  runtimeVersion: "5.2.5",
  updates: {
    url: 'https://u.expo.dev/a0017b93-a31e-42b1-b36a-11cb5eedf11f',
    enabled: false,
    fallbackToCacheTimeout: 0
  }
}); 
