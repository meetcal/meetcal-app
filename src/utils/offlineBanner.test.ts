import { offlineBannerText } from "@/utils/offlineBanner";

describe("offlineBannerText", () => {
  const now = Date.UTC(2026, 5, 20, 12);
  const HOUR = 60 * 60 * 1000;

  it("says only offline when the meet has nothing stored", () => {
    expect(offlineBannerText(null, now)).toBe("Offline Mode");
    expect(offlineBannerText(0, now)).toBe("Offline Mode");
  });

  it("reports the meet data's own age", () => {
    expect(offlineBannerText(now - 10 * 60 * 1000, now)).toBe(
      "Offline Mode • Meet data synced recently",
    );
    expect(offlineBannerText(now - 3 * HOUR, now)).toBe("Offline Mode • Meet data synced 3h ago");
    expect(offlineBannerText(now - 50 * HOUR, now)).toBe("Offline Mode • Meet data synced 2d ago");
  });

  it("reads a sync time in the future (clock moved back) as recent", () => {
    expect(offlineBannerText(now + HOUR, now)).toBe("Offline Mode • Meet data synced recently");
  });
});
