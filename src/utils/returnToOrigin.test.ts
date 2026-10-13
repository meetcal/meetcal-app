import {
  originHref,
  originRouteParam,
  returnToOrigin,
  type OriginRouter,
} from "@/utils/returnToOrigin";

function router(canGoBack = false): jest.Mocked<OriginRouter> {
  return {
    dismissTo: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn(() => canGoBack),
  };
}

describe("returnToOrigin", () => {
  it("dismisses to an in-app `from` rather than pushing a second copy of it", () => {
    const r = router(true);
    returnToOrigin(r, "/shared-screens/schedule-details?meet=A&sessionNumber=3");
    expect(r.dismissTo).toHaveBeenCalledWith(
      "/shared-screens/schedule-details?meet=A&sessionNumber=3",
    );
    expect(r.replace).not.toHaveBeenCalled();
    expect(r.back).not.toHaveBeenCalled();
  });

  it("goes back when there is no usable `from`", () => {
    const r = router(true);
    returnToOrigin(r, undefined);
    expect(r.back).toHaveBeenCalledTimes(1);
    expect(r.dismissTo).not.toHaveBeenCalled();
  });

  it.each(["https://evil.example", "//evil.example", 42, null])(
    "never navigates to %p; falls back to the default tab with nothing underneath",
    (from) => {
      const r = router(false);
      returnToOrigin(r, from);
      expect(r.dismissTo).not.toHaveBeenCalled();
      expect(r.replace).toHaveBeenCalledWith("/(tabs)/(index)");
    },
  );

  it("uses the caller's fallback", () => {
    const r = router(false);
    returnToOrigin(r, undefined, "/(tabs)/(info)");
    expect(r.replace).toHaveBeenCalledWith("/(tabs)/(info)");
  });
});

describe("originHref", () => {
  it("accepts absolute in-app paths only", () => {
    expect(originHref("/(tabs)/(saved)")).toBe("/(tabs)/(saved)");
    expect(originHref("info")).toBeNull();
    expect(originHref("//host")).toBeNull();
    expect(originHref(undefined)).toBeNull();
  });
});

describe("originRouteParam", () => {
  it("escapes `%` so the second decode in `useLocalSearchParams` restores the path", () => {
    const from = "/shared-screens/athlete-results?name=A%20%26%20B";
    expect(decodeURIComponent(originRouteParam(from))).toBe(from);
  });

  it("leaves a path with no escapes unchanged", () => {
    expect(originRouteParam("/schedule-toolbar/profile")).toBe("/schedule-toolbar/profile");
  });
});
