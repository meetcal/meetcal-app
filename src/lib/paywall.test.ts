import { paywallErrorCopy, paywallExitFor } from "@/lib/paywall";

describe("paywallExitFor", () => {
  it("returns to the origin on dismiss, inline or routed", () => {
    for (const inline of [true, false]) {
      expect(paywallExitFor({ event: "dismiss", inline, hasEntitlement: false })).toBe("return");
    }
  });

  it("stays put inline after a purchase or restore so the gate re-renders", () => {
    expect(paywallExitFor({ event: "purchase", inline: true, hasEntitlement: true })).toBe("stay");
    expect(paywallExitFor({ event: "restore", inline: true, hasEntitlement: true })).toBe("stay");
  });

  it("returns when routed after a purchase or a restore that found the entitlement", () => {
    expect(paywallExitFor({ event: "purchase", inline: false, hasEntitlement: true })).toBe("return");
    expect(paywallExitFor({ event: "restore", inline: false, hasEntitlement: true })).toBe("return");
  });

  it("says so when a restore finds nothing, instead of exiting as if it worked", () => {
    for (const inline of [true, false]) {
      expect(paywallExitFor({ event: "restore", inline, hasEntitlement: false })).toBe(
        "nothing-restored",
      );
    }
  });
});

describe("paywallErrorCopy", () => {
  it("tells offline apart from a failed or empty load", () => {
    expect(paywallErrorCopy("offline").title).toBe("You're offline");
    expect(paywallErrorCopy("failed").title).toBe("Couldn't load plans");
    expect(paywallErrorCopy("empty").title).toBe("No plans available");
  });
});
