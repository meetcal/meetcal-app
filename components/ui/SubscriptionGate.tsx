import { ThemedView } from "@/components/ui/ThemedView";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useAppColors } from "@/hooks/useAppColors";
import React from "react";
import { ActivityIndicator, StyleSheet } from "react-native";
import PaywallScreen from "@/app/shared-screens/paywall";
import { isMaestroE2E } from "@/lib/e2e";

interface SubscriptionGateProps {
  children: React.ReactNode;
}

export function SubscriptionGate({ children }: SubscriptionGateProps) {
  const colors = useAppColors();
  const { isSubscribed, isLoading: isSubscriptionLoading } = useSubscription();

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
    return <PaywallScreen />;
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
