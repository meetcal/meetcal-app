const plugin = require("./withOneSignalSuppressLaunchURLs");

describe("withOneSignalSuppressLaunchURLs (#288)", () => {
  it("sets OneSignal's iOS suppress key, keeping the rest of Info.plist", () => {
    expect(plugin.setSuppressLaunchURLsInfoPlist({ CFBundleName: "MeetCal" })).toEqual({
      CFBundleName: "MeetCal",
      OneSignal_suppress_launch_urls: true,
    });
  });

  it("adds OneSignal's Android meta-data to the main application once", () => {
    const manifest = {
      manifest: {
        $: {},
        application: [{ $: { "android:name": ".MainApplication" }, "meta-data": [] }],
      },
    };
    plugin.setSuppressLaunchURLsManifest(manifest);
    plugin.setSuppressLaunchURLsManifest(manifest);
    const metaData = manifest.manifest.application[0]["meta-data"] as { $: Record<string, string> }[];
    expect(metaData).toEqual([
      { $: { "android:name": "com.onesignal.suppressLaunchURLs", "android:value": "true" } },
    ]);
  });

  it("is listed in the app config", () => {
    const appConfig = require("../app.config.js").default({ config: {} });
    expect(appConfig.plugins).toContain("./plugins/withOneSignalSuppressLaunchURLs");
  });
});
