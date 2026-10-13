import { ThemedText } from "@/components/ui/ThemedText";
import { useAppColors } from "@/hooks/useAppColors";
import { useScreenHorizontalInsets } from "@/hooks/useScreenInsets";
import { OnboardingViewProps } from "@/types/schedule";
import {
  ensureReminderChannel,
  NOTIFICATION_PROMPT_SHOWN_KEY,
} from "@/utils/notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Calendar from "expo-calendar/legacy";
import * as Notifications from "expo-notifications";
import React, { useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, View } from "react-native";
import { devLog } from "@/lib/logger";
import {
  completeOnboarding,
  ONBOARDING_PAGE_COUNT,
  onboardingSkipAction,
} from "@/lib/onboarding";
import { BlackAlpha, Palette } from "@/constants/Palette";

// Moved to `lib/onboarding.ts` so the root layout can read them without
// loading this view; re-exported for the screens that import them here.
export { checkOnboardingComplete, resetOnboarding } from "@/lib/onboarding";

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
            Here&apos;s a quick tour of the features that give you as much
            data as possible to compete and coach your best at meets.
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
            Tap the Start List tab (the list icon) to see the entire Start
            List. In here you can filter through the start list to get all
            the info you need.
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
            Tap the Info tab (the &quot;i&quot; icon) and you&apos;ll have all
            the pertinent competition data you&apos;ll need such as:
            Qualifying Totals, A/B Standards, American and WSO Records, and
            International Rankings.
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
          <View style={{flexDirection: 'row', alignItems: 'baseline'}}>
            <ThemedText style={[{fontSize: 20, fontWeight: "bold", marginBottom: 16,}, { color: colors.text }]}>
              ⬇️
            </ThemedText>
            <ThemedText style={[styles.title, { color: colors.text, paddingLeft: 4 }]}>
              Download
            </ThemedText>
          </View>
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
  // A modal is above every screen's padding: clear the Duo band here.
  const screenInsets = useScreenHorizontalInsets();
  const [pageCounter, setPageCounter] = useState(1);

  const requestCalendarAccess = async () => {
    try {
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      devLog(
        status === "granted"
          ? "Calendar access granted"
          : "Calendar access denied",
      );
    } catch (error) {
      if (__DEV__) {
        console.error("Calendar permission error:", error);
      }
    }
  };

  const requestNotificationAccess = async () => {
    try {
      // Android 13+ shows the prompt only once a channel exists.
      await ensureReminderChannel();

      const { status } = await Notifications.requestPermissionsAsync();
      const granted = status === "granted";
      devLog(
        granted ? "Notification access granted" : "Notification access denied",
      );
      // Only that the prompt was shown. Turning reminders on is the Profile
      // switch's job: reminders are a premium feature, and writing the flag
      // here for every user gave free users reminders that Profile showed as
      // off and locked. Subscribers who never choose get them by default.
      await AsyncStorage.setItem(NOTIFICATION_PROMPT_SHOWN_KEY, "true");
    } catch (error) {
      if (__DEV__) {
        console.error("Notification permission error:", error);
      }
    }
  };

  const finish = async () => {
    try {
      await completeOnboarding();
    } catch (error) {
      console.error("Error saving onboarding status:", error);
    }
    onComplete();
  };

  const requestPermissions = async () => {
    await Promise.all([requestCalendarAccess(), requestNotificationAccess()]);
    await finish();
  };

  // Skip and Android back: there was no way out of nine pages, and back was
  // swallowed.
  const skip = () => {
    const action = onboardingSkipAction(pageCounter);
    if (action.kind === "page") {
      setPageCounter(action.page);
    } else {
      void finish();
    }
  };

  const isLastPage = pageCounter === ONBOARDING_PAGE_COUNT;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={skip}
    >
      <Pressable style={[styles.modalOverlay, screenInsets]}>
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
              if (isLastPage) {
                requestPermissions();
              } else {
                setPageCounter(prev => prev + 1);
              }
            }}
          >
            <ThemedText style={styles.buttonText}>
              {isLastPage ? "Done" : "Next"}
            </ThemedText>
          </Pressable>

          {!isLastPage && (
            <Pressable
              style={({ pressed }) => [
                styles.skipButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={skip}
              accessibilityRole="button"
              accessibilityLabel="Skip the tour"
              hitSlop={8}
            >
              <ThemedText style={[styles.skipButtonText, { color: colors.secondaryText }]}>
                Skip
              </ThemedText>
            </Pressable>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: BlackAlpha[50],
    justifyContent: "flex-end",
  },
  container: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: Platform.OS === "ios" ? 40 : 24,
    shadowColor: Palette.shadow,
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
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 16,
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    paddingBottom: 16,
  },
  button: {
    backgroundColor: Palette.systemBlue,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    minHeight: 50,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Palette.neutralBorder,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonText: {
    color: Palette.white,
    fontSize: 17,
    fontWeight: "600",
  },
  skipButton: {
    alignSelf: "center",
    marginTop: 12,
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  skipButtonText: {
    fontSize: 15,
    fontWeight: "500",
  },
});
