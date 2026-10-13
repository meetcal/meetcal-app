import AsyncStorage from "@react-native-async-storage/async-storage";
import { accountDeletionMessage, clearLocalUserData, subscriptionManagementUrl } from "@/lib/account-deletion";

describe("account deletion", () => {
  it.each([
    ["ios", "the App Store"],
    ["android", "Google Play"],
  ])("on %s, says what is lost and that the %s subscription is separate", (os, store) => {
    const message = accountDeletionMessage(os);
    expect(message).toMatch(/saved sessions, notes and reminder settings/);
    expect(message).toContain(`does not cancel your subscription. Cancel it in ${store}`);
    expect(message).toMatch(/Delete account/);
  });

  it("links to the platform's subscription management, not a sign-in page", () => {
    expect(subscriptionManagementUrl("ios")).toBe("https://apps.apple.com/account/subscriptions");
    expect(subscriptionManagementUrl("android")).toBe(
      "https://play.google.com/store/account/subscriptions",
    );
  });

  it("clears only the deleted user's saved sessions and outbox from the device", async () => {
    await AsyncStorage.multiSet([
      ["@saved_sessions_user_1", "[]"],
      ["@saved_sessions_outbox_user_1", "[]"],
      ["@saved_sessions_outbox_seeded_user_1", "1"],
      // Keys older builds stored saved sessions under.
      ["savedSessions_user_1", "[]"],
      ["@savedSessions_user_1", "[]"],
      ["sessions_user_1", "[]"],
      ["@saved_sessions_user_2", "[]"],
    ]);
    await clearLocalUserData("user_1");
    expect(await AsyncStorage.getAllKeys()).toEqual(["@saved_sessions_user_2"]);
  });
});
