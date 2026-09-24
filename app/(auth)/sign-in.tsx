import { useAuth } from "@clerk/expo";
import { AuthView } from "@clerk/expo/native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { useEffect, useRef } from "react";

import { cacheAuthState } from "@/lib/authCache";
import { paywallRouteFor, recordPremiumIntent } from "@/lib/premium-intent";
import { isInternalRoutePath } from "@/utils/authGuard";

export default function SignInScreen() {
  const { isSignedIn, isLoaded, userId } = useAuth({
    treatPendingAsSignedOut: false,
  });
  const { from, feature } = useLocalSearchParams<{
    from?: string;
    feature?: string;
  }>();
  const hasHandledAuth = useRef(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || hasHandledAuth.current) return;
    hasHandledAuth.current = true;

    // Never decide the paywall from the subscription context here: it still
    // describes the RevenueCat user from *before* sign-in (`Purchases.logIn`
    // runs in `app/_layout.tsx` after Clerk flips), so a subscriber on a
    // fresh install read as "free" and was sent to buy what they already
    // own. The premium intent is recorded instead and decided once
    // RevenueCat confirms this user; see `lib/premium-intent.ts`.
    void cacheAuthState(true, userId ?? undefined).finally(() => {
      if (isInternalRoutePath(from)) {
        router.replace(from as Href);
      } else if (router.canGoBack()) {
        router.back();
      } else {
        router.replace("/(tabs)/(index)");
      }

      const paywall = recordPremiumIntent({ userId, feature, from });
      if (paywall) router.push(paywallRouteFor(paywall));
    });
  }, [feature, from, isLoaded, isSignedIn, userId]);

  return <AuthView mode="signInOrUp" isDismissible={false} />;
}
