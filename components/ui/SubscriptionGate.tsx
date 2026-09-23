import { ThemedView } from "@/components/ui/ThemedView";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useAppColors } from "@/hooks/useAppColors";
import React from "react";
import { ActivityIndicator, StyleSheet } from "react-native";
import PaywallScreen from "@/app/shared-screens/paywall";
import { isMaestroE2E } from "@/lib/e2e";
import { usePathname } from "expo-router";

interface SubscriptionGateProps {
  children: React.ReactNode;
}

/** The trailing path segment, used as the analytics feature name. */
export function featureNameFromPathname(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  return segments[segments.length - 1] || "subscription";
}

export function SubscriptionGate({ children }: SubscriptionGateProps) {
  const colors = useAppColors();
  const { isSubscribed, isLoading: isSubscriptionLoading } = useSubscription();
  // The paywall is rendered here, not navigated to, so it cannot read `from` /
  // `feature` from the route — `useLocalSearchParams` inside it would resolve
  // against the *gated* route. Without this, a signed-out user who taps
  // Records is sent to sign-in with `from: "/(tabs)"` and, once signed in,
  // lands on the schedule tab instead of the screen they asked for.
  const pathname = usePathname();

  if (isMaestroE2E()) {
    return <>{children}</>;
  }

  if (isSubscriptionLoading) {
    return (
      <ThemedView
        style={[
          styles.container,
          {
            backgroundColor: colors.background,
            justifyContent: "center",
            alignItems: "center",
          },
        ]}
      >
        <ActivityIndicator size="large" color={colors.link} />
      </ThemedView>
    );
  }

  if (!isSubscribed) {
    return (
      <PaywallScreen
        from={pathname}
        feature={featureNameFromPathname(pathname)}
      />
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
