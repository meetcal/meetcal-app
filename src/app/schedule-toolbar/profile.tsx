import { AndroidCalendarSetting } from "@/components/profile/AndroidCalendarSetting";
import { getChevronIcon } from "@/lib/start-list-utils";
import { AutoUnsaveSetting } from "@/components/profile/AutoUnsaveSetting";
import { ClerkAccountModal } from "@/components/profile/ClerkAccountModal";
import { NotificationSettings } from "@/components/profile/NotificationSettings";
import { ProfileActionSetting } from "@/components/profile/ProfileActionSetting";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { showToast } from "@/components/ui/Toast";
import { useSelectedMeet } from "@/contexts/SelectedMeetContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useAppColors } from "@/hooks/useAppColors";
import {
  ACCOUNT_DELETION_TITLE,
  accountDeletionMessage,
  clearLocalUserData,
  subscriptionManagementUrl,
} from "@/lib/account-deletion";
import { clearAuthCache } from "@/lib/authCache";
import { clearCachedMeetData, clearCacheToast } from "@/lib/database/clear-cache";
import { resolvePremiumAccess } from "@/lib/premium-access";
import { useAuthGuard } from "@/utils/authGuard";
import { useClerk, useUser } from "@clerk/expo";
import { Stack, usePathname, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useScreenHorizontalInsets } from "@/hooks/useScreenInsets";
import { devLog } from "@/lib/logger";
import { Palette } from "@/constants/Palette";

export type SubscriptionStatus = "free" | "quarterly" | "lifetime" | "unknown";

function ProfileField({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string;
  onPress: () => void;
}) {
  const colors = useAppColors();
  return (
    <Pressable
      style={({ pressed }) => [
        styles.section,
        { backgroundColor: colors.card },
        pressed && { backgroundColor: colors.pressed },
      ]}
      onPress={onPress}
    >
      <View style={styles.fieldRow}>
        <View>
          <ThemedText style={[styles.label, { color: colors.text }]}>
            {label}
          </ThemedText>
          <ThemedText style={[styles.value, { color: colors.secondaryText }]}>
            {value || "Not set"}
          </ThemedText>
        </View>
        <IconSymbol
          name={getChevronIcon("right")}
          size={20}
          color={colors.link}
        />
      </View>
    </Pressable>
  );
}

