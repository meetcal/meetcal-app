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
 * Sets `title` and clears `headerTitle`. expo-router's `Stack.Screen` only
 * calls `setOptions`, which merges and never resets what it set, and
 * `headerTitle` outranks `title`. A `headerTitle` set here would stay on
 * screen after the content took over and set its own `title`; one the
 * content set earlier (a subscribed athlete's name, before the entitlement
 * lapsed and the gate swapped in the paywall) would stay over this title.
 */
export function FallbackHeader({ title = "" }: { title?: string }) {
  const colors = useAppColors();
  return (
    <Stack.Screen
      options={{
        headerShown: true,
        title,
        headerTitle: undefined,
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
