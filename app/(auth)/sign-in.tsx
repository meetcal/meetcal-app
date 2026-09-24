import { useAuth } from "@clerk/expo";
import { AuthView } from "@clerk/expo/native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { useEffect, useRef } from "react";

import { cacheAuthState } from "@/lib/authCache";
import { isInternalRoutePath } from "@/utils/authGuard";

export default function SignInScreen() {
  const { isSignedIn, isLoaded, userId } = useAuth({
    treatPendingAsSignedOut: false,
  });
  const { from } = useLocalSearchParams<{
    from?: string;
    feature?: string;
  }>();
  const hasHandledAuth = useRef(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || hasHandledAuth.current) return;
    hasHandledAuth.current = true;

    // No paywall detour here. The subscription context still describes the
    // RevenueCat user from *before* sign-in: `Purchases.logIn` runs in
    // `app/_layout.tsx` after Clerk flips, so a subscriber signing in on a
    // fresh install read as "free" and was sent to buy what they already own.
    // The destination enforces the paywall itself: gated screens render it
    // via `SubscriptionGate` once the entitlement for this user is known.
    void cacheAuthState(true, userId ?? undefined).finally(() => {
      if (isInternalRoutePath(from)) {
        router.replace(from as Href);
        return;
      }

      if (router.canGoBack()) {
        router.back();
        return;
      }

      router.replace("/(tabs)/(index)");
    });
  }, [from, isLoaded, isSignedIn, userId]);

  return <AuthView mode="signInOrUp" isDismissible={false} />;
}
