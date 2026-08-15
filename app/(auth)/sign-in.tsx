import { useAuth, useUser } from "@clerk/expo";
import { AuthView } from "@clerk/expo/native";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef } from "react";

import { useSubscription } from "@/contexts/SubscriptionContext";
import { cacheAuthState } from "@/lib/authCache";
import {
  getPendingReferralCode,
  hasSeenRedeemPrompt,
} from "@/utils/referral";

// Only brand-new accounts see the invite-code prompt (unless a deep-link code
// makes the intent explicit). Clerk's AuthView handles sign-in and sign-up
// internally without exposing which occurred, so key off account age.
const NEW_ACCOUNT_WINDOW_MS = 10 * 60 * 1000;

export default function SignInScreen() {
  const { isSignedIn, isLoaded, userId } = useAuth({
    treatPendingAsSignedOut: false,
  });
  const { user } = useUser();
  const { isSubscribed } = useSubscription();
  const { from, feature } = useLocalSearchParams<{
    from?: string;
    feature?: string;
  }>();
  const hasHandledAuth = useRef(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || hasHandledAuth.current) return;

    hasHandledAuth.current = true;

    void cacheAuthState(true, userId ?? undefined).finally(async () => {
      // Offer the skippable invite-code prompt only when it makes sense: a
      // pending deep-link code (explicit intent, any user), or a freshly
      // created account that hasn't dismissed the prompt yet. Existing users
      // signing back in never see it.
      const createdAtMs = user?.createdAt
        ? new Date(user.createdAt).getTime()
        : null;
      const isNewAccount =
        createdAtMs != null &&
        !Number.isNaN(createdAtMs) &&
        Date.now() - createdAtMs < NEW_ACCOUNT_WINDOW_MS;

      const [pendingCode, promptSeen] = await Promise.all([
        getPendingReferralCode().catch(() => null),
        hasSeenRedeemPrompt().catch(() => true),
      ]);
      if (pendingCode || (isNewAccount && !promptSeen)) {
        router.replace({
          pathname: "/shared-screens/redeem-invite",
          params: {
            from: from || "/(tabs)/(index)",
            feature,
          },
        } as any);
        return;
      }

      if (!isSubscribed) {
        router.replace({
          pathname: "/shared-screens/paywall",
          params: {
            from: from || "/(tabs)/(index)",
            feature,
          },
        } as any);
        return;
      }

      if (from && from !== "feature") {
        router.replace(from as any);
        return;
      }

      if (router.canGoBack()) {
        router.back();
        return;
      }

      router.replace("/(tabs)/(index)" as any);
    });
  }, [feature, from, isLoaded, isSignedIn, isSubscribed, userId, user?.createdAt]);

  return <AuthView mode="signInOrUp" isDismissible={false} />;
}
