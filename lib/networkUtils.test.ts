// networkUtils holds module-level cached connectivity state and registers a
// NetInfo listener on import, so each test loads a fresh copy of the module.

type NetInfoMock = {
  fetch: jest.Mock;
  addEventListener: jest.Mock;
};

let NetInfo: NetInfoMock;
let isOfflineModeSimulated: jest.Mock;
let networkUtils: typeof import("@/lib/networkUtils");

function loadModule() {
  jest.resetModules();
  isOfflineModeSimulated = jest.fn(() => false);
  jest.doMock("@/config/development", () => ({
    __esModule: true,
    isOfflineModeSimulated,
  }));
  NetInfo = require("@react-native-community/netinfo");
  networkUtils = require("@/lib/networkUtils");
}

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  loadModule();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("isNetworkAvailable", () => {
  it("short-circuits to false when offline mode is simulated", async () => {
    isOfflineModeSimulated.mockReturnValue(true);
    await expect(networkUtils.isNetworkAvailable()).resolves.toBe(false);
    expect(NetInfo.fetch).not.toHaveBeenCalled();
  });

  it("returns true when the network is reachable", async () => {
    NetInfo.fetch.mockResolvedValue({ isInternetReachable: true });
    await expect(networkUtils.isNetworkAvailable()).resolves.toBe(true);
  });

  it("returns false only when reachability is explicitly false", async () => {
    NetInfo.fetch.mockResolvedValue({ isInternetReachable: false });
    await expect(networkUtils.isNetworkAvailable()).resolves.toBe(false);
  });

  it("treats unknown (null) reachability as available", async () => {
    NetInfo.fetch.mockResolvedValue({
      isConnected: true,
      isInternetReachable: null,
    });
    await expect(networkUtils.isNetworkAvailable()).resolves.toBe(true);
  });

  // Regression: airplane mode on a cold start. The OS already knows the
  // interface is down (`isConnected: false`) while the reachability probe has
  // not reported yet (`isInternetReachable: null`). Reading only reachability
  // answered "online" and every launch fetch blocked until its timeout.
  it("returns false when the interface is down even if reachability is unknown", async () => {
    NetInfo.fetch.mockResolvedValue({
      isConnected: false,
      isInternetReachable: null,
    });
    await expect(networkUtils.isNetworkAvailable()).resolves.toBe(false);
  });

  it("caches the result within the cache window", async () => {
    NetInfo.fetch.mockResolvedValue({ isInternetReachable: true });
    await networkUtils.isNetworkAvailable();
    await networkUtils.isNetworkAvailable();
    expect(NetInfo.fetch).toHaveBeenCalledTimes(1);
  });

  it("re-fetches once the cache window has elapsed", async () => {
    NetInfo.fetch.mockResolvedValue({ isInternetReachable: true });
    const nowSpy = jest.spyOn(Date, "now");
    nowSpy.mockReturnValue(0);
    await networkUtils.isNetworkAvailable();
    nowSpy.mockReturnValue(5000); // > 3000ms cache window
    await networkUtils.isNetworkAvailable();
    expect(NetInfo.fetch).toHaveBeenCalledTimes(2);
  });

  it("de-dupes concurrent checks into a single fetch", async () => {
    let resolveFetch: (state: { isInternetReachable: boolean }) => void;
    NetInfo.fetch.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const first = networkUtils.isNetworkAvailable();
    const second = networkUtils.isNetworkAvailable();
    resolveFetch!({ isInternetReachable: true });

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(NetInfo.fetch).toHaveBeenCalledTimes(1);
  });

  it("assumes available when the check throws and there is no prior state", async () => {
    NetInfo.fetch.mockRejectedValue(new Error("boom"));
    await expect(networkUtils.isNetworkAvailable()).resolves.toBe(true);
  });

  it("falls back to the last known state when a later check throws", async () => {
    const nowSpy = jest.spyOn(Date, "now");
    nowSpy.mockReturnValue(0);
    NetInfo.fetch.mockResolvedValue({ isInternetReachable: false });
    await expect(networkUtils.isNetworkAvailable()).resolves.toBe(false);

    nowSpy.mockReturnValue(5000); // expire cache so it fetches again
    NetInfo.fetch.mockRejectedValue(new Error("boom"));
    await expect(networkUtils.isNetworkAvailable()).resolves.toBe(false);
  });
});

describe("subscribeToNetworkChanges", () => {
  it("invokes the callback with connectivity and returns the unsubscribe fn", () => {
    const unsubscribe = jest.fn();
    NetInfo.addEventListener.mockReturnValue(unsubscribe);

    const callback = jest.fn();
    const returned = networkUtils.subscribeToNetworkChanges(callback);

    // Drive the listener registered by subscribeToNetworkChanges.
    const listener =
      NetInfo.addEventListener.mock.calls[
        NetInfo.addEventListener.mock.calls.length - 1
      ][0];
    listener({ isInternetReachable: true });
    listener({ isInternetReachable: false });
    listener({ isInternetReachable: null });

    expect(callback.mock.calls).toEqual([[true], [false], [true]]);
    expect(returned).toBe(unsubscribe);
  });

  it("does not contradict simulated offline mode with a live listener", () => {
    isOfflineModeSimulated.mockReturnValue(true);
    const callsBefore = NetInfo.addEventListener.mock.calls.length;

    const callback = jest.fn();
    const unsubscribe = networkUtils.subscribeToNetworkChanges(callback);

    expect(NetInfo.addEventListener.mock.calls.length).toBe(callsBefore);
    expect(callback).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
  });
});
