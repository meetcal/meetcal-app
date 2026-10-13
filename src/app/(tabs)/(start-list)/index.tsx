import { ThemedView } from "@/components/ui/ThemedView";
import { useAppColors } from "@/hooks/useAppColors";
import { useScreenHorizontalInsets } from "@/hooks/useScreenInsets";
import { Suspense, lazy } from "react";
import { ActivityIndicator, StyleSheet } from "react-native";

const LazyStartListScreen = lazy(
  () => import("@/components/start-list/StartListScreen"),
);

function StartListFallback() {
  const colors = useAppColors();
  const screenInsets = useScreenHorizontalInsets();
  return (
    <ThemedView style={[styles.fallback, { backgroundColor: colors.background }, screenInsets]}>
      <ActivityIndicator size="large" />
    </ThemedView>
  );
}

export default function StartListScreen() {
  return (
    <Suspense fallback={<StartListFallback />}>
      <LazyStartListScreen />
    </Suspense>
  );
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
});