export default function ProfileScreen() {
  const screenInsets = useScreenHorizontalInsets();
  const colors = useAppColors();
  const { signOut } = useClerk();
  const { user } = useUser();
  const router = useRouter();
  const pathname = usePathname();
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  // The user whose account sheet was opened to delete the account (through
  // the deletion warning), or null when it was opened to edit the profile.
  const deletingUserId = useRef<string | null>(null);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const insets = useSafeAreaInsets();
  const {
    isSubscribed,
    subscriptionType,
    isLoading: isSubscriptionLoading,
  } = useSubscription();
  const premiumAccess = resolvePremiumAccess({
    isSubscribed,
    isLoading: isSubscriptionLoading,
  });
  const { requireAuth } = useAuthGuard();
  const { forceSync, refreshAvailableMeets } = useSelectedMeet();

  useEffect(() => {
    devLog("[Profile] Mounted", { pathname, userId: user?.id });
    return () => {
      devLog("[Profile] Unmounted");
    };
  }, [pathname, user?.id]);

  const handleSignOut = async () => {
    try {
      await clearAuthCache();
      await signOut();
      router.replace("/(tabs)/(index)");
    } catch (err) {
      console.error("Error signing out:", err);
      showToast({ type: "error", message: "Failed to sign out. Please try again." });
    }
  };

  const closeAccount = useCallback(() => setIsAccountOpen(false), []);

  const confirmDeleteAccount = () => {
    Alert.alert(ACCOUNT_DELETION_TITLE, accountDeletionMessage(Platform.OS), [
      { text: "Cancel", style: "cancel" },
      {
        text: "Manage Subscription",
        onPress: () => {
          Linking.openURL(subscriptionManagementUrl(Platform.OS)).catch((error) => {
            console.error("Error opening subscription settings:", error);
          });
        },
      },
      {
        text: "Continue",
        style: "destructive",
        onPress: () => {
          deletingUserId.current = user?.id ?? null;
          setIsAccountOpen(true);
        },
      },
    ]);
  };
  // Signed out from inside Clerk's account screen: Clerk already ended the
  // session, so only the app's own auth cache and route are left to reset.
  // Opened to delete the account, the sign-out is the deletion: the device's
  // copy of that user's saved sessions and queued writes goes too (#250).
  const handleSignedOutInAccount = useCallback(() => {
    const deletedUserId = deletingUserId.current;
    deletingUserId.current = null;
    const clearLocal = deletedUserId
      ? clearLocalUserData(deletedUserId).catch((error) => console.error("Error clearing the deleted account's data:", error))
      : Promise.resolve();
    void clearLocal.then(clearAuthCache).finally(() => router.replace("/(tabs)/(index)"));
  }, [router]);

  const sendEmailFeedback = () => {
    const email = "maddisen@meetcal.app";
    const subject = "MeetCal App Feedback";

    const body = [
      "---- Device Info ----",
      `OS: ${Platform.OS} ${Platform.Version}`,
      "",
      "---- User Info ----",
      `Name: ${user?.firstName} ${user?.lastName}`,
      `User ID: ${user?.id}`,
      "",
      "---- Feedback ----",
      "",
    ].join("\n");

    const url = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    Linking.openURL(url).catch((err) => console.error("Error", err));
  };

  const handleClearCache = async () => {
    if (isClearingCache) return;

    setIsClearingCache(true);
    try {
      const outcome = await clearCachedMeetData({
        refreshAvailableMeets,
        refreshSelectedMeet: forceSync,
      });
      showToast(clearCacheToast(outcome));
    } catch (error) {
      console.error("Error clearing cache:", error);
      showToast({ type: "error", message: "Failed to clear cache. Please try again." });
    } finally {
      setIsClearingCache(false);
    }
  };

  return (
    <ThemedView
      style={[styles.container, { backgroundColor: colors.background }, screenInsets]}
    >
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: "My Profile",
          headerTintColor: colors.text,
          headerBackTitle: "Back",
          headerStyle: {
            backgroundColor: colors.background,
          },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: "minimal",
        }}
      />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingHorizontal: 20,
            paddingTop: 20,
            paddingBottom: Math.max(80, insets.bottom + 60),
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <ProfileField
            label="Edit Profile"
            value={user?.primaryEmailAddress?.emailAddress || ""}
            onPress={() => {
              deletingUserId.current = null;
              setIsAccountOpen(true);
            }}
          />
        </View>

        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <NotificationSettings
            // Not "free": before the first answer `subscriptionType` is null,
            // and a subscriber was shown the upgrade prompt.
            subscriptionStatus={subscriptionType ?? "unknown"}
            requireAuth={requireAuth}
            router={router}
          />
          <AutoUnsaveSetting
            premiumAccess={premiumAccess}
            requireAuth={requireAuth}
            router={router}
          />
          <ProfileActionSetting
            label="Widget Settings"
            description={
              Platform.OS === "ios"
                ? "Set filters for large Apple widgets."
                : "Set filters for home screen widgets."
            }
            onPress={() => router.push("/schedule-toolbar/widget-settings")}
          />
          {Platform.OS === "android" && (
            <AndroidCalendarSetting />
          )}
        </View>

        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Pressable
            style={({ pressed }) => [
              styles.section,
              {
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: colors.border,
              },
              pressed && { backgroundColor: colors.pressed },
            ]}
            onPress={async () => {
              try {
                const { default: RevenueCatUI } = await import(
                  "react-native-purchases-ui"
                );
                await RevenueCatUI.presentCustomerCenter();
              } catch (error) {
                console.error("Error opening Customer Center:", error);
                showToast({
                  type: "error",
                  message: "Unable to open Customer Center. Please try again later.",
                });
              }
            }}
          >
            <View style={styles.fieldRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                Customer Support
              </ThemedText>
              <IconSymbol
                name={getChevronIcon("right")}
                size={20}
                color={colors.link}
              />
            </View>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.section,
              {
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: colors.border,
              },
              pressed && { backgroundColor: colors.pressed },
            ]}
            onPress={sendEmailFeedback}
          >
            <View style={styles.fieldRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                Submit Feedback
              </ThemedText>
              <IconSymbol
                name={getChevronIcon("right")}
                size={20}
                color={colors.link}
              />
            </View>
          </Pressable>

          <Pressable
            disabled={isClearingCache}
            style={({ pressed }) => [
              styles.section,
              isClearingCache && styles.disabledSection,
              pressed && !isClearingCache && { backgroundColor: colors.pressed },
            ]}
            onPress={() => {
              if (isClearingCache) return;
              Alert.alert(
                "Clear Cache",
                "This will clear cached meet data on this device and immediately re-sync it.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Clear Cache",
                    style: "destructive",
                    onPress: () => {
                      void handleClearCache();
                    },
                  },
                ],
              );
            }}
          >
            <View style={styles.fieldRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}> 
                {isClearingCache ? "Clearing Cache..." : "Clear Cache"}
              </ThemedText>
              {isClearingCache ? (
                <ActivityIndicator size="small" color={colors.link} />
              ) : (
                <IconSymbol
                  name={getChevronIcon("right")}
                  size={20}
                  color={colors.link}
                />
              )}
            </View>
          </Pressable>
        </View>

        <View style={styles.legalLinks}>
          <Pressable
            onPress={() => Linking.openURL("https://meetcal.app/privacy")}
          >
            <ThemedText style={[styles.legalText, { color: colors.link }]}>
              Privacy Policy
            </ThemedText>
          </Pressable>
          <ThemedText
            style={[styles.legalText, { color: colors.secondaryText }]}
          >
            {" "}
            •
{" "}
          </ThemedText>
          <Pressable
            onPress={() => Linking.openURL("https://meetcal.app/terms")}
          >
            <ThemedText style={[styles.legalText, { color: colors.link }]}>
              Terms of Use
            </ThemedText>
          </Pressable>
          <ThemedText
            style={[styles.legalText, { color: colors.secondaryText }]}
          >
            {" "}
            •
{" "}
          </ThemedText>
          <Pressable
            onPress={() =>
              Linking.openURL(
                Platform.OS === "ios"
                  ? "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/"
                  : "https://meetcal.app/eula",
              )
            }
          >
            <ThemedText style={[styles.legalText, { color: colors.link }]}>
              User Agreement
            </ThemedText>
          </Pressable>
        </View>
        <Pressable
          onPress={confirmDeleteAccount}
          accessibilityRole="button"
          style={{ alignSelf: "center", marginBottom: 8 }}
        >
          <ThemedText style={[styles.legalText, { color: colors.link }]}>
            Delete Your Account
          </ThemedText>
        </Pressable>

        <TouchableOpacity
          style={styles.signOutButton}
          onPress={handleSignOut}
        >
          <ThemedText style={styles.signOutButtonText}>Sign Out</ThemedText>
        </TouchableOpacity>
      </ScrollView>

      <ClerkAccountModal
        visible={isAccountOpen}
        onClose={closeAccount}
        onSignedOut={handleSignedOutInAccount}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  card: {
    borderRadius: 12,
    marginBottom: 16,
    shadowColor: Palette.shadow,
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
    overflow: "hidden",
  },
  section: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  disabledSection: {
    opacity: 0.65,
  },
  fieldRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  label: {
    fontSize: 16,
    fontWeight: "500",
    marginBottom: 4,
  },
  value: {
    fontSize: 15,
  },
  signOutButton: {
    backgroundColor: Palette.systemRed,
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 14,
  },
  signOutButtonText: {
    color: Palette.white,
    fontSize: 17,
    fontWeight: "600",
  },
  legalLinks: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
  },
  legalText: {
    fontSize: 14,
  },
});
