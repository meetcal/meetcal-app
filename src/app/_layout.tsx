// First, so its clock starts as close to JS start as this module can get.
import { startupTiming } from "@/lib/startup-timing";
import { ClerkProvider, useUser } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import NetInfo from "@react-native-community/netinfo";
import {
  DarkTheme,
  DefaultTheme,
  router,
  Stack,
  ThemeProvider,
} from "expo-router";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as Updates from "expo-updates";
import { PostHogProvider } from "posthog-react-native";
import { useCallback, useEffect } from "react";
import { AppState, LogBox, Platform } from "react-native";
import { OneSignal } from "react-native-onesignal";
import Purchases from "react-native-purchases";
import "react-native-reanimated";

import { PostHogScreenTracker } from "@/components/navigation/PostHogScreenTracker";
import { SplashRouteReporter } from "@/components/navigation/SplashRouteReporter";
import {
  RootErrorBoundary,
  ScreenErrorBoundary,
} from "@/components/navigation/ScreenErrorBoundary";
import { OfflineIndicator } from "@/components/offline/OfflineIndicator";
import { ToastProvider } from "@/components/ui/Toast";
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
import {
  getNotificationDeepLink,
  getOneSignalDeepLink,
  normalizeDeepLinkHref,
  openExternalLink,
} from "@/utils/deepLinks";
import * as Sentry from '@sentry/react-native';
import { refreshAuthCacheForVerifiedUser } from "@/lib/authCache";
import { useDataWidgetRefresh } from "@/hooks/useDataWidgetRefresh";
import { useServerDataAccess } from "@/hooks/useServerDataAccess";
import { useSiriToken } from "@/hooks/useSiriToken";
import { isNetworkAvailable } from "@/lib/networkUtils";
import { checkOnboardingComplete } from "@/lib/onboarding";
import { isMaestroE2E } from "@/lib/e2e";
import { ROOT_STACK_SETTINGS } from "@/lib/root-navigation";
import { splashGate } from "@/lib/startup-splash";
import { usesNativeTabs } from "@/lib/tab-bar-layout";
import {
  confirmRevenueCatIdentity,
  forgetRevenueCatIdentity,
  hasSubscriptionEntitlement,
  paywallRouteFor,
} from "@/lib/premium-intent";

// A cold-start deep link opens on top of the tabs (see `ROOT_STACK_SETTINGS`).
export const unstable_settings = ROOT_STACK_SETTINGS;

const SENTRY_ENVIRONMENT =
  process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT ??
  (__DEV__ ? "development" : "production");
const SENTRY_TRACES_SAMPLE_RATE = __DEV__ ? 1.0 : 0;
const SENTRY_PROFILES_SAMPLE_RATE = __DEV__ ? 1.0 : 0;
const SENTRY_REPLAYS_SESSION_SAMPLE_RATE = __DEV__ ? 1.0 : 0;
const SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE = __DEV__ ? 1.0 : 0;
// A DSN is a public client identifier, not a secret. `EXPO_PUBLIC_SENTRY_DSN`
// overrides it per environment; the production DSN stays as the fallback so a
// build or OTA whose env lacks the variable still reports crashes instead of
// silently shipping with Sentry off.
const DEFAULT_SENTRY_DSN =
  'https://a1b2ad477f94d131253b40d07c40c690@o4510884729847808.ingest.us.sentry.io/4510884731158528';
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN || DEFAULT_SENTRY_DSN;

