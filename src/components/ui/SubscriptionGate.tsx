import { EmptyState } from "@/components/ui/EmptyState";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedView } from "@/components/ui/ThemedView";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useAppColors } from "@/hooks/useAppColors";
import React from "react";
import { ActivityIndicator, StyleSheet } from "react-native";
import PaywallScreen from "@/app/shared-screens/paywall";
import { isMaestroE2E } from "@/lib/e2e";
import { resolvePremiumAccess } from "@/lib/premium-access";
import { usePathname } from "expo-router";

interface SubscriptionGateProps {
  children: React.ReactNode;
  /**
   * Return path and analytics feature for the inline paywall. Default to the
   * current route and its trailing segment.
   */
  from?: string;
  feature?: string;
}

/** The trailing path segment, used as the analytics feature name. */
export function featureNameFromPathname(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  return segments[segments.length - 1] || "subscription";
}

export function SubscriptionGate({
  children,
  from: fromProp,
  feature: featureProp,
}: SubscriptionGateProps) {
  const colors = useAppColors();
  const {
    isSubscribed,
    isLoading: isSubscriptionLoading,
    recheckSubscription,
  } = useSubscription();
  // The paywall is rendered here, not navigated to, so it cannot read `from` /
  // `feature` from the route — `useLocalSearchParams` inside it would resolve
  // against the *gated* route. Without this, a signed-out user who taps
  // Records is sent to sign-in with `from: "/(tabs)"` and, once signed in,
  // lands on the schedule tab instead of the screen they asked for.
  const pathname = usePathname();
  const from = fromProp ?? pathname;

  if (isMaestroE2E()) {
    return <>{children}</>;
  }

  // A known answer wins, even while the provider flags `isLoading` for a
  // background refresh (the post-launch RevenueCat check, a reconnect
  // re-check, every CustomerInfo listener update): swapping the children out
  // then unmounted the gated screen mid-use, dropping its filters and scroll
  // and refetching. Unknown never shows the paywall: a spinner while a check
  // is in flight, a retryable message otherwise.
  const access = resolvePremiumAccess({
    isSubscribed,
    isLoading: Boolean(isSubscriptionLoading),
  });

  if (access === "checking") {
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

  if (access === "unknown") {
    return (
      <ThemedView
        style={[styles.container, { backgroundColor: colors.background }]}
      >
        <EmptyState
          icon={<IconSymbol name="wifi.slash" size={40} color={colors.secondaryText} />}
          title="Can't confirm your subscription"
          message="Connect to the internet so MeetCal can check your subscription, then try again."
          actionLabel="Try Again"
          onActionPress={recheckSubscription}
        />
      </ThemedView>
    );
  }

  if (access === "denied") {
    return (
      <PaywallScreen
        from={from}
        feature={featureProp ?? featureNameFromPathname(from)}
        inline
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
