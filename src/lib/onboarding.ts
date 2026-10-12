import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  CURRENT_VERSION,
  parseSeenVersions,
  VERSION_ANNOUNCEMENT_KEY,
} from "@/config/version-announcements";

const ONBOARDING_COMPLETED_KEY = "@onboarding_completed";

/** Pages in `OnboardingView`; the last asks for calendar and notification access. */
export const ONBOARDING_PAGE_COUNT = 9;

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

/** Record `version`'s "What's New" announcement as seen. */
export async function markVersionAnnouncementSeen(
  version: string = CURRENT_VERSION,
): Promise<void> {
  const stored = await AsyncStorage.getItem(VERSION_ANNOUNCEMENT_KEY);
  const seenVersions = parseSeenVersions(stored);
  if (!seenVersions.includes(version)) {
    await AsyncStorage.setItem(
      VERSION_ANNOUNCEMENT_KEY,
      JSON.stringify([...seenVersions, version]),
    );
  }
}

/**
 * Onboarding is finished (Done, or backed out of on the last page). The
 * current version's "What's New" is marked seen with it: on a fresh install
 * it described changes to an app the user had never used, and it stacked a
 * second modal on top of onboarding.
 */
export async function completeOnboarding(): Promise<void> {
  await AsyncStorage.setItem(ONBOARDING_COMPLETED_KEY, "true");
  try {
    await markVersionAnnouncementSeen();
  } catch (error) {
    console.error("Error marking version announcement seen:", error);
  }
}

/**
 * Where Skip (and Android back) goes from `page`: the tour jumps to the last
 * page, which explains the permission prompts; back on the last page leaves
 * onboarding without prompting.
 */
export function onboardingSkipAction(page: number): { kind: "page"; page: number } | { kind: "finish" } {
  return page < ONBOARDING_PAGE_COUNT
    ? { kind: "page", page: ONBOARDING_PAGE_COUNT }
    : { kind: "finish" };
}
