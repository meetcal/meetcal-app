import {
  createAppDeepLink,
  createIntlRankingsDeepLink,
  createQualifyingTotalsDeepLink,
  createRecordsDeepLink,
  createSessionDetailsDeepLink,
  createStandardsDeepLink,
  getNotificationDeepLink,
  getOneSignalDeepLink,
  normalizeDeepLinkHref,
} from "@/utils/deepLinks";

describe("deep link helpers", () => {
  it("creates app deep links with encoded query params", () => {
    expect(createAppDeepLink("/schedule-toolbar/widget-settings")).toBe(
      "meetcal:///schedule-toolbar/widget-settings",
    );

    expect(
      createSessionDetailsDeepLink({
        id: "Nationals-1-Red",
        meet: "National Championships",
        sessionNumber: 1,
        platform: "Red",
        weightClass: "M 89",
        startTime: "10:30 AM",
        weighInTime: "",
      }),
    ).toBe(
      "meetcal:///shared-screens/schedule-details?id=Nationals-1-Red&meet=National+Championships&sessionNumber=1&platform=Red&weightClass=M+89&startTime=10%3A30+AM",
    );
  });

  it("creates filtered data widget deep links", () => {
    expect(
      createQualifyingTotalsDeepLink({
        event: "Nationals",
        gender: "Women",
        ageGroup: "Junior",
      }),
    ).toBe(
      "meetcal:///comp-data/new-qualifying-totals?event=Nationals&gender=Women&ageGroup=Junior",
    );

    expect(
      createStandardsDeepLink({
        gender: "women",
        ageGroup: "u15",
      }),
    ).toBe("meetcal:///comp-data/new-standards?gender=women&ageGroup=u15");

    expect(
      createIntlRankingsDeepLink({
        meet: "2026 World Masters Championships",
        ageCategory: "Senior",
        gender: "Men",
      }),
    ).toBe(
      "meetcal:///comp-data/rankings?meet=2026+World+Masters+Championships&age_category=Senior&gender=Men",
    );

    expect(createRecordsDeepLink()).toBe("meetcal:///comp-data/records");
  });

  it("normalizes custom-scheme URLs to router hrefs", () => {
    expect(normalizeDeepLinkHref("meetcal:///open/saved")).toBe("/open/saved");
    expect(normalizeDeepLinkHref("meetcal://open/saved")).toBe("/open/saved");
    expect(normalizeDeepLinkHref("/schedule-toolbar/widget-settings")).toBe(
      "/schedule-toolbar/widget-settings",
    );
    expect(normalizeDeepLinkHref("https://meetcal.app/open/saved")).toBeNull();
  });

  it("extracts links from local notification data aliases", () => {
    expect(getNotificationDeepLink({ url: "meetcal:///open/saved" })).toBe(
      "meetcal:///open/saved",
    );
    expect(getNotificationDeepLink({ deepLink: "/open/saved" })).toBe(
      "/open/saved",
    );
    expect(getNotificationDeepLink({ deeplink: "/open/saved" })).toBe(
      "/open/saved",
    );
    expect(getNotificationDeepLink({ route: "/open/saved" })).toBe(
      "/open/saved",
    );
    expect(getNotificationDeepLink({ url: "" })).toBeNull();
  });

  it("extracts links from OneSignal click events", () => {
    expect(
      getOneSignalDeepLink({
        result: { url: "meetcal:///schedule-toolbar/widget-settings" },
        notification: {
          launchURL: "meetcal:///open/saved",
          additionalData: { route: "/open/saved" },
        },
      }),
    ).toBe("meetcal:///schedule-toolbar/widget-settings");

    expect(
      getOneSignalDeepLink({
        notification: {
          additionalData: { route: "/shared-screens/schedule-details" },
        },
      }),
    ).toBe("/shared-screens/schedule-details");
  });
});
