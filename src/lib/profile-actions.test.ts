import {
  FEEDBACK_EMAIL,
  feedbackMailtoUrl,
  signOutThenForgetHint,
  type FeedbackContext,
} from "@/lib/profile-actions";

describe("signOutThenForgetHint", () => {
  it("forgets the offline hint only after Clerk's sign-out succeeds", async () => {
    const calls: string[] = [];
    await signOutThenForgetHint(
      async () => {
        calls.push("signOut");
      },
      async () => {
        calls.push("forgetHint");
      },
    );
    expect(calls).toEqual(["signOut", "forgetHint"]);
  });

  it("keeps the hint when sign-out fails, and rethrows", async () => {
    const forgetHint = jest.fn(async () => {});
    await expect(
      signOutThenForgetHint(async () => {
        throw new Error("network");
      }, forgetHint),
    ).rejects.toThrow("network");
    expect(forgetHint).not.toHaveBeenCalled();
  });

  it("does not report a failed sign-out when only the hint fails to clear", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      signOutThenForgetHint(
        async () => {},
        async () => {
          throw new Error("keychain");
        },
      ),
    ).resolves.toBeUndefined();
    jest.restoreAllMocks();
  });
});

describe("feedbackMailtoUrl", () => {
  const base: FeedbackContext = {
    os: "ios",
    osVersion: "27.1",
    appVersion: "6.2.0",
    buildVersion: "412",
    updateId: "0f1e2d3c",
    user: { id: "user_1", firstName: "Jane", lastName: "Doe" },
  };

  function body(url: string): string {
    return decodeURIComponent(url.split("&body=")[1]);
  }

  it("addresses the feedback inbox with the device, app and update", () => {
    const url = feedbackMailtoUrl(base);
    expect(url.startsWith(`mailto:${FEEDBACK_EMAIL}?subject=`)).toBe(true);
    expect(body(url)).toContain("OS: ios 27.1");
    expect(body(url)).toContain("App Version: 6.2.0 (412)");
    expect(body(url)).toContain("Update: 0f1e2d3c");
    expect(body(url)).toContain("Name: Jane Doe");
    expect(body(url)).toContain("User ID: user_1");
  });

  it("never writes 'null' for missing name parts or an embedded build", () => {
    const url = feedbackMailtoUrl({
      ...base,
      appVersion: null,
      buildVersion: null,
      updateId: null,
      user: { id: "user_2", firstName: null, lastName: null },
    });
    expect(body(url)).not.toContain("null");
    expect(body(url)).toContain("Name: Not provided");
    expect(body(url)).toContain("App Version: Unknown");
    expect(body(url)).toContain("Update: Embedded");

    const firstOnly = feedbackMailtoUrl({ ...base, user: { id: "u", firstName: "Jane", lastName: null } });
    expect(body(firstOnly)).toContain("Name: Jane\n");
  });

  it("says when no user is signed in", () => {
    expect(body(feedbackMailtoUrl({ ...base, user: null }))).toContain("User ID: Signed out");
  });
});
