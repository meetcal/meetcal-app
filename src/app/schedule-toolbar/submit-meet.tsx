import { SubmitMeetForm } from "@/components/submit-meet/SubmitMeetForm";
import { Button } from "@/components/ui/Button";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { useAppColors } from "@/hooks/useAppColors";
import { SUBMIT_MEET_ROUTE } from "@/lib/meet-submission";
import { useScreenHorizontalInsets } from "@/hooks/useScreenInsets";
import { useAuthGuard } from "@/utils/authGuard";
import { returnToOrigin } from "@/utils/returnToOrigin";
import { Stack, useRouter } from "expo-router";
import React from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Send a meet MeetCal does not cover yet, from Settings. Signed-in users only. */
export default function SubmitMeetScreen() {
  const colors = useAppColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const screenInsets = useScreenHorizontalInsets();
  const { authState } = useAuthGuard();

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }, screenInsets]}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: "Submit a Meet",
          headerTintColor: colors.text,
          headerBackTitle: "Back",
          headerStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: "minimal",
        }}
      />
      {authState === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.link} />
        </View>
      ) : authState === false ? (
        <View style={styles.center}>
          <ThemedText style={[styles.signInText, { color: colors.secondaryText }]}>
            Sign in to send us a meet.
          </ThemedText>
          <Button
            title="Sign In"
            onPress={() =>
              router.push({ pathname: "/(auth)/sign-in", params: { from: SUBMIT_MEET_ROUTE, feature: "submit_meet" } })
            }
          />
        </View>
      ) : (
        <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <SubmitMeetForm
            onDone={() => returnToOrigin(router, undefined)}
            bottomInset={Math.max(40, insets.bottom + 24)}
          />
        </KeyboardAvoidingView>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    padding: 24,
  },
  signInText: {
    fontSize: 15,
    textAlign: "center",
  },
});
