import { useSubscription } from "@/contexts/SubscriptionContext";
import { useAppColors } from "@/hooks/useAppColors";
import { cacheAuthState } from "@/lib/authCache";
import { useSignIn } from "@clerk/clerk-expo";
import { Stack, router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

function getErrorMessage(error: unknown): string {
  const message = String((error as { message?: unknown })?.message ?? "").toLowerCase();
  if (message.includes("too many requests")) {
    return "Too many attempts. Please wait a moment and try again.";
  }
  return "Sign in failed. Check your credentials and try again.";
}

export default function EmailSignInScreen() {
  const colors = useAppColors();
  const { signIn, setActive, isLoaded } = useSignIn();
  const { isSubscribed } = useSubscription();
  const { from, feature } = useLocalSearchParams<{
    from?: string;
    feature?: string;
  }>();
  const [email, setEmail] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [pendingVerification, setPendingVerification] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const canRequestCode = useMemo(
    () => email.trim().length > 3 && !submitting,
    [email, submitting],
  );

  const canVerify = useMemo(
    () => verificationCode.trim().length >= 6 && !submitting,
    [verificationCode, submitting],
  );

  const handlePostSignIn = () => {
    if (!isSubscribed) {
      router.replace({
        pathname: "/shared-screens/paywall",
        params: {
          from: from || "/(tabs)/(index)",
          feature: feature,
        },
      } as any);
      return;
    }
    if (from && from !== "feature") {
      router.replace(from as any);
      return;
    }
    router.replace("/(tabs)/(index)" as any);
  };

  const onRequestCode = async () => {
    if (!isLoaded || submitting) return;
    setSubmitting(true);
    try {
      await signIn.create({
        identifier: email.trim(),
      });

      const emailCodeFactor = signIn.supportedFirstFactors?.find(
        (factor) =>
          factor.strategy === "email_code" && "emailAddressId" in factor,
      );

      if (
        !emailCodeFactor ||
        !("emailAddressId" in emailCodeFactor) ||
        !emailCodeFactor.emailAddressId
      ) {
        throw new Error("Email verification is unavailable for this account.");
      }

      await signIn.prepareFirstFactor({
        strategy: "email_code",
        emailAddressId: emailCodeFactor.emailAddressId,
      });

      setPendingVerification(true);
    } catch (error) {
      Alert.alert("Email sign in failed", getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const onVerifyCode = async () => {
    if (!isLoaded || submitting) return;
    setSubmitting(true);
    try {
      const result = await signIn.attemptFirstFactor({
        strategy: "email_code",
        code: verificationCode.trim(),
      });

      if (!result.createdSessionId || typeof setActive !== "function") {
        throw new Error("Verification failed. Enter a valid code and try again.");
      }

      await setActive({ session: result.createdSessionId });
      await cacheAuthState(true);
      handlePostSignIn();
    } catch {
      Alert.alert(
        "Verification failed",
        "Verification failed. Enter a valid code and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <Stack.Screen
        options={{
          title: "Email Sign In",
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
        }}
      />
      <View style={styles.content}>
        {!pendingVerification ? (
          <>
            <Text style={[styles.label, { color: colors.secondaryText }]}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              textContentType="emailAddress"
              placeholder="you@example.com"
              placeholderTextColor={colors.secondaryText}
              style={[
                styles.input,
                {
                  color: colors.text,
                  borderColor: colors.border,
                  backgroundColor: colors.card,
                },
              ]}
            />

            <TouchableOpacity
              onPress={onRequestCode}
              disabled={!canRequestCode}
              style={[
                styles.button,
                {
                  backgroundColor: canRequestCode ? colors.link : colors.border,
                },
              ]}
            >
              <Text style={[styles.buttonText, { color: colors.background }]}>
                {submitting ? "Sending..." : "Send Verification Code"}
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={[styles.label, { color: colors.secondaryText }]}>
              Verification Code
            </Text>
            <TextInput
              value={verificationCode}
              onChangeText={setVerificationCode}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              placeholder="Enter code from email"
              placeholderTextColor={colors.secondaryText}
              style={[
                styles.input,
                {
                  color: colors.text,
                  borderColor: colors.border,
                  backgroundColor: colors.card,
                },
              ]}
            />

            <TouchableOpacity
              onPress={onVerifyCode}
              disabled={!canVerify}
              style={[
                styles.button,
                {
                  backgroundColor: canVerify ? colors.link : colors.border,
                },
              ]}
            >
              <Text style={[styles.buttonText, { color: colors.background }]}>
                {submitting ? "Verifying..." : "Verify and Sign In"}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: 20,
    gap: 10,
  },
  label: {
    fontSize: 13,
    fontWeight: "500",
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  button: {
    marginTop: 18,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
