import { showToast } from "@/components/ui/Toast";
import {
  fetchUserPreferences,
  patchAutoUnsavePreference,
} from "@/lib/api/meetcal-api";
import { AuthGuardOptions } from "@/utils/authGuard";
import { useAuth, useUser } from "@clerk/expo";
import type { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { ProfileSwitchSetting } from "./ProfileSwitchSetting";

interface AutoUnsaveSettingProps {
  isSubscribed: boolean;
  requireAuth: (options: AuthGuardOptions) => boolean | null;
  router: ReturnType<typeof useRouter>;
}

export function AutoUnsaveSetting({
  isSubscribed,
  requireAuth,
  router,
}: AutoUnsaveSettingProps) {
  const { user } = useUser();
  const { getToken } = useAuth();
  const [isEnabled, setIsEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  // "We could not read the server's answer" is not the same as "the preference
  // is off". Rendering a failed load as OFF told a user whose sessions *are*
  // being auto-removed that they are not, and made the switch interactive in
  // that wrong state, so one tap wrote a value they never actually saw.
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!user?.id) {
      setIsEnabled(false);
      setLoadFailed(false);
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
          setLoadFailed(false);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("Failed to load auto-unsave preference:", error);
          setLoadFailed(true);
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
      });
      return;
    }

    if (loadFailed) {
      showToast({
        type: "error",
        message: "Couldn't read your current setting. Try again once you're back online.",
      });
      return;
    }

    const nextValue = !isEnabled;
    setIsEnabled(nextValue);
    try {
      const token = await getToken();
      if (!token) throw new Error("Missing Clerk token");
      // The server stores the flag and echoes what it persisted, so take its
      // answer rather than leaving the optimistic value standing. It does not
      // re-check the RevenueCat entitlement: the `isSubscribed` gate above is
      // the only one, and it is a client-side hint.
      const result = await patchAutoUnsavePreference(token, nextValue);
      setIsEnabled(result.auto_unsave_started_sessions);
    } catch (error) {
      setIsEnabled(!nextValue);
      console.error("Error updating auto-unsave setting:", error);
      showToast({
        type: "error",
        message: "Failed to update auto-remove setting. Please try again.",
      });
    }
  };

  return (
    <ProfileSwitchSetting
      label="Auto-remove Saved Sessions"
      description={
        loadFailed
          ? "Couldn't load this setting. Check your connection and reopen this screen."
          : "Remove sessions 2 hours after they start."
      }
      value={isEnabled && isSubscribed && !loadFailed}
      onToggle={handleToggle}
      showPremiumBadge={!isSubscribed}
      switchDisabled={!isSubscribed || loadFailed}
      isLoading={isLoading}
    />
  );
}
