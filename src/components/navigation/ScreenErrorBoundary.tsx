import * as Sentry from "@sentry/react-native";
import { type ErrorBoundaryProps, useRouter } from "expo-router";
import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useAppColors } from "@/hooks/useAppColors";

/**
 * What a crashed route shows instead of closing the app. Without a boundary
 * React unmounts the whole tree on a render exception and a release build
 * treats it as fatal: the user lost every tab, including the offline
 * schedule, over one bad row on one screen.
 */
function ErrorFallback({
  error,
  retry,
  onGoBack,
  scope,
}: ErrorBoundaryProps & { onGoBack?: () => void; scope: "screen" | "root" }) {
  const colors = useAppColors();

  useEffect(() => {
    Sentry.captureException(error, { tags: { errorBoundary: scope } });
  }, [error, scope]);

  return (
    <View
      testID="error-boundary"
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <EmptyState
        style={styles.message}
        title="Something went wrong"
        message="This screen hit a problem. Try again, or go back and keep using the app."
        actionLabel="Try Again"
        onActionPress={() => {
          void retry();
        }}
      />
      {onGoBack ? (
        <Button
          title="Go Back"
          variant="secondary"
          onPress={onGoBack}
          style={styles.secondaryAction}
        />
      ) : null}
    </View>
  );
}

/**
 * Per-route boundary, given to the root `Stack` as
 * `unstable_screenErrorBoundary`. expo-router wraps every route below it
 * (comp-data, shared screens, each tab's screens), so a failing screen keeps
 * the tabs and the rest of the stack working.
 */
export function ScreenErrorBoundary(props: ErrorBoundaryProps) {
  const router = useRouter();
  return (
    <ErrorFallback
      {...props}
      scope="screen"
      onGoBack={router.canGoBack() ? () => router.back() : undefined}
    />
  );
}

/**
 * Last-resort boundary for the root layout itself (its providers and the
 * navigator). There may be no navigator to go back with, so it only retries.
 */
export function RootErrorBoundary(props: ErrorBoundaryProps) {
  return <ErrorFallback {...props} scope="root" />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
  },
  // EmptyState fills its parent by default; here it shares it with Go Back.
  message: {
    flex: 0,
  },
  secondaryAction: {
    alignSelf: "center",
    marginTop: 12,
  },
});
