import { useAuth } from "@clerk/expo";
import { AuthView } from "@clerk/expo/native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { useEffect, useRef } from "react";

import { useSubscription } from "@/contexts/SubscriptionContext";
import { cacheAuthState } from "@/lib/authCache";
import { isInternalRoutePath } from "@/utils/authGuard";

export default function SignInScreen() {
  const { isSignedIn, isLoaded, userId } = useAuth({
    treatPendingAsSignedOut: false,
  });
  const { isSubscribed, isLoading: isSubscriptionLoading } = useSubscription();
  const { from, feature } = useLocalSearchParams<{
    from?: string;
    feature?: string;
  }>();
  const hasHandledAuth = useRef(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || hasHandledAuth.current) return;
    // `isSubscribed` is `null` while the cache-first read is still running
    // (and again when no cache and no network can answer). Treating that as
    // "not subscribed" sent every subscriber through the paywall on sign-in.
    // Wait for the provider, then only a confirmed `false` goes there.
    if (isSubscriptionLoading) return;

    hasHandledAuth.current = true;

    void cacheAuthState(true, userId ?? undefined).finally(() => {
      if (isSubscribed === false) {
        router.replace({
          pathname: "/shared-screens/paywall",
          params: {
            from: isInternalRoutePath(from) ? from : "/(tabs)/(index)",
            feature,
          },
        });
        return;
      }

      if (isInternalRoutePath(from)) {
        router.replace(from as Href);
        return;
      }

      if (router.canGoBack()) {
        router.back();
        return;
      }

      router.replace("/(tabs)/(index)" as any);
    });
  }, [feature, from, isLoaded, isSignedIn, isSubscribed, isSubscriptionLoading, userId]);

  return <AuthView mode="signInOrUp" isDismissible={false} />;
}
