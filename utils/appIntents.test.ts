type ReactNativeMock = {
  NativeModules: {
    AppIntentsBridge?: {
      reindexAppEntities: jest.Mock;
    };
  };
  Platform: {
    OS: string;
  };
};

const loadAppIntents = (reactNative: ReactNativeMock) => {
  jest.resetModules();
  jest.doMock("react-native", () => reactNative);
  return require("@/utils/appIntents") as typeof import("@/utils/appIntents");
};

describe("app intents bridge", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
    jest.dontMock("react-native");
  });

  it("debounces native reindex requests on iOS", () => {
    const reindexAppEntitiesNative = jest.fn();
    const { reindexAppEntities } = loadAppIntents({
      NativeModules: {
        AppIntentsBridge: {
          reindexAppEntities: reindexAppEntitiesNative,
        },
      },
      Platform: { OS: "ios" },
    });

    void reindexAppEntities();
    void reindexAppEntities();
    void reindexAppEntities();

    jest.advanceTimersByTime(1999);
    expect(reindexAppEntitiesNative).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(reindexAppEntitiesNative).toHaveBeenCalledTimes(1);
  });

  it("no-ops on non-iOS platforms", () => {
    const reindexAppEntitiesNative = jest.fn();
    const { reindexAppEntities } = loadAppIntents({
      NativeModules: {
        AppIntentsBridge: {
          reindexAppEntities: reindexAppEntitiesNative,
        },
      },
      Platform: { OS: "android" },
    });

    void reindexAppEntities();
    jest.advanceTimersByTime(2000);

    expect(reindexAppEntitiesNative).not.toHaveBeenCalled();
  });

  it("logs a missing native module once", () => {
    const { reindexAppEntities } = loadAppIntents({
      NativeModules: {},
      Platform: { OS: "ios" },
    });

    void reindexAppEntities();
    jest.advanceTimersByTime(2000);
    void reindexAppEntities();
    jest.advanceTimersByTime(2000);

    expect(console.log).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledWith("[AppIntents] Native module not available");
  });

  it("catches rejected native reindex promises", async () => {
    const error = new Error("index unavailable");
    const { reindexAppEntities } = loadAppIntents({
      NativeModules: {
        AppIntentsBridge: {
          reindexAppEntities: jest.fn(() => Promise.reject(error)),
        },
      },
      Platform: { OS: "ios" },
    });

    void reindexAppEntities();
    jest.advanceTimersByTime(2000);
    await Promise.resolve();

    expect(console.warn).toHaveBeenCalledWith(
      "[AppIntents] reindexAppEntities failed",
      error,
    );
  });
});
