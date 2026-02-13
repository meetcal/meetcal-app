import { ThemedView } from "@/components/ui/ThemedView";
import { useTheme } from "@/contexts/ThemeContext";
import { Suspense, lazy } from "react";
import { ActivityIndicator, StyleSheet } from "react-native";

const StartListContent = lazy(() => import("./StartListContent"));

function StartListFallback() {
  const { currentTheme } = useTheme();
  const bg = currentTheme === "dark" ? "#000000" : "#F5F5F5";
  return (
    <ThemedView style={[styles.fallback, { backgroundColor: bg }]}>
      <ActivityIndicator size="large" />
    </ThemedView>
  );
}

export default function StartListScreen() {
  return (
    <Suspense fallback={<StartListFallback />}>
      <StartListContent />
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
