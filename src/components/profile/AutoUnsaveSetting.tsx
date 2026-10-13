import { showToast } from "@/components/ui/Toast";
import {
  fetchUserPreferences,
  patchAutoUnsavePreference,
} from "@/lib/api/meetcal-api";
import { premiumActionFor, type PremiumAccess } from "@/lib/premium-access";
import { AuthGuardOptions } from "@/utils/authGuard";
import { useAuth, useUser } from "@clerk/expo";
import type { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { ProfileSwitchSetting } from "./ProfileSwitchSetting";

interface AutoUnsaveSettingProps {
  premiumAccess: PremiumAccess;
  requireAuth: (options: AuthGuardOptions) => boolean | null;
  router: ReturnType<typeof useRouter>;
}

export function AutoUnsaveSetting({
  premiumAccess,
  requireAuth,
  router,
}: AutoUnsaveSettingProps) {
  const isSubscribed = premiumAccess === "granted";
  const { user } = useUser();
  const { getToken } = useAuth();
  const [isEnabled, setIsEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  // "We could not read the server's answer" is not the same as "the preference
  // is off". Rendering a failed load as OFF told a user whose sessions *are*
  // being auto-removed that they are not, and made the switch interactive in
  // that wrong state, so one tap wrote a value they never actually saw.
  const [loadFailed, setLoadFailed] = useState(false);
  // One PATCH at a time. The row and the switch both toggle; two quick taps
  // sent PATCH(true) then PATCH(false), and whichever answered last set the
  // switch, which could then disagree with the server (and so the prune).
  // The ref blocks a second tap before the re-render disables the switch.
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);

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
    if (savingRef.current) return;
    const authResult = requireAuth({
      feature: "auto-unsave-started-sessions",
      message: "Sign in to manage saved session cleanup.",
      returnPath: "/schedule-toolbar/profile",
    });
    if (authResult === null || authResult === false) {
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
    // Only turning it on is premium. Turning it off is always allowed: the
    // setting outlives a lapsed subscription on the server, and a user must
    // never have to pay to stop a destructive feature.
    if (nextValue) {
      // An entitlement that can't be confirmed (offline, no cache) says so
      // instead of sending a subscriber to the paywall.
      const premium = premiumActionFor(premiumAccess);
      if (premium.kind === "notify") {
        showToast(premium.toast);
        return;
      }
      if (premium.kind === "paywall") {
        router.push({
          pathname: "/shared-screens/paywall",
          params: {
            from: "/schedule-toolbar/profile",
            feature: "auto-unsave-started-sessions",
          },
        });
        return;
      }
    }

    savingRef.current = true;
    setIsSaving(true);
    setIsEnabled(nextValue);
    try {
      const token = await getToken();
      if (!token) throw new Error("Missing Clerk token");
      // The server stores the flag and echoes what it persisted, so take its
      // answer rather than leaving the optimistic value standing. It does not
      // re-check the RevenueCat entitlement; the prune does
      // (`pruneStartedSessions` skips unless subscribed).
      const result = await patchAutoUnsavePreference(token, nextValue);
      setIsEnabled(result.auto_unsave_started_sessions);
    } catch (error) {
      setIsEnabled(!nextValue);
      console.error("Error updating auto-unsave setting:", error);
      showToast({
        type: "error",
        message: "Failed to update auto-remove setting. Please try again.",
      });
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  // The stored value, subscribed or not: a lapsed user whose setting is
  // still on sees it on (with the crown) and can turn it off. While off, a
  // non-subscriber's switch stays disabled and the row opens the paywall.
  const isPaused = isEnabled && premiumAccess === "denied" && !loadFailed;

  return (
    <ProfileSwitchSetting
      label="Auto-remove Saved Sessions"
      description={
        loadFailed
          ? "Couldn't load this setting. Check your connection and reopen this screen."
          : isPaused
            ? "Paused while you're not subscribed. Turn it off, or subscribe to keep removing sessions 2 hours after they start."
            : "Remove sessions 2 hours after they start."
      }
      value={isEnabled && !loadFailed}
      onToggle={handleToggle}
      showPremiumBadge={!isSubscribed}
      switchDisabled={loadFailed || (!isSubscribed && !isEnabled)}
      isLoading={isLoading || isSaving}
    />
  );
}
