import { ClerkProvider, useUser } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import NetInfo from "@react-native-community/netinfo";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { PostHogProvider } from "posthog-react-native";
import { useEffect, useRef, useState } from "react";
import { Linking, Platform } from "react-native";
import { OneSignal } from "react-native-onesignal";
import Purchases from "react-native-purchases";
import "react-native-reanimated";

import { OfflineIndicator } from "@/components/offline/OfflineIndicator";
import { UpdateNotification } from "@/components/schedule/UpdateNotification";
import { SavedSessionsProvider } from "@/contexts/SavedSessionsContext";
import { SelectedMeetProvider } from "@/contexts/SelectedMeetContext";
import {
  SubscriptionProvider,
} from "@/contexts/SubscriptionContext";
import {
  ThemeProvider as CustomThemeProvider,
  useTheme,
} from "@/contexts/ThemeContext";
import { posthog } from "@/lib/posthog";
import * as Sentry from '@sentry/react-native';

const SENTRY_ENVIRONMENT =
  process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT ??
  (__DEV__ ? "development" : "production");
const SENTRY_TRACES_SAMPLE_RATE = __DEV__ ? 1.0 : 0.2;
const SENTRY_PROFILES_SAMPLE_RATE = __DEV__ ? 1.0 : 0.1;
const SENTRY_REPLAYS_SESSION_SAMPLE_RATE = __DEV__ ? 1.0 : 0.05;
const SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE = __DEV__ ? 1.0 : 0.5;

Sentry.init({
  dsn: 'https://a1b2ad477f94d131253b40d07c40c690@o4510884729847808.ingest.us.sentry.io/4510884731158528',
  environment: SENTRY_ENVIRONMENT,
  sendDefaultPii: false,
  enableLogs: false,
  tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
  profilesSampleRate: SENTRY_PROFILES_SAMPLE_RATE,
  replaysSessionSampleRate: SENTRY_REPLAYS_SESSION_SAMPLE_RATE,
  replaysOnErrorSampleRate: SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE,
  replaysSessionQuality: __DEV__ ? "medium" : "low",
  integrations: [Sentry.mobileReplayIntegration(), Sentry.feedbackIntegration()],
  beforeBreadcrumb(breadcrumb) {
    if (__DEV__ && breadcrumb.category === 'console') {
      return null;
    }
    return breadcrumb;
  },
  beforeSend(event) {
    if (__DEV__) {
      return null;
    }
    return event;
  },

  // uncomment the line below to enable Spotlight (https://spotlightjs.com)
  // spotlight: __DEV__,
});

// Get RevenueCat keys from environment
const REVENUECAT_IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS!;
const REVENUECAT_ANDROID_KEY =
  process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID!;

if (!REVENUECAT_IOS_KEY || !REVENUECAT_ANDROID_KEY) {
  throw new Error("RevenueCat API keys are required");
}

// Keep splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync();

// Configure NetInfo IMMEDIATELY with shorter timeout for faster offline detection
// This MUST run synchronously before any NetInfo.fetch() calls
NetInfo.configure({
  reachabilityUrl: "https://clients3.google.com/generate_204",
  reachabilityRequestTimeout: 3000, // 3 seconds instead of default 15s
  reachabilityShortTimeout: 3000,
  useNativeReachability: true,
});

const ONESIGNAL_APP_ID =
  process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID ??
  "184c93ff-546a-4db8-945c-203091782fc9";

export default Sentry.wrap(function RootLayout() {
  const [appIsReady, setAppIsReady] = useState(false);

  const [fontsLoaded] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
  });

  useEffect(() => {
    async function prepare() {
      try {
        // Initialize RevenueCat first
        if (Platform.OS === "ios") {
          await Purchases.configure({
            apiKey: REVENUECAT_IOS_KEY,
          });
        } else if (Platform.OS === "android") {
          await Purchases.configure({
            apiKey: REVENUECAT_ANDROID_KEY,
            appUserID: null,
          });
        }

        if (__DEV__) {
          Purchases.setLogLevel(Purchases.LOG_LEVEL.DEBUG);
        }

        OneSignal.initialize(ONESIGNAL_APP_ID);
        await OneSignal.Notifications.requestPermission(false);
      } catch (e) {
        console.warn("Initialization error:", e);
      } finally {
        setAppIsReady(true);
      }
    }

    prepare();
  }, []);

  if (!appIsReady || !fontsLoaded) {
    return null;
  }

  return (
    <CustomThemeProvider>
      <ClerkProvider
        publishableKey={process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!}
        tokenCache={tokenCache}
      >
        <PostHogProvider
          client={posthog}
          autocapture={{ captureScreens: true }}
        >
          <SubscriptionProvider>
            <SelectedMeetProvider>
              <SavedSessionsProvider>
                <RootLayoutContent fontsLoaded={fontsLoaded} />
              </SavedSessionsProvider>
            </SelectedMeetProvider>
          </SubscriptionProvider>
        </PostHogProvider>
      </ClerkProvider>
    </CustomThemeProvider>
  );
});

function RootLayoutContent({ fontsLoaded }: { fontsLoaded: boolean }) {
  const [isInitialized, setIsInitialized] = useState(false);
  const hasAttemptedSplashHide = useRef(false);
  const { currentTheme } = useTheme();
  const {
    isLoaded: isUserLoaded,
    user,
  } = useUser();

  useEffect(() => {
    async function initialize() {
      try {
        setIsInitialized(true);
      } catch (error) {
        console.error("Initialization error:", error);
        setIsInitialized(true);
      }
    }

    initialize();
  }, []);

  // Effect to sync Clerk user with RevenueCat
  useEffect(() => {
    async function syncUserWithRevenueCat() {
      if (isUserLoaded && user) {
        try {
          const email = user.primaryEmailAddress?.emailAddress;
          if (email) {
            await Purchases.setEmail(email);
            await Purchases.logIn(user.id);
          }
        } catch (error) {
          console.error("Error syncing user with RevenueCat:", error);
        }
      }
    }

    syncUserWithRevenueCat();
  }, [isUserLoaded, user]);

  useEffect(() => {
    if (isUserLoaded && user?.id) {
      OneSignal.login(user.id);
      const email = user.primaryEmailAddress?.emailAddress;
      if (email) {
        OneSignal.User.addEmail(email);
      }
    } else if (isUserLoaded && !user?.id) {
      OneSignal.logout();
    }
  }, [isUserLoaded, user?.id, user?.primaryEmailAddress?.emailAddress]);

  useEffect(() => {
    async function hideSplash() {
      if (
        !hasAttemptedSplashHide.current &&
        isInitialized &&
        fontsLoaded
      ) {
        hasAttemptedSplashHide.current = true;
        await SplashScreen.hideAsync();

        const initialUrl = await Linking.getInitialURL();

        if (initialUrl) {
          console.log(
            "[RootLayout] App launched with initial URL, letting router handle:",
            initialUrl,
          );
        }
      }
    }

    hideSplash();
  }, [isInitialized, fontsLoaded]);

  if (!isInitialized) {
    return null;
  }

  return (
    <>
      <UpdateNotification />
      <OfflineIndicator />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" options={{ animation: "none" }} />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="schedule-toolbar/offline-data" />
        <Stack.Screen name="schedule-toolbar/profile" />
      </Stack>
      <StatusBar style={currentTheme === "dark" ? "light" : "dark"} />
    </>
  );
}
