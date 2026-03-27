import { api } from "@/convex/_generated/api";
import { convex } from "@/lib/convex";
import { AuthGuardOptions } from "@/utils/authGuard";
import { useUser } from "@clerk/clerk-expo";
import type { Router } from "expo-router";
import React, { useEffect, useState } from "react";
import { Alert } from "react-native";
import { ProfileSwitchSetting } from "./ProfileSwitchSetting";

interface AutoUnsaveSettingProps {
  colors: {
    text: string;
    secondaryText: string;
    border: string;
    pressed: string;
  };
  isSubscribed: boolean;
  requireAuth: (options: AuthGuardOptions) => boolean | null;
  router: Router;
}

export function AutoUnsaveSetting({
  colors,
  isSubscribed,
  requireAuth,
  router,
}: AutoUnsaveSettingProps) {
  const { user } = useUser();
  const [isEnabled, setIsEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) {
      setIsEnabled(false);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const loadPreference = async () => {
      try {
        const result = await convex.query(
          api.userPreferences.getForCurrentUser,
          {},
        );
        if (!cancelled) {
          setIsEnabled(result.autoUnsaveStartedSessions);
        }
      } catch {
        if (!cancelled) {
          setIsEnabled(false);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadPreference();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const handleToggle = async () => {
    const authResult = requireAuth({
      feature: "auto-unsave-started-sessions",
      message: "Sign in to manage saved session cleanup.",
      returnPath: "/schedule-toolbar/profile",
    });
    if (authResult === null || authResult === false) {
      return;
    }

    if (!isSubscribed) {
      router.push({
        pathname: "/shared-screens/paywall",
        params: {
          from: "/schedule-toolbar/profile",
          feature: "auto-unsave-started-sessions",
        },
      } as never);
      return;
    }

    const nextValue = !isEnabled;
    setIsEnabled(nextValue);
    try {
      await convex.mutation(api.userPreferences.setAutoUnsaveStartedSessions, {
        enabled: nextValue,
      });
    } catch (error) {
      setIsEnabled(!nextValue);
      console.error("Error updating auto-unsave setting:", error);
      Alert.alert(
        "Error",
        "Failed to update auto-remove setting. Please try again.",
      );
    }
  };

  return (
    <ProfileSwitchSetting
      colors={colors}
      label="Auto-remove Saved Sessions"
      description="Remove sessions 2 hours after they start."
      value={isEnabled && isSubscribed}
      onPress={handleToggle}
      onValueChange={handleToggle}
      showPremiumBadge={!isSubscribed}
      switchDisabled={!isSubscribed}
      isLoading={isLoading}
    />
  );
}
