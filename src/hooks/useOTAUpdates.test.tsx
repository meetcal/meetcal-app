/**
 * The OTA prompt: once put off, it stays off for that update for the
 * session, "Later" in the restart alert takes the modal down, and an update
 * already downloaded in the background is not offered again.
 */
import React from "react";
import { Alert, AppState } from "react-native";
import { act, create } from "react-test-renderer";
import {
  resetOTADismissalForTests,
  shouldPromptForUpdate,
  useOTAUpdates,
} from "@/hooks/useOTAUpdates";

const mockCheckForUpdate = jest.fn();
const mockFetchUpdate = jest.fn(async () => ({ isNew: true }));
let mockIsUpdatePending = false;
jest.mock("expo-updates", () => ({
  isEnabled: true,
  checkForUpdateAsync: () => mockCheckForUpdate(),
  fetchUpdateAsync: () => mockFetchUpdate(),
  reloadAsync: jest.fn(async () => {}),
  useUpdates: () => ({ isUpdatePending: mockIsUpdatePending }),
}));

jest.mock("@/lib/networkUtils", () => ({ isNetworkAvailable: async () => true }));

type AppStateListener = (state: string) => void;
let appStateListener: AppStateListener | null = null;

function available(id: string) {
  return { isAvailable: true, manifest: { id }, isRollBackToEmbedded: false };
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

async function mount() {
  const ref = { current: null as unknown as ReturnType<typeof useOTAUpdates> };
  function Harness() {
    ref.current = useOTAUpdates();
    return null;
  }
  await act(async () => {
    create(<Harness />);
  });
  await flush();
  return ref;
}

async function foreground(): Promise<void> {
  await act(async () => {
    appStateListener?.("active");
  });
  await flush();
}

describe("useOTAUpdates", () => {
  const realDev = (global as { __DEV__?: boolean }).__DEV__;

  beforeEach(() => {
    (global as { __DEV__?: boolean }).__DEV__ = false;
    jest.clearAllMocks();
    resetOTADismissalForTests();
    mockIsUpdatePending = false;
    appStateListener = null;
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(AppState, "addEventListener").mockImplementation(((
      _type: string,
      listener: AppStateListener,
    ) => {
      appStateListener = listener;
      return { remove: () => {} };
    }) as never);
    // Every foreground passes the 5-minute throttle.
    let now = 0;
    jest.spyOn(Date, "now").mockImplementation(() => {
      now += 10 * 60 * 1000;
      return now;
    });
  });

  afterEach(() => {
    (global as { __DEV__?: boolean }).__DEV__ = realDev;
    jest.restoreAllMocks();
  });

  it("does not raise the prompt again for an update the user put off", async () => {
    mockCheckForUpdate.mockResolvedValue(available("update-1"));
    const ota = await mount();
    expect(ota.current.isUpdateAvailable).toBe(true);

    act(() => ota.current.dismissUpdate());
    expect(ota.current.isUpdateAvailable).toBe(false);

    await foreground();
    expect(mockCheckForUpdate).toHaveBeenCalledTimes(2);
    expect(ota.current.isUpdateAvailable).toBe(false);

    // A newer update is a new question.
    mockCheckForUpdate.mockResolvedValue(available("update-2"));
    await foreground();
    expect(ota.current.isUpdateAvailable).toBe(true);
  });

  it("takes the modal down on Later in the restart alert", async () => {
    mockCheckForUpdate.mockResolvedValue(available("update-1"));
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const ota = await mount();

    await act(async () => {
      await ota.current.downloadAndRestart();
    });
    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress: () => void }[];
    act(() => buttons.find((button) => button.text === "Later")!.onPress());

    expect(ota.current.isUpdateAvailable).toBe(false);
    expect(ota.current.isDownloading).toBe(false);

    await foreground();
    expect(ota.current.isUpdateAvailable).toBe(false);
  });

  it("does not prompt for an update already downloaded in the background", async () => {
    mockIsUpdatePending = true;
    mockCheckForUpdate.mockResolvedValue(available("update-1"));
    const ota = await mount();
    expect(mockCheckForUpdate).toHaveBeenCalledTimes(1);
    expect(ota.current.isUpdateAvailable).toBe(false);
  });
});

describe("shouldPromptForUpdate", () => {
  const base = { isAvailable: true, updateId: "a", isUpdatePending: false, dismissed: null };

  it("prompts for a new, undismissed, not-yet-downloaded update", () => {
    expect(shouldPromptForUpdate(base)).toBe(true);
  });

  it("does not prompt when nothing is available or it is already downloaded", () => {
    expect(shouldPromptForUpdate({ ...base, isAvailable: false })).toBe(false);
    expect(shouldPromptForUpdate({ ...base, isUpdatePending: true })).toBe(false);
  });

  it("respects a dismissal of the same update, or of an unidentified one", () => {
    expect(shouldPromptForUpdate({ ...base, dismissed: { id: "a" } })).toBe(false);
    expect(shouldPromptForUpdate({ ...base, dismissed: { id: null } })).toBe(false);
    expect(shouldPromptForUpdate({ ...base, dismissed: { id: "older" } })).toBe(true);
  });
});