Sentry.init({
  dsn: SENTRY_DSN,
  environment: SENTRY_ENVIRONMENT,
  sendDefaultPii: false,
  enableLogs: false,
  tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
  profilesSampleRate: SENTRY_PROFILES_SAMPLE_RATE,
  replaysSessionSampleRate: SENTRY_REPLAYS_SESSION_SAMPLE_RATE,
  replaysOnErrorSampleRate: SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE,
  replaysSessionQuality: __DEV__ ? "medium" : "low",
  enableAutoPerformanceTracing: __DEV__,
  enableAutoSessionTracking: __DEV__,
  enableAppStartTracking: __DEV__,
  enableNativeFramesTracking: __DEV__,
  enableStallTracking: __DEV__,
  enableAppHangTracking: __DEV__,
  attachScreenshot: false,
  attachViewHierarchy: false,
  enableCaptureFailedRequests: false,
  maxCacheItems: __DEV__ ? 30 : 10,
  maxQueueSize: __DEV__ ? 30 : 10,
  shutdownTimeout: __DEV__ ? 2000 : 500,
  integrations: __DEV__
    ? [Sentry.mobileReplayIntegration(), Sentry.feedbackIntegration()]
    : [],
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

// The splash stays up until the first screen has settled or
// `SPLASH_HOLD_MAX_MS` has passed (`lib/startup-splash.ts`). The cap's timer
// starts here, outside React, so nothing in the tree can hold the splash up.
SplashScreen.preventAutoHideAsync().catch(() => undefined);
splashGate.arm(() => SplashScreen.hideAsync());

// One `startup_timing` event per launch (`lib/startup-timing.ts`).
startupTiming.setFlags({
  platform: Platform.OS,
  nativeTabs: usesNativeTabs(Platform.OS, Platform.Version, isMaestroE2E()),
  updateLaunch: Updates.isEnabled && !Updates.isEmbeddedLaunch,
  appStateAtStart: AppState.currentState ?? "unknown",
});
{
  const backgroundWatch = AppState.addEventListener("change", (state) => {
    if (startupTiming.isSent()) {
      backgroundWatch.remove();
      return;
    }
    if (state === "background") startupTiming.overrideFlags({ backgrounded: true });
  });
}
startupTiming.begin((event, properties) => {
  if (__DEV__) console.info("[perf] startup timing", properties);
  posthog
    .ready()
    .then(() => posthog.capture(event, properties))
    .catch(() => undefined);
});

// Maestro taps the tab bar, which LogBox's dev toasts cover. E2E runs are
// dev-only (`isMaestroE2E`); console errors still reach Metro's log.
if (isMaestroE2E()) LogBox.ignoreAllLogs();

/**
 * NetInfo's default is 15s, long enough that a screen decides it is online and
 * then stalls on a request that can never land. This is the same order as
 * `NETWORK_CACHE_MS` in `lib/networkUtils.ts` on purpose: a reachability probe
 * must resolve well inside the window its answer is cached for.
 */
const REACHABILITY_TIMEOUT_MS = 3000;

/**
 * Delay before the push-permission prompt, so it lands after first paint
 * rather than on top of the splash screen.
 */
const PUSH_PERMISSION_PROMPT_DELAY_MS = 8000;

// Configure NetInfo IMMEDIATELY with shorter timeout for faster offline detection
// This MUST run synchronously before any NetInfo.fetch() calls
NetInfo.configure({
  reachabilityUrl: "https://clients3.google.com/generate_204",
  reachabilityRequestTimeout: REACHABILITY_TIMEOUT_MS,
  reachabilityShortTimeout: REACHABILITY_TIMEOUT_MS,
  useNativeReachability: true,
});

const ONESIGNAL_APP_ID =
  process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID ??
  "184c93ff-546a-4db8-945c-203091782fc9";

// RevenueCat and OneSignal are configured here, before any component runs:
// providers below (`SubscriptionProvider`) call Purchases from their effects,
// and child effects run before a parent's, so configuring from the root
// component's effect would come too late now that the tree renders at once.
// `Purchases.configure` returns nothing to wait for; the tree used to render
// only after an `await` on it.
try {
  if (Platform.OS === "ios") {
    Purchases.configure({ apiKey: REVENUECAT_IOS_KEY });
  } else if (Platform.OS === "android") {
    Purchases.configure({ apiKey: REVENUECAT_ANDROID_KEY, appUserID: null });
  }
  if (__DEV__) {
    Purchases.setLogLevel(Purchases.LOG_LEVEL.DEBUG).catch(() => undefined);
  }
} catch (error) {
  console.warn("RevenueCat initialization error:", error);
}
try {
  OneSignal.initialize(ONESIGNAL_APP_ID);
} catch (error) {
  console.warn("OneSignal initialization error:", error);
}

/**
 * Catches what the per-screen boundaries cannot: a render error in the root
 * layout's own providers or navigator. expo-router wraps this route in it.
 */
export const ErrorBoundary = RootErrorBoundary;

// The tree renders on the first pass: it used to return null until a font
// nothing used had loaded and the SDK setup above had been awaited.
export default Sentry.wrap(function RootLayout() {
  return (
    <CustomThemeProvider>
      <ClerkProvider
        publishableKey={process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!}
        tokenCache={tokenCache}
      >
        {/* Screen views come from `PostHogScreenTracker` below: PostHog's
            own screen capture needs a navigator this provider sits above. */}
        <PostHogProvider
          client={posthog}
          autocapture={{ captureScreens: false }}
        >
          <SubscriptionProvider>
            <SelectedMeetProvider>
              <SavedSessionsProvider>
                <RootLayoutContent />
              </SavedSessionsProvider>
            </SelectedMeetProvider>
          </SubscriptionProvider>
        </PostHogProvider>
      </ClerkProvider>
    </CustomThemeProvider>
  );
});

function RootLayoutContent() {
  const { currentTheme } = useTheme();
  const {
    isLoaded: isUserLoaded,
    user,
  } = useUser();

  // Keep the data widgets current without the Widget Settings screen being
  // open, and mirror the premium entitlement for them and for Siri.
  useDataWidgetRefresh();

  // A subscriber's premium reads carry the shared access pass.
  useServerDataAccess();

  // Siri's App Intents get the pass with their own token, issued while a
  // subscriber is signed in and ended when they sign out.
  useSiriToken();

  // Keep the offline auth hint's seven-day window sliding for every verified
  // session, not only on screens that happen to mount `useAuthGuard`.
  // Resuming from the background counts too: the root never remounts, so an
  // app kept alive for a week would otherwise refresh only once.
  useEffect(() => {
    if (!isUserLoaded || !user?.id) return;
    const userId = user.id;
    void refreshAuthCacheForVerifiedUser(userId, isNetworkAvailable);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void refreshAuthCacheForVerifiedUser(userId, isNetworkAvailable);
      }
    });
    return () => subscription.remove();
  }, [isUserLoaded, user?.id]);

  const openDeepLink = useCallback((value: string | null) => {
    if (!value) return;

    const href = normalizeDeepLinkHref(value);
    if (href) {
      router.push(href);
      return;
    }

    void openExternalLink(value).catch((error) => {
      console.warn("[DeepLinks] Failed to open external link:", error);
    });
  }, []);

  // Keep Clerk, RevenueCat, and OneSignal on the same user identity. RevenueCat
  // needs the OneSignal user ID to deliver its native OneSignal integration tags.
  useEffect(() => {
    if (!isUserLoaded) {
      return;
    }

    let cancelled = false;
    let listenerAdded = false;

    const syncOneSignalIdToRevenueCat = async (userState?: {
      current: { externalId?: string; onesignalId?: string };
    }) => {
      const externalId =
        userState?.current.externalId ?? (await OneSignal.User.getExternalId());
      const oneSignalId =
        userState?.current.onesignalId ??
        (await OneSignal.User.getOnesignalId());

      // Do not associate a stale OneSignal identity with this RevenueCat user.
      if (!cancelled && externalId === user?.id && oneSignalId) {
        await Purchases.setAttributes({
          $onesignalUserId: oneSignalId,
        });
      }
    };

    const handleOneSignalUserChange = (state: {
      current: { externalId?: string; onesignalId?: string };
    }) => {
      syncOneSignalIdToRevenueCat(state).catch((error) => {
        console.error("Error syncing OneSignal ID to RevenueCat:", error);
      });
    };

    const syncUser = async () => {
      try {
        // Whatever RevenueCat said before this point was about the previous
        // user; a pending premium intent must wait for `logIn` below.
        forgetRevenueCatIdentity();
        if (user?.id) {
          const userId = user.id;
          const { customerInfo } = await Purchases.logIn(userId);
          if (!cancelled) {
            const paywall = confirmRevenueCatIdentity(
              userId,
              hasSubscriptionEntitlement(customerInfo),
            );
            if (paywall) router.push(paywallRouteFor(paywall));
          }

          const email = user.primaryEmailAddress?.emailAddress;
          if (email) {
            await Purchases.setEmail(email);
          }

          // The cleanup below already ran if the user signed out while the
          // awaits above were pending; registering now would leak a listener
          // that nothing removes.
          if (cancelled) return;
          OneSignal.User.addEventListener("change", handleOneSignalUserChange);
          listenerAdded = true;
          OneSignal.login(user.id);
          if (email) {
            OneSignal.User.addEmail(email);
          }

          await syncOneSignalIdToRevenueCat();
        } else {
          OneSignal.logout();
          // RevenueCat throws when asked to log out an anonymous user, which
          // is every signed-out launch.
          if (!(await Purchases.isAnonymous())) await Purchases.logOut();
        }
      } catch (error) {
        console.error("Error syncing authenticated user services:", error);
      }
    };

    void syncUser();

    return () => {
      cancelled = true;
      if (listenerAdded) {
        OneSignal.User.removeEventListener("change", handleOneSignalUserChange);
      }
    };
  }, [isUserLoaded, user?.id, user?.primaryEmailAddress?.emailAddress]);

  useEffect(() => {
    let cancelled = false;
    // Not over onboarding: its last page explains and asks for the same
    // notification permission. Read at launch, so a launch that shows
    // onboarding never prompts, even if the user skips out of it within the
    // delay; the next launch asks if the user has not answered by then.
    const onboardingDoneAtLaunch = checkOnboardingComplete();
    const requestPermissionAfterFirstPaint = setTimeout(() => {
      void onboardingDoneAtLaunch.then((completed) => {
        if (cancelled || !completed) return;
        OneSignal.Notifications.requestPermission(false).catch((error) => {
          console.warn("OneSignal permission request failed:", error);
        });
      });
    }, PUSH_PERMISSION_PROMPT_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(requestPermissionAfterFirstPaint);
    };
  }, []);

  useEffect(() => {
    const handleOneSignalClick = (event: unknown) => {
      openDeepLink(getOneSignalDeepLink(event));
    };

    OneSignal.Notifications.addEventListener("click", handleOneSignalClick);

    return () => {
      OneSignal.Notifications.removeEventListener("click", handleOneSignalClick);
    };
  }, [openDeepLink]);

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        openDeepLink(
          getNotificationDeepLink(response.notification.request.content.data),
        );
      },
    );

    const lastResponse = Notifications.getLastNotificationResponse();
    if (lastResponse) {
      openDeepLink(
        getNotificationDeepLink(lastResponse.notification.request.content.data),
      );
      Notifications.clearLastNotificationResponse();
    }

    return () => {
      subscription.remove();
    };
  }, [openDeepLink]);

  return (
    // Without a navigation theme, iOS 26+ native chrome (the Liquid Glass
    // header buttons) falls back to react-navigation's light default even
    // when the system is in dark mode.
    <ThemeProvider value={currentTheme === "dark" ? DarkTheme : DefaultTheme}>
      <ToastProvider>
        <UpdateNotification />
        <OfflineIndicator />
        <PostHogScreenTracker />
        {/* The splash holds for the Schedule tab's first screen only; a
            launch on any other route (a deep link, sign-in, another tab)
            shows it at once. */}
        <SplashRouteReporter />
        {/* Every route below gets its own boundary, so one screen's render
            error shows "Something went wrong" there instead of closing the
            app. */}
        <Stack
          screenOptions={{ headerShown: false }}
          unstable_screenErrorBoundary={ScreenErrorBoundary}
        >
          <Stack.Screen name="(tabs)" options={{ animation: "none" }} />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="schedule-toolbar/offline-data" />
          <Stack.Screen name="schedule-toolbar/profile" />
          <Stack.Screen name="schedule-toolbar/widget-settings" />
          <Stack.Screen name="schedule-toolbar/submit-meet" />
        </Stack>
        <StatusBar style={currentTheme === "dark" ? "light" : "dark"} />
      </ToastProvider>
    </ThemeProvider>
  );
}
