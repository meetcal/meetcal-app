import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { showToast } from "@/components/ui/Toast";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useAppColors } from "@/hooks/useAppColors";
import { redeemReferralCode } from "@/lib/api/meetcal-api";
import {
  clearPendingReferralCode,
  getPendingReferralCode,
  markRedeemPromptSeen,
  normalizeReferralCode,
  redeemErrorMessage,
} from "@/utils/referral";
import { useAuth } from "@clerk/expo";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

export default function RedeemInviteScreen() {
  const colors = useAppColors();
  const router = useRouter();
  const { getToken } = useAuth();
  const { isSubscribed } = useSubscription();
  const { from, feature, standalone } = useLocalSearchParams<{
    from?: string;
    feature?: string;
    standalone?: string;
  }>();

  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pending = await getPendingReferralCode();
      if (!cancelled && pending) {
        setCode(pending);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const continueOnward = () => {
    // Deep-link entry for an already-signed-in user: just return.
    if (standalone) {
      if (router.canGoBack()) {
        router.back();
        return;
      }
      router.replace("/(tabs)/(index)" as never);
      return;
    }

    // Post sign-up flow: mirror the sign-in redirect (paywall then origin).
    if (!isSubscribed) {
      router.replace({
        pathname: "/shared-screens/paywall",
        params: {
          from: from || "/(tabs)/(index)",
          feature,
        },
      } as never);
      return;
    }

    if (from && from !== "feature") {
      router.replace(from as never);
      return;
    }

    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace("/(tabs)/(index)" as never);
  };

  const handleSkip = async () => {
    await markRedeemPromptSeen();
    continueOnward();
  };

  const handleRedeem = async () => {
    const normalized = normalizeReferralCode(code);
    if (!normalized) {
      showToast({ type: "error", message: "Enter an invite code first." });
      return;
    }

    setIsSubmitting(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Missing Clerk token");
      await redeemReferralCode(token, normalized);
      await Promise.all([markRedeemPromptSeen(), clearPendingReferralCode()]);
      showToast({
        type: "success",
        message: "Invite code applied! Your friend gets credit once you subscribe.",
      });
      continueOnward();
    } catch (e) {
      showToast({ type: "error", message: redeemErrorMessage(e) });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          headerTitle: "Invite Code",
          headerTitleStyle: { color: colors.text },
          headerStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
        }}
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.content}>
          <ThemedText style={[styles.title, { color: colors.text }]}>
            Got an invite code?
          </ThemedText>
          <ThemedText style={[styles.subtitle, { color: colors.secondaryText }]}>
            Enter a friend&apos;s code so they get credit toward a free month
            when you subscribe. You can skip this.
          </ThemedText>

          <TextInput
            value={code}
            onChangeText={(text) => setCode(text.toUpperCase())}
            placeholder="Invite code"
            placeholderTextColor={colors.placeholder}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!isSubmitting}
            returnKeyType="done"
            onSubmitEditing={() => {
              void handleRedeem();
            }}
            style={[
              styles.input,
              {
                backgroundColor: colors.card,
                color: colors.text,
                borderColor: colors.border,
              },
            ]}
          />

          <Pressable
            disabled={isSubmitting}
            style={[
              styles.primaryButton,
              { backgroundColor: colors.link },
              isSubmitting && styles.disabledButton,
            ]}
            onPress={() => {
              void handleRedeem();
            }}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <ThemedText style={styles.primaryButtonText}>Redeem</ThemedText>
            )}
          </Pressable>

          <Pressable
            disabled={isSubmitting}
            style={styles.skipButton}
            onPress={() => {
              void handleSkip();
            }}
          >
            <ThemedText style={[styles.skipText, { color: colors.link }]}>
              Skip
            </ThemedText>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: 24,
    justifyContent: "center",
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 8,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 21,
    textAlign: "center",
    marginBottom: 24,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 18,
    letterSpacing: 2,
    textAlign: "center",
    marginBottom: 16,
  },
  primaryButton: {
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
  },
  disabledButton: {
    opacity: 0.6,
  },
  skipButton: {
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  skipText: {
    fontSize: 16,
    fontWeight: "500",
  },
});
