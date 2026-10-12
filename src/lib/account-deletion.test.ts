import { accountDeletionMessage, subscriptionManagementUrl } from "@/lib/account-deletion";

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
});
