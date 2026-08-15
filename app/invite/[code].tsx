import { useAppColors } from "@/hooks/useAppColors";
import {
  normalizeReferralCode,
  setPendingReferralCode,
} from "@/utils/referral";
import { useAuth } from "@clerk/expo";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

/**
 * Handles `meetcal://invite/{code}` deep links. Stores the code so it survives
 * the sign-up flow, then routes the user to redeem it (if already signed in) or
 * to sign-in (where the code is pre-filled into the post-signup prompt).
 */
export default function InviteDeepLinkScreen() {
  const colors = useAppColors();
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const { code } = useLocalSearchParams<{ code?: string }>();
  const handled = useRef(false);

  useEffect(() => {
    if (!isLoaded || handled.current) return;
    handled.current = true;

    (async () => {
      const normalized = normalizeReferralCode(code);
      if (normalized) {
        await setPendingReferralCode(normalized);
      }

      if (isSignedIn) {
        router.replace({
          pathname: "/shared-screens/redeem-invite",
          params: { standalone: "1" },
        } as never);
      } else {
        router.replace({
          pathname: "/(auth)/sign-in",
          params: { from: "/(tabs)/(index)", feature: "referral" },
        } as never);
      }
    })();
  }, [isLoaded, isSignedIn, code, router]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ActivityIndicator size="large" color={colors.link} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
