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
  const [autoEnableAttempted, setAutoEnableAttempted] = useState(false);

  const isSubscribed = subscriptionStatus !== "free";

  useEffect(() => {
    let isCancelled = false;
    const load = async () => {
      try {
        const enabled = await AsyncStorage.getItem(NOTIFICATION_ENABLED_KEY);
        if (!isCancelled) setIsEnabled(enabled === "true");
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

  // Automatically enable reminders if user becomes subscribed and reminders are currently off
  useEffect(() => {
    if (isSubscribed && !isEnabled && !isLoading && !autoEnableAttempted) {
      console.log(
        "Subscription active and reminders off, attempting to enable automatically.",
      );
      setAutoEnableAttempted(true);
      handleToggle();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSubscribed, isEnabled, isLoading, autoEnableAttempted]);

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

  const handleToggle = async () => {
    // 1. Check auth first
    const authResult = requireAuth({
      feature: "session-reminders",
      message: "Sign in to enable session reminders.",
      returnPath: "/(tabs)/(index)/profile",
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
                  from: "/(tabs)/(index)/profile",
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
          if (!permissionGranted) return;
        } else {
          // We've shown the prompt before, but let's check permissions again
          const { status: existingStatus } =
            await Notifications.getPermissionsAsync();
          if (existingStatus !== "granted") {
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
      onToggle={handleToggle}
      showPremiumBadge={!isSubscribed}
      switchDisabled={!isSubscribed}
      isLoading={isLoading}
    />
  );
}
