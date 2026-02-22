import { ThemedText } from "@/components/ui/ThemedText";
import { useAppColors } from "@/hooks/useAppColors";
import { OnboardingViewProps } from "@/types/schedule";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Calendar from "expo-calendar";
import * as Notifications from "expo-notifications";
import React, { useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, View } from "react-native";

const ONBOARDING_COMPLETED_KEY = "@onboarding_completed";

function OnboardingPage({ pageCounter }: { pageCounter: number }) {
  const colors = useAppColors();
  switch (pageCounter) {
    case 1:
      return (
        <View style={styles.pageContent}>
          <ThemedText style={[styles.title, { color: colors.text }]}>
            👋 Welcome to MeetCal!
          </ThemedText>
          <ThemedText style={[styles.description, { color: colors.text }]}>
            We have 6 main features that help you have as much data as
            possible to compete and coach your best at meets.
          </ThemedText>
        </View>
      );
    case 2:
      return (
        <View style={styles.pageContent}>
          <ThemedText style={[styles.title, { color: colors.text }]}>
            📅 Schedule View
          </ThemedText>
          <ThemedText style={[styles.description, { color: colors.text }]}>
            We have the Schedule and Start List for all USAW National meets,
            WSO meets, and all USAMW competitions. On this page you can swipe
            left to see each day of the meet.
          </ThemedText>
        </View>
      );
    case 3:
      return (
        <View style={styles.pageContent}>
          <ThemedText style={[styles.title, { color: colors.text }]}>
            📋 Schedule Details
          </ThemedText>
          <ThemedText style={[styles.description, { color: colors.text }]}>
            After selecting a session you&apos;ll see all the athletes in the
            session. Alongside that you&apos;ll see age, club, weight class,
            entry total, and all their USAW meet results.
          </ThemedText>
        </View>
      );
    case 4:
      return (
        <View style={styles.pageContent}>
          <ThemedText style={[styles.title, { color: colors.text }]}>
            🥇 Start List
          </ThemedText>
          <ThemedText style={[styles.description, { color: colors.text }]}>
            Click the search button in the bottom right to see the entire
            Start List. In here you can filter through the start list to get
            all the info you need.
          </ThemedText>
        </View>
      );
    case 5:
      return (
        <View style={styles.pageContent}>
          <ThemedText style={[styles.title, { color: colors.text }]}>
            📸 Share Start Lists
          </ThemedText>
          <ThemedText style={[styles.description, { color: colors.text }]}>
            Pro members can also create and share Start Lists for their club
            on this page. Easily share when and where your athletes will be
            lifting.
          </ThemedText>
        </View>
      );
    case 6:
      return (
        <View style={styles.pageContent}>
          <ThemedText style={[styles.title, { color: colors.text }]}>
            🏋️‍♀️ Competition Data
          </ThemedText>
          <ThemedText style={[styles.description, { color: colors.text }]}>
            Click the tab in the bottom right and you&apos;ll have all the
            pertinent competition data you&apos;ll need such as: Qualifying
            Totals, A/B Standards, American and WSO Records, and International
            Rankings.
          </ThemedText>
        </View>
      );
    case 7:
      return (
        <View style={styles.pageContent}>
          <ThemedText style={[styles.title, { color: colors.text }]}>
            📲 Saved Sessions
          </ThemedText>
          <ThemedText style={[styles.description, { color: colors.text }]}>
            Through the Start List and Session Details pages you can save
            important sessions both in the app and right to your calendar.
            From there you&apos;ll get push notifications 60 minutes before
            the session begins.
          </ThemedText>
        </View>
      );
    case 8:
      return (
        <View style={styles.pageContent}>
          <ThemedText style={[styles.title, { color: colors.text }]}>
            ⬇️ Download
          </ThemedText>
          <ThemedText style={[styles.description, { color: colors.text }]}>
            Need to view schedules offline? Download any meet schedule and
            competition data to access session details, start lists, and
            records even without an internet connection.
          </ThemedText>
        </View>
      );
    case 9:
      return (
        <View style={styles.pageContent}>
          <ThemedText style={[styles.title, { color: colors.text }]}>
            Calendar & Notification Access
          </ThemedText>
          <ThemedText style={[styles.description, { color: colors.text }]}>
            We ask for access to write to your calendar and to send you
            notifications. This allows us to put sessions on your calendar,
            alert you ahead of your session, and send updates such as platform
            changes.
          </ThemedText>
        </View>
      );
    default:
      return null;
  }
}

export function OnboardingView({ visible, onComplete }: OnboardingViewProps) {
  const colors = useAppColors();
  const [pageCounter, setPageCounter] = useState(1);

  const requestCalendarAccess = async () => {
    try {
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      if (status === "granted") {
        if (__DEV__) {
          console.log("Calendar access granted");
        }
      } else {
        if (__DEV__) {
          console.log("Calendar access denied");
        }
      }
    } catch (error) {
      if (__DEV__) {
        console.error("Calendar permission error:", error);
      }
    }
  };

  const requestNotificationAccess = async () => {
    try {
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("default", {
          name: "default",
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: "#FF231F7C",
        });
      }

      const { status } = await Notifications.requestPermissionsAsync();
      if (status === "granted") {
        if (__DEV__) {
          console.log("Notification access granted");
        }
        await AsyncStorage.setItem("@notification_enabled", "true");
      } else {
        if (__DEV__) {
          console.log("Notification access denied");
        }
        await AsyncStorage.setItem("@notification_enabled", "false");
      }
    } catch (error) {
      if (__DEV__) {
        console.error("Notification permission error:", error);
      }
    }
  };

  const requestPermissions = async () => {
    await Promise.all([requestCalendarAccess(), requestNotificationAccess()]);
    await AsyncStorage.setItem(ONBOARDING_COMPLETED_KEY, "true");
    onComplete();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => {}}
    >
      <Pressable style={styles.modalOverlay}>
        <Pressable
          style={[styles.container, { backgroundColor: colors.card }]}
          onPress={(e) => e.stopPropagation()}
        >
          <OnboardingPage pageCounter={pageCounter} />

          <Pressable
            style={({ pressed }) => [
              styles.button,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => {
              if (pageCounter === 9) {
                requestPermissions();
              } else {
                setPageCounter(prev => prev + 1);
              }
            }}
          >
            <ThemedText style={styles.buttonText}>
              {pageCounter === 9 ? "Done" : "Next"}
            </ThemedText>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  container: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: Platform.OS === "ios" ? 40 : 24,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: -2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
  },
  pageContent: {
    alignItems: "flex-start",
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 16,
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    paddingBottom: 16,
  },
  button: {
    backgroundColor: "#007AFF",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    minHeight: 50,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(128, 128, 128, 0.2)",
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
  },
});

export async function checkOnboardingComplete(): Promise<boolean> {
  try {
    const completed = await AsyncStorage.getItem(ONBOARDING_COMPLETED_KEY);
    return completed === "true";
  } catch (error) {
    console.error("Error checking onboarding status:", error);
    return false;
  }
}

export async function resetOnboarding(): Promise<void> {
  try {
    await AsyncStorage.removeItem(ONBOARDING_COMPLETED_KEY);
  } catch (error) {
    console.error("Error resetting onboarding:", error);
  }
}
