import { SubscriptionStatus } from "@/app/schedule-toolbar/profile";
import { showToast } from "@/components/ui/Toast";
import { AuthGuardOptions } from "@/utils/authGuard";
import { NOTIFICATION_ENABLED_KEY } from "@/utils/notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
// Named import: eslint-plugin-import cannot see enums re-exported through
// expo-notifications' nested `export *` chain on the namespace object.
import { AndroidImportance } from "expo-notifications";
import type { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  Alert,
  Linking,
  Platform,
} from "react-native";
import { ProfileSwitchSetting } from "./ProfileSwitchSetting";
import { devLog } from "@/lib/logger";

/** Only a confirmed paid plan counts; "free" and "unknown" do not. */
export function isSubscribedStatus(status: SubscriptionStatus): boolean {
  return status === "quarterly" || status === "lifetime";
}

interface NotificationSettingsProps {
  subscriptionStatus: SubscriptionStatus;
  requireAuth: (options: AuthGuardOptions) => boolean | null;
  router: ReturnType<typeof useRouter>;
}

export function NotificationSettings({
  subscriptionStatus,
  requireAuth,
  router,
}: NotificationSettingsProps) {
  const [isEnabled, setIsEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  // Auto-enable is a first-run default, not a policy that overrides the user.
  // It used to fire whenever reminders were off: every visit after the user
  // turned them off switched them back on, and turning them off on the same
  // visit re-ran the effect with a stale `handleToggle` that wrote "true"
  // after the reminders had already been cancelled. Only a key that has never
  // been written is eligible.
  const [isNeverWritten, setIsNeverWritten] = useState(false);
  const [autoEnableAttempted, setAutoEnableAttempted] = useState(false);

  // Fail closed: "unknown" (no cache, no network) is not a subscription, so
  // it must not auto-enable reminders or trigger the OS permission prompt.
  const isSubscribed = isSubscribedStatus(subscriptionStatus);

  useEffect(() => {
    let isCancelled = false;
    const load = async () => {
      try {
        const enabled = await AsyncStorage.getItem(NOTIFICATION_ENABLED_KEY);
        if (!isCancelled) {
          setIsEnabled(enabled === "true");
          setIsNeverWritten(enabled === null);
        }
      } catch (error) {
        console.error("Error loading notification settings:", error);
        if (!isCancelled) setIsEnabled(false);
      } finally {
        // `isLoading` gates the auto-enable effect below, so landing it after
        // unmount would start an OS permission prompt for a gone screen.
        if (!isCancelled) setIsLoading(false);
      }
    };
    void load();
    return () => {
      isCancelled = true;
    };
  }, []);

  // Default reminders on, once, for a subscriber who has never chosen.
  useEffect(() => {
    if (isSubscribed && isNeverWritten && !isLoading && !autoEnableAttempted) {
      devLog(
        "Subscription active and reminders off, attempting to enable automatically.",
      );
      setAutoEnableAttempted(true);
      void handleToggle({ auto: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSubscribed, isNeverWritten, isLoading, autoEnableAttempted]);

  const requestPermissions = async () => {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#FF231F7C",
      });
    }

    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    return finalStatus === "granted";
  };

  /**
   * A denied OS permission during the first-run auto-enable is the user's
   * answer. Record it as "off" so the auto-enable never re-runs: it only
   * fires while the key has never been written, and writing only on success
   * used to re-prompt (and pop "Permission Required") on every Profile visit.
   * No alert here: the user did not tap anything.
   */
  const recordDeclinedAutoEnable = async () => {
    setIsEnabled(false);
    setIsNeverWritten(false);
    await AsyncStorage.setItem(NOTIFICATION_ENABLED_KEY, "false");
  };

  const handleToggle = async ({ auto = false }: { auto?: boolean } = {}) => {
    // 1. Check auth first
    const authResult = requireAuth({
      feature: "session-reminders",
      message: "Sign in to enable session reminders.",
      returnPath: "/schedule-toolbar/profile",
    });
    if (authResult === null || authResult === false) {
      return;
    }

    // 2. Check subscription
    if (!isSubscribed) {
      Alert.alert(
        "Premium Feature",
        "Session reminders are available for subscribed users. Please upgrade your plan to enable this feature.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "View Plans",
            onPress: () => {
              router.push({
                pathname: "/shared-screens/paywall",
                params: {
                  from: "/schedule-toolbar/profile",
                  feature: "session-reminders",
                },
              });
            },
          },
        ],
      );
      return;
    }

    const newEnabledState = !isEnabled;

    try {
      if (newEnabledState) {
        // Check if we've shown the initial prompt
        const hasCheckedNotifications = await AsyncStorage.getItem(
          "hasCheckedNotifications",
        );

        // If we haven't shown the prompt yet, show it and save the state
        if (!hasCheckedNotifications) {
          const permissionGranted = await requestPermissions();
          await AsyncStorage.setItem("hasCheckedNotifications", "true");
          if (!permissionGranted) {
            if (auto) await recordDeclinedAutoEnable();
            return;
          }
        } else {
          // We've shown the prompt before, but let's check permissions again
          const { status: existingStatus } =
            await Notifications.getPermissionsAsync();
          if (existingStatus !== "granted") {
            if (auto) {
              await recordDeclinedAutoEnable();
              return;
            }
            Alert.alert(
              "Permission Required",
              "Please enable notifications in your device settings to receive session reminders.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Open Settings",
                  onPress: () => Linking.openSettings(),
                },
              ],
            );
            return;
          }
        }

        // Set up Android channel if needed
        if (Platform.OS === "android") {
          await Notifications.setNotificationChannelAsync("default", {
            name: "default",
            importance: AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: "#FF231F7C",
          });
        }
      }

      // Update the UI state first for better UX
      setIsEnabled(newEnabledState);
      setIsNeverWritten(false);

      // Save to AsyncStorage
      await AsyncStorage.setItem(
        NOTIFICATION_ENABLED_KEY,
        String(newEnabledState),
      );

      if (!newEnabledState) {
        // Cancel all scheduled notifications when disabling
        await Notifications.cancelAllScheduledNotificationsAsync();
      }
    } catch (error) {
      console.error("Error toggling notifications:", error);
      showToast({
        type: "error",
        message: "Failed to update notification settings. Please try again.",
      });
      // Revert UI state if there was an error
      setIsEnabled(!newEnabledState);
    }
  };

  if (isLoading) {
    return null;
  }

  return (
    <ProfileSwitchSetting
      label="Session Reminders"
      description="Get notified 1 hour before your sessions"
      value={isEnabled && isSubscribed}
      onToggle={() => void handleToggle()}
      showPremiumBadge={!isSubscribed}
      switchDisabled={!isSubscribed}
      isLoading={isLoading}
    />
  );
}
