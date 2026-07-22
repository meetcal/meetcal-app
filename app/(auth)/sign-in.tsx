import { useAuth } from "@clerk/expo";
import { AuthView } from "@clerk/expo/native";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef } from "react";

import { useSubscription } from "@/contexts/SubscriptionContext";
import { cacheAuthState } from "@/lib/authCache";
import {
  getPendingReferralCode,
  hasSeenRedeemPrompt,
} from "@/utils/referral";

export default function SignInScreen() {
  const { isSignedIn, isLoaded, userId } = useAuth({
    treatPendingAsSignedOut: false,
  });
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
      // Offer the skippable invite-code prompt after sign-up: whenever a code
      // is pending from a deep link, or the prompt has not been shown yet.
      const [pendingCode, promptSeen] = await Promise.all([
        getPendingReferralCode().catch(() => null),
        hasSeenRedeemPrompt().catch(() => true),
      ]);
      if (pendingCode || !promptSeen) {
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
  }, [feature, from, isLoaded, isSignedIn, isSubscribed, userId]);

  return <AuthView mode="signInOrUp" isDismissible={false} />;
}
