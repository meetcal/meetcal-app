import { AndroidCalendarSetting } from "@/components/profile/AndroidCalendarSetting";
import { AutoUnsaveSetting } from "@/components/profile/AutoUnsaveSetting";
import EditProfileModal from "@/components/profile/EditProfileModal";
import { NotificationSettings } from "@/components/profile/NotificationSettings";
import { ProfileActionSetting } from "@/components/profile/ProfileActionSetting";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { ThemedText } from "@/components/ui/ThemedText";
import { ThemedView } from "@/components/ui/ThemedView";
import { useSelectedMeet } from "@/contexts/SelectedMeetContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useAppColors } from "@/hooks/useAppColors";
import { clearAuthCache } from "@/lib/authCache";
import { clearCachedMeetsList } from "@/lib/database/meet-manager";
import {
  clearAllAthleteHistory,
  clearAllMeetData,
} from "@/lib/database/offline-store";
import { useAuthGuard } from "@/utils/authGuard";
import { useClerk, useUser } from "@clerk/expo";
import { Stack, usePathname, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
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

export type EditableField = "firstName" | "lastName" | "email";
export type SubscriptionStatus = "free" | "quarterly" | "lifetime" | "unknown";

function ProfileField({
  label,
  value,
  field,
  onEdit,
}: {
  label: string;
  value: string;
  field: EditableField;
  onEdit: (field: EditableField) => void;
}) {
  const colors = useAppColors();
  return (
    <Pressable
      style={({ pressed }) => [
        styles.section,
        { backgroundColor: colors.card },
        pressed && { backgroundColor: colors.pressed },
      ]}
      onPress={() => onEdit(field)}
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
          name={Platform.OS === "ios" ? "chevron.right" : "chevron-forward"}
          size={20}
          color={colors.link}
        />
      </View>
    </Pressable>
  );
}

export default function ProfileScreen() {
  const colors = useAppColors();
  const { signOut } = useClerk();
  const { user } = useUser();
  const router = useRouter();
  const pathname = usePathname();
  const [isEditing, setIsEditing] = useState(false);
  const [editingField, setEditingField] = useState<EditableField | null>(null);
  const [editValue, setEditValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const insets = useSafeAreaInsets();
  const { isSubscribed, subscriptionType } = useSubscription();
  const { requireAuth } = useAuthGuard();
  const { forceSync, refreshAvailableMeets } = useSelectedMeet();

  useEffect(() => {
    if (__DEV__) {
      console.log("[Profile] Mounted", { pathname, userId: user?.id });
    }
    return () => {
      if (__DEV__) {
        console.log("[Profile] Unmounted");
      }
    };
  }, [pathname, user?.id]);

  const handleSignOut = async () => {
    try {
      await clearAuthCache();
      await signOut();
      router.replace("/(tabs)/(index)");
    } catch (err) {
      console.error("Error signing out:", err);
      Alert.alert("Error", "Failed to sign out. Please try again.");
    }
  };

  const handleEdit = (field: EditableField) => {
    let currentValue = "";
    switch (field) {
      case "firstName":
        currentValue = user?.firstName || "";
        break;
      case "lastName":
        currentValue = user?.lastName || "";
        break;
      case "email":
        currentValue = user?.primaryEmailAddress?.emailAddress || "";
        break;
    }
    setEditValue(currentValue);
    setEditingField(field);
    setIsEditing(true);
  };

  const sendEmailFeedback = async () => {
    const email = "maddisen@meetcal.app";
    const subject = "MeetCal App Feedback";

    let manufacturer = "";
    let device = "";
    let deviceType = "";
    try {
      const { getManufacturer, getDevice, getDeviceType } = await import(
        "react-native-device-info"
      );
      manufacturer = await getManufacturer();
      device = await getDevice();
      deviceType = getDeviceType();
    } catch (err) {
      console.error("Error getting device info:", err);
    }

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
      await clearAllMeetData();
      await clearAllAthleteHistory();
      await clearCachedMeetsList();
      await refreshAvailableMeets();
      await forceSync();
      Alert.alert(
        "Cache Cleared",
        "Cached meet data has been cleared and refreshed.",
      );
    } catch (error) {
      console.error("Error clearing cache:", error);
      Alert.alert("Error", "Failed to clear cache. Please try again.");
    } finally {
      setIsClearingCache(false);
    }
  };

  const divider = (
    <View style={[styles.sectionDivider, { backgroundColor: colors.border }]} />
  );

  return (
    <ThemedView
      style={[styles.container, { backgroundColor: colors.background }]}
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
            label="First Name"
            value={user?.firstName || ""}
            field="firstName"
            onEdit={handleEdit}
          />
          {divider}
          <ProfileField
            label="Last Name"
            value={user?.lastName || ""}
            field="lastName"
            onEdit={handleEdit}
          />
          {divider}
          <ProfileField
            label="Email"
            value={user?.primaryEmailAddress?.emailAddress || ""}
            field="email"
            onEdit={handleEdit}
          />
        </View>

        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <NotificationSettings
            colors={colors}
            subscriptionStatus={subscriptionType || "free"}
            requireAuth={requireAuth}
            router={router}
          />
          <AutoUnsaveSetting
            colors={colors}
            isSubscribed={Boolean(isSubscribed)}
            requireAuth={requireAuth}
            router={router}
          />
          <ProfileActionSetting
            colors={colors}
            label="Widget Settings"
            description={
              Platform.OS === "ios"
                ? "Set filters for large Apple widgets."
                : "Set filters for home screen widgets."
            }
            onPress={() => router.push("/schedule-toolbar/widget-settings")}
          />
          {Platform.OS === "android" && (
            <AndroidCalendarSetting colors={colors} />
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
                Alert.alert(
                  "Error",
                  "Unable to open Customer Center. Please try again later.",
                );
              }
            }}
          >
            <View style={styles.fieldRow}>
              <ThemedText style={[styles.label, { color: colors.text }]}>
                Customer Support
              </ThemedText>
              <IconSymbol
                name={Platform.OS === "ios" ? "chevron.right" : "chevron-forward"}
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
                name={Platform.OS === "ios" ? "chevron.right" : "chevron-forward"}
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
                  name={Platform.OS === "ios" ? "chevron.right" : "chevron-forward"}
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
          onPress={() =>
            Linking.openURL(`https://accounts.meetcal.app/sign-in`)
          }
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

      <EditProfileModal
        isEditing={isEditing}
        setIsEditing={setIsEditing}
        editingField={editingField}
        setEditingField={setEditingField}
        editValue={editValue}
        setEditValue={setEditValue}
        setIsLoading={setIsLoading}
        isLoading={isLoading}
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
    shadowColor: "#000",
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
  sectionDivider: {
    height: 1,
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
    backgroundColor: "#FF3B30",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 14,
  },
  signOutButtonText: {
    color: "#FFFFFF",
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
