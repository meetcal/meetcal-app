import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  CURRENT_VERSION,
  VERSION_ANNOUNCEMENT_KEY,
} from "@/config/version-announcements";
import {
  checkOnboardingComplete,
  completeOnboarding,
  markVersionAnnouncementSeen,
  ONBOARDING_PAGE_COUNT,
  onboardingSkipAction,
  resetOnboarding,
} from "@/lib/onboarding";

describe("onboarding", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("marks the current What's New as seen when onboarding completes", async () => {
    await AsyncStorage.setItem(VERSION_ANNOUNCEMENT_KEY, JSON.stringify(["6.0.0"]));
    expect(await checkOnboardingComplete()).toBe(false);

    await completeOnboarding();

    expect(await checkOnboardingComplete()).toBe(true);
    expect(JSON.parse((await AsyncStorage.getItem(VERSION_ANNOUNCEMENT_KEY)) ?? "null")).toEqual([
      "6.0.0",
      CURRENT_VERSION,
    ]);
  });

  it("overwrites an unreadable seen-list and does not duplicate a seen version", async () => {
    await AsyncStorage.setItem(VERSION_ANNOUNCEMENT_KEY, "{not json");
    await markVersionAnnouncementSeen("9.9.9");
    await markVersionAnnouncementSeen("9.9.9");
    expect(await AsyncStorage.getItem(VERSION_ANNOUNCEMENT_KEY)).toBe(JSON.stringify(["9.9.9"]));
  });

  it("can be reset", async () => {
    await completeOnboarding();
    await resetOnboarding();
    expect(await checkOnboardingComplete()).toBe(false);
  });

  it("skips the tour to the permissions page, and backs out from there", () => {
    expect(onboardingSkipAction(1)).toEqual({ kind: "page", page: ONBOARDING_PAGE_COUNT });
    expect(onboardingSkipAction(ONBOARDING_PAGE_COUNT - 1)).toEqual({
      kind: "page",
      page: ONBOARDING_PAGE_COUNT,
    });
    expect(onboardingSkipAction(ONBOARDING_PAGE_COUNT)).toEqual({ kind: "finish" });
  });
});
