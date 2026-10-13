import { confirmedSubscriptionFor } from "@/lib/confirmed-entitlement";

describe("confirmedSubscriptionFor", () => {
  it("is the answer only for the user it was about", () => {
    const answer = { appUserId: "user_a", isSubscribed: true };
    expect(confirmedSubscriptionFor(answer, "user_a")).toBe(true);
    // Switched to another account: the previous subscriber's answer is not it.
    expect(confirmedSubscriptionFor(answer, "user_b")).toBeNull();
    expect(confirmedSubscriptionFor({ appUserId: null, isSubscribed: true }, "user_a")).toBeNull();
  });

  it("is unknown with no answer or no user", () => {
    expect(confirmedSubscriptionFor(null, "user_a")).toBeNull();
    expect(confirmedSubscriptionFor({ appUserId: "user_a", isSubscribed: true }, null)).toBeNull();
  });

  it("applies the dev simulation to whoever is signed in", () => {
    expect(confirmedSubscriptionFor({ appUserId: null, isSubscribed: false, simulated: true }, "user_a")).toBe(false);
  });
});
