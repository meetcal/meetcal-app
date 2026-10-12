import React from "react";
import { AppState, type AppStateStatus } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { useReminderSync } from "@/hooks/saved-sessions/useReminderSync";
import type { SavedSession } from "@/lib/saved-sessions-store";

const mockSync = jest.fn(async (_sessions: readonly SavedSession[], _isSubscribed: boolean | null) => {});

jest.mock("@/lib/saved-sessions-reminders", () => ({
  createReminderSyncRunner: () => ({ run: (task: () => Promise<void>) => task() }),
  syncSessionReminders: (sessions: readonly SavedSession[], isSubscribed: boolean | null) =>
    mockSync(sessions, isSubscribed),
}));

jest.mock("@/lib/reminder-preference", () => ({
  subscribeToReminderPreference: jest.fn(() => () => {}),
}));

const SESSIONS: SavedSession[] = [];

function Harness({ ready }: { ready: boolean }) {
  useReminderSync(SESSIONS, true, ready);
  return null;
}

describe("useReminderSync", () => {
  let listener: ((state: AppStateStatus) => void) | null = null;
  const remove = jest.fn();

  beforeEach(() => {
    mockSync.mockClear();
    remove.mockClear();
    listener = null;
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
      listener = handler as (state: AppStateStatus) => void;
      return { remove } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("syncs again when the app returns to the foreground, so fired reminders' slots are refilled", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<Harness ready />);
    });
    expect(mockSync).toHaveBeenCalledTimes(1);

    await act(async () => {
      listener?.("background");
    });
    expect(mockSync).toHaveBeenCalledTimes(1);

    await act(async () => {
      listener?.("active");
    });
    expect(mockSync).toHaveBeenCalledTimes(2);

    await act(async () => {
      renderer.unmount();
    });
    expect(remove).toHaveBeenCalled();
  });

  it("does not sync on foreground before the list has loaded", async () => {
    await act(async () => {
      create(<Harness ready={false} />);
    });
    await act(async () => {
      listener?.("active");
    });
    expect(mockSync).not.toHaveBeenCalled();
  });
});
