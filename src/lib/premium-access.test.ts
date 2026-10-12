import {
  premiumActionFor,
  premiumPendingToast,
  resolvePremiumAccess,
} from "@/lib/premium-access";

describe("resolvePremiumAccess", () => {
  it("lets a known answer win, even during a background refresh", () => {
    expect(resolvePremiumAccess({ isSubscribed: true, isLoading: false })).toBe("granted");
    expect(resolvePremiumAccess({ isSubscribed: true, isLoading: true })).toBe("granted");
    expect(resolvePremiumAccess({ isSubscribed: false, isLoading: false })).toBe("denied");
    expect(resolvePremiumAccess({ isSubscribed: false, isLoading: true })).toBe("denied");
  });

  it("splits unknown into checking (a check in flight) and unknown (none)", () => {
    expect(resolvePremiumAccess({ isSubscribed: null, isLoading: true })).toBe("checking");
    expect(resolvePremiumAccess({ isSubscribed: null, isLoading: false })).toBe("unknown");
  });
});

describe("premiumActionFor", () => {
  it("proceeds when granted and opens the paywall only when denied", () => {
    expect(premiumActionFor("granted")).toEqual({ kind: "proceed" });
    expect(premiumActionFor("denied")).toEqual({ kind: "paywall" });
  });

  it.each(["checking", "unknown"] as const)(
    "never opens the paywall while %s; it tells the user instead",
    (access) => {
      expect(premiumActionFor(access)).toEqual({
        kind: "notify",
        toast: premiumPendingToast(access),
      });
    },
  );

  it("words checking and unknown differently", () => {
    expect(premiumPendingToast("checking").message).toMatch(/checking/i);
    expect(premiumPendingToast("unknown").message).toMatch(/connect to the internet/i);
  });
});
