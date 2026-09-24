// Suites that cannot render skip the react-native UI warm-up in jest.setup.js.
// Warming Animated/ScrollView/... there cost each `.ts` suite ~55ms warm and
// ~1.1s of a ~6.4s full run (4 cores), for no test that needed it.
const { rendersReactNativeUi } = jest.requireActual(
  "./device-timezone-environment.js",
) as { rendersReactNativeUi: (testPath: unknown) => boolean };

describe("rendersReactNativeUi", () => {
  it("is true for files that can hold JSX", () => {
    expect(rendersReactNativeUi("/repo/components/x/Row.test.tsx")).toBe(true);
    expect(rendersReactNativeUi("/repo/legacy/Row.test.jsx")).toBe(true);
  });

  it("is false for plain .ts/.js suites", () => {
    expect(rendersReactNativeUi("/repo/lib/api/meetcal-api.test.ts")).toBe(false);
    expect(rendersReactNativeUi("/repo/lib/x.test.js")).toBe(false);
    // A directory named like a JSX file does not count.
    expect(rendersReactNativeUi("/repo/a.tsx/b.test.ts")).toBe(false);
  });

  it("warms when the path is unknown, so a screen test never pays it in its timeout", () => {
    expect(rendersReactNativeUi(undefined)).toBe(true);
  });

  it("tells this .ts suite's setup to skip the warm-up", () => {
    expect(
      (globalThis as { __MEETCAL_WARM_RN_UI__?: boolean }).__MEETCAL_WARM_RN_UI__,
    ).toBe(false);
  });
});
