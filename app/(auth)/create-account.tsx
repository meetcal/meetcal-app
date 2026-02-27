import { useSubscription } from "@/contexts/SubscriptionContext";
import { useAppColors } from "@/hooks/useAppColors";
import { cacheAuthState } from "@/lib/authCache";
import { useSignUp } from "@clerk/clerk-expo";
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

function getErrorMessage(
  error: unknown,
  context: "create-account" | "verify-code",
): string {
  const message = String((error as { message?: unknown })?.message ?? "").toLowerCase();
  if (message.includes("too many requests")) {
    return "Too many attempts. Please wait a moment and try again.";
  }

  if (context === "verify-code") {
    return "Verification failed. Enter a valid code and try again.";
  }
  return "Create account failed. Check your details and try again.";
}

export default function CreateAccountScreen() {
  const colors = useAppColors();
  const { signUp, setActive, isLoaded } = useSignUp();
  const { isSubscribed } = useSubscription();
  const { from, feature } = useLocalSearchParams<{
    from?: string;
    feature?: string;
  }>();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [pendingVerification, setPendingVerification] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const canCreate = useMemo(
    () =>
      email.trim().length > 3 &&
      password.length >= 8 &&
      confirmPassword.length > 0 &&
      !submitting,
    [confirmPassword.length, email, password.length, submitting],
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

  const onCreateAccount = async () => {
    if (!isLoaded || submitting) return;
    if (password !== confirmPassword) {
      Alert.alert("Passwords do not match", "Please enter matching passwords.");
      return;
    }

    setSubmitting(true);
    try {
      await signUp.create({
        emailAddress: email.trim(),
        password,
      });

      await signUp.prepareEmailAddressVerification({
        strategy: "email_code",
      });
      setPendingVerification(true);
    } catch (error) {
      Alert.alert("Create account failed", getErrorMessage(error, "create-account"));
    } finally {
      setSubmitting(false);
    }
  };

  const onVerifyEmailCode = async () => {
    if (!isLoaded || submitting) return;
    setSubmitting(true);
    try {
      const result = await signUp.attemptEmailAddressVerification({
        code: verificationCode.trim(),
      });

      if (!result.createdSessionId || typeof setActive !== "function") {
        throw new Error("Verification completed, but no active session was created.");
      }

      await setActive({ session: result.createdSessionId });
      await cacheAuthState(true);
      handlePostSignIn();
    } catch (error) {
      Alert.alert("Verification failed", getErrorMessage(error, "verify-code"));
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
          title: "Create Account",
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

            <Text style={[styles.label, { color: colors.secondaryText }]}>Password</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="newPassword"
              placeholder="At least 8 characters"
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

            <Text style={[styles.label, { color: colors.secondaryText }]}>
              Confirm Password
            </Text>
            <TextInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              textContentType="newPassword"
              placeholder="Re-enter password"
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
              onPress={onCreateAccount}
              disabled={!canCreate}
              style={[
                styles.button,
                {
                  backgroundColor: canCreate ? colors.link : colors.border,
                },
              ]}
            >
              <Text style={[styles.buttonText, { color: colors.background }]}>
                {submitting ? "Creating..." : "Create Account"}
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
              onPress={onVerifyEmailCode}
              disabled={!canVerify}
              style={[
                styles.button,
                {
                  backgroundColor: canVerify ? colors.tint : colors.border,
                },
              ]}
            >
              <Text style={[styles.buttonText, { color: colors.background }]}>
                {submitting ? "Verifying..." : "Verify and Continue"}
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
