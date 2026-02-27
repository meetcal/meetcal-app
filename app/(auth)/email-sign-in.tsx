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
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = useMemo(
    () => email.trim().length > 3 && password.length > 0 && !submitting,
    [email, password, submitting],
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

  const onSubmit = async () => {
    if (!isLoaded || submitting) return;
    setSubmitting(true);
    try {
      const result = await signIn.create({
        strategy: "password",
        identifier: email.trim(),
        password,
      });

      if (!result.createdSessionId || typeof setActive !== "function") {
        throw new Error("Could not create session. Please verify your credentials.");
      }

      await setActive({ session: result.createdSessionId });
      await cacheAuthState(true);
      handlePostSignIn();
    } catch (error) {
      Alert.alert("Email sign in failed", getErrorMessage(error));
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
          textContentType="password"
          placeholder="Password"
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
          onPress={onSubmit}
          disabled={!canSubmit}
          style={[
            styles.button,
            {
              backgroundColor: canSubmit ? colors.link : colors.border,
            },
          ]}
        >
          <Text style={[styles.buttonText, { color: colors.background }]}>
            {submitting ? "Signing in..." : "Sign In"}
          </Text>
        </TouchableOpacity>
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
