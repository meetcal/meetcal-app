import {
  createAppDeepLink,
  createIntlRankingsDeepLink,
  createQualifyingTotalsDeepLink,
  createRecordsDeepLink,
  createSessionDetailsDeepLink,
  createStandardsDeepLink,
  deepLinkOpensPath,
  getNotificationDeepLink,
  getOneSignalDeepLink,
  normalizeDeepLinkHref,
} from "@/utils/deepLinks";

describe("deep link helpers", () => {
  it("runs against expo's URL, the one the app ships with", () => {
    // jest-expo installs expo's winter `URL` and marks it with this symbol.
    // Without it these tests would silently exercise Node's `URL`, whose
    // handling of a `meetcal:///` scheme is not what the device runs.
    const marker = (globalThis.URL as unknown as Record<symbol, unknown>)[
      Symbol.for("expo.builtin")
    ];
    expect(marker).toBeDefined();
  });

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

  it("rejects protocol-relative paths, the same rule as sign-in return paths", () => {
    expect(normalizeDeepLinkHref("//evil.example/open/saved")).toBeNull();
    expect(normalizeDeepLinkHref("  //evil.example")).toBeNull();
    expect(normalizeDeepLinkHref("meetcal:////evil.example/x")).toBeNull();
    expect(normalizeDeepLinkHref("/open/saved?x=1")).toBe("/open/saved?x=1");
  });

  it("rejects paths a browser reads as protocol-relative: a backslash, or a blank before the first segment", () => {
    expect(normalizeDeepLinkHref("/\\evil.example")).toBeNull();
    expect(normalizeDeepLinkHref("/\\/evil.example")).toBeNull();
    expect(normalizeDeepLinkHref("/\t/evil.example")).toBeNull();
    expect(normalizeDeepLinkHref("/\n/evil.example")).toBeNull();
    expect(normalizeDeepLinkHref("/ /evil.example")).toBeNull();
    expect(normalizeDeepLinkHref("/open/saved\\x")).toBeNull();
    expect(normalizeDeepLinkHref("meetcal://open/\\evil.example")).toBeNull();
    expect(normalizeDeepLinkHref("meetcal://open/saved?next=\\evil.example")).toBeNull();
  });

  it("keeps the session return path when the meet name has a backslash or a tab", () => {
    // `createAppDeepLink` percent-encodes them in the query.
    const link = createSessionDetailsDeepLink({ meet: "A\\B\tMeet", sessionNumber: 3, platform: "Red" });
    expect(normalizeDeepLinkHref(link)).toBe(
      "/shared-screens/schedule-details?meet=A%5CB%09Meet&sessionNumber=3&platform=Red",
    );
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

describe("deepLinkOpensPath", () => {
  it("matches a link to the screen whatever its query", () => {
    expect(deepLinkOpensPath("meetcal:///comp-data/rankings?meet=X&gender=Women", "/comp-data/rankings")).toBe(true);
    expect(deepLinkOpensPath("meetcal:///comp-data/rankings", "/comp-data/rankings")).toBe(true);
    expect(deepLinkOpensPath("/comp-data/rankings/?meet=X", "/comp-data/rankings")).toBe(true);
  });

  it("does not match another screen, another scheme or a malformed link", () => {
    expect(deepLinkOpensPath("meetcal:///comp-data/rankings-old", "/comp-data/rankings")).toBe(false);
    expect(deepLinkOpensPath("https://meetcal.app/comp-data/rankings", "/comp-data/rankings")).toBe(false);
    expect(deepLinkOpensPath("", "/comp-data/rankings")).toBe(false);
  });
});
