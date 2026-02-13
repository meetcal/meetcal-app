import { SubscriptionStatus } from "@/app/(tabs)/(index)/profile";
import { AuthGuardOptions } from "@/utils/authGuard";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import type { Router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import { ThemedText } from "./ThemedText";
import { IconSymbol } from "./ui/IconSymbol";

interface NotificationSettingsProps {
  colors: {
    text: string;
    secondaryText: string;
    border: string;
    card: string;
    pressed: string;
  };
  subscriptionStatus: SubscriptionStatus;
  requireAuth: (options: AuthGuardOptions) => boolean | null;
  router: Router;
}

const NOTIFICATION_ENABLED_KEY = "@notification_enabled";

export function NotificationSettings({
  colors,
  subscriptionStatus,
  requireAuth,
  router,
}: NotificationSettingsProps) {
  const [isEnabled, setIsEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const isSubscribed = subscriptionStatus !== "free";

  useEffect(() => {
    loadNotificationSettings();
  }, []);

  // Automatically enable reminders if user becomes subscribed and reminders are currently off
  useEffect(() => {
    if (isSubscribed && !isEnabled && !isLoading) {
      console.log(
        "Subscription active and reminders off, attempting to enable automatically.",
      );
      handleToggle();
    }
  }, [isSubscribed, isEnabled, isLoading]);

  const loadNotificationSettings = async () => {
    try {
      const enabled = await AsyncStorage.getItem(NOTIFICATION_ENABLED_KEY);
      setIsEnabled(enabled === "true");
    } catch (error) {
      console.error("Error loading notification settings:", error);
      setIsEnabled(false);
    } finally {
      setIsLoading(false);
    }
  };

  const requestPermissions = async () => {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.MAX,
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
              } as any);
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
            importance: Notifications.AndroidImportance.MAX,
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
      Alert.alert(
        "Error",
        "Failed to update notification settings. Please try again.",
      );
      // Revert UI state if there was an error
      setIsEnabled(!newEnabledState);
    }
  };

  if (isLoading) {
    return null;
  }

  return (
    <Pressable
      style={[styles.container, { borderBottomColor: colors.border }]}
      disabled={!isSubscribed}
      onPress={!isSubscribed ? handleToggle : undefined}
    >
      <View style={styles.row}>
        <View style={styles.textContainer}>
          <ThemedText style={[styles.label, { color: colors.text }]}>
            Session Reminders
{" "}
            {!isSubscribed && (
              <IconSymbol name="crown.fill" size={16} color="#FFD700" />
            )}
          </ThemedText>
          <ThemedText
            style={[styles.description, { color: colors.secondaryText }]}
          >
            Get notified 1 hour before your sessions
          </ThemedText>
        </View>
        <Switch
          trackColor={{ false: "#767577", true: "#81b0ff" }}
          thumbColor={isEnabled && isSubscribed ? "#007AFF" : "#f4f3f4"}
          ios_backgroundColor="#3e3e3e"
          onValueChange={handleToggle}
          value={isEnabled && isSubscribed}
          disabled={!isSubscribed || isLoading}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  textContainer: {
    flex: 1,
    marginRight: 8,
  },
  label: {
    fontSize: 17,
    fontWeight: "400",
    marginBottom: 4,
  },
  description: {
    fontSize: 14,
  },
});
