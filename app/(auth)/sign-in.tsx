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
  const { isSubscribed } = useSubscription();
  const { from, feature } = useLocalSearchParams<{
    from?: string;
    feature?: string;
  }>();
  const hasHandledAuth = useRef(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || hasHandledAuth.current) return;

    hasHandledAuth.current = true;

    void cacheAuthState(true, userId ?? undefined).finally(() => {
      if (!isSubscribed) {
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
  }, [feature, from, isLoaded, isSignedIn, isSubscribed, userId]);

  return <AuthView mode="signInOrUp" isDismissible={false} />;
}
