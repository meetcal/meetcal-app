import {
  fetchUserPreferences,
  patchAutoUnsavePreference,
} from "@/lib/api/meetcal-api";
import { AuthGuardOptions } from "@/utils/authGuard";
import { useAuth, useUser } from "@clerk/expo";
import type { useRouter } from "expo-router";
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
  router: ReturnType<typeof useRouter>;
}

export function AutoUnsaveSetting({
  colors,
  isSubscribed,
  requireAuth,
  router,
}: AutoUnsaveSettingProps) {
  const { user } = useUser();
  const { getToken } = useAuth();
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
        const token = await getToken();
        if (!token) throw new Error("Missing Clerk token");
        const result = await fetchUserPreferences(token);
        if (!cancelled) {
          setIsEnabled(result.auto_unsave_started_sessions);
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
  }, [getToken, user?.id]);

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
      const token = await getToken();
      if (!token) throw new Error("Missing Clerk token");
      await patchAutoUnsavePreference(token, nextValue);
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
