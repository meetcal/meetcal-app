import { Stack } from "expo-router";
import React from "react";

import { useAppColors } from "@/hooks/useAppColors";

/**
 * The header for a screen whose own content is not rendered yet: a
 * subscription gate's spinner or "Can't confirm" state, the paywall's loading
 * and error states, a screen's loading branch.
 *
 * Routes on the root `Stack` default to `headerShown: false` and turn their
 * header on from inside their content. When something else renders in place
 * of that content, no header and no Back button appear, and on iOS the only
 * way out is the edge swipe.
 *
 * Sets `title`, never `headerTitle`. expo-router's `Stack.Screen` only calls
 * `setOptions` and never resets what it set, and `headerTitle` outranks the
 * `title` the screen's content sets once it renders, so a `headerTitle` here
 * would stay on screen after the content took over.
 */
export function FallbackHeader({ title = "" }: { title?: string }) {
  const colors = useAppColors();
  return (
    <Stack.Screen
      options={{
        headerShown: true,
        title,
        headerBackTitle: "Back",
        headerBackButtonDisplayMode: "minimal",
        headerTintColor: colors.text,
        headerTitleStyle: { color: colors.text },
        headerStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
      }}
    />
  );
}
