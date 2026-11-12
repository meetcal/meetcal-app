import { IconSymbol } from "@/components/ui/IconSymbol";
import { useAppColors } from "@/hooks/useAppColors";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { useNavigation, usePathname, useRouter } from "expo-router";
import React, { useLayoutEffect } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";

const PROFILE_ROUTE = "/schedule-toolbar/profile";

export function useScheduleHeaderButtons(): void {
  const navigation = useNavigation();
  const { isAuthenticated, authState, notifyAuthPending } = useAuthGuard();
  const router = useRouter();
  const pathname = usePathname();
  const colors = useAppColors();

  useLayoutEffect(() => {
    const openOfflineData = () => router.push("/schedule-toolbar/offline-data");
    const openProfile = () => {
      if (authState === null) {
        notifyAuthPending();
        return;
      }
      if (authState) {
        router.push(PROFILE_ROUTE);
      } else {
        router.push({
          pathname: "/(auth)/sign-in",
          params: { from: PROFILE_ROUTE, feature: "profile" },
        });
      }
    };
    const profileLabel = isAuthenticated ? "My profile and settings" : "Sign in";

    if (Platform.OS === "ios") {
      navigation.setOptions({
        unstable_headerLeftItems: () => [
          {
            type: "button",
            label: "Offline data",
            icon: { type: "sfSymbol", name: "square.and.arrow.down" },
            onPress: openOfflineData,
          },
        ],
        unstable_headerRightItems: () => [
          {
            type: "button",
            label: profileLabel,
            icon: { type: "sfSymbol", name: "person.circle.fill" },
            onPress: openProfile,
          },
        ],
      });
      return;
    }

    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerActions}>
          <Pressable
            style={styles.headerIconButton}
            onPress={openOfflineData}
            accessibilityRole="button"
            accessibilityLabel="Offline data"
          >
            <IconSymbol name="square.and.arrow.down" size={24} color={colors.text} />
          </Pressable>
          <Pressable
            style={[styles.headerIconButton, { paddingTop: 8 }]}
            onPress={openProfile}
            accessibilityRole="button"
            accessibilityLabel={profileLabel}
          >
            <IconSymbol name="person-circle-sharp" size={24} color={colors.text} />
          </Pressable>
        </View>
      ),
    });
  }, [authState, colors.text, isAuthenticated, navigation, notifyAuthPending, pathname, router]);
}

const styles = StyleSheet.create({
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerIconButton: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
});
