import React from "react";
import { Alert, Platform } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { showToast } from "@/components/ui/Toast";
import {
  type CalendarSession,
  createCalendarEventWithSystemUI,
  createCalendarEvents,
  createCalendarEventsToCalendar,
  getWritableCalendars,
  requestCalendarPermissions,
  resolvePreferredAndroidCalendar,
  setPreferredAndroidCalendarId,
} from "@/utils/calendar";
import { useCalendarSessionsExport } from "./useCalendarSessionsExport";

jest.mock("@/components/ui/Toast", () => ({ showToast: jest.fn() }));
jest.mock("@/utils/calendar", () => {
  const actual = jest.requireActual("@/utils/calendar");
  const wroteOne = { total: 1, created: 1, updated: 0, failed: 0 };
  return {
    describeCalendarWrite: actual.describeCalendarWrite,
    requestCalendarPermissions: jest.fn(async () => true),
    createCalendarEvents: jest.fn(async () => wroteOne),
    createCalendarEventsToCalendar: jest.fn(async () => wroteOne),
    createCalendarEventWithSystemUI: jest.fn(async () => undefined),
    getWritableCalendars: jest.fn(async () => []),
    resolvePreferredAndroidCalendar: jest.fn(async () => null),
    setPreferredAndroidCalendarId: jest.fn(async () => {}),
  };
});

const SESSION: CalendarSession = {
  date: "2026-06-20",
  startTime: "9:00 AM",
  weighInTime: "7:00 AM",
  sessionNumber: "1",
  platform: "Red",
  weightClass: "89",
  meet: "Nationals",
};

let hook!: ReturnType<typeof useCalendarSessionsExport>;
function Harness() {
  const value = useCalendarSessionsExport();
  React.useEffect(() => {
    hook = value;
  });
  return null;
}

async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
}

/** Runs the export and presses "Add" on the confirmation. */
async function confirmExport(sessions: CalendarSession[], skipped?: number) {
  act(() => hook.exportSessions(sessions, { skipped }));
  const buttons = jest.mocked(Alert.alert).mock.calls[0][2] ?? [];
  await act(async () => {
    buttons.find((b) => b.text === "Add")?.onPress?.();
  });
  await settle();
}

let tree!: ReactTestRenderer;
const originalOS = Platform.OS;
const onPlatform = (os: string) =>
  Object.defineProperty(Platform, "OS", { value: os, configurable: true });

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  act(() => {
    tree = create(<Harness />);
  });
});

afterEach(() => {
  act(() => tree.unmount());
  onPlatform(originalOS);
  jest.restoreAllMocks();
});

describe("useCalendarSessionsExport", () => {
  it("only shows a toast for an empty batch", () => {
    act(() => hook.exportSessions([]));
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ type: "info" }));
  });

  it("says why nothing was added when every session lacked schedule details", () => {
    act(() => hook.exportSessions([], { skipped: 2 }));
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
  });

  it("writes to the system calendar on iOS after confirmation", async () => {
    onPlatform("ios");
    await confirmExport([SESSION]);
    expect(jest.mocked(Alert.alert).mock.calls[0][1]).toBe("Add 1 session to your calendar?");
    expect(createCalendarEvents).toHaveBeenCalledWith([SESSION]);
    expect(showToast).toHaveBeenCalledWith({
      type: "success",
      message: "Added 1 session to your calendar.",
    });
  });

  it("reports N of M when the caller skipped sessions", async () => {
    onPlatform("ios");
    await confirmExport([SESSION], 1);
    expect(showToast).toHaveBeenCalledWith({
      type: "info",
      message: "Added 1 of 2 sessions to your calendar. 1 session had no schedule details.",
    });
  });

  it("stops at a denied permission", async () => {
    jest.mocked(requestCalendarPermissions).mockResolvedValueOnce(false);
    await confirmExport([SESSION]);
    expect(createCalendarEvents).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenLastCalledWith(
      "Permission Required",
      expect.any(String),
    );
  });

  it("shows the mapped error when nothing could be written", async () => {
    onPlatform("ios");
    jest.mocked(createCalendarEvents).mockRejectedValueOnce(new Error("Could not add events"));
    await confirmExport([SESSION]);
    expect(showToast).toHaveBeenCalledWith({ type: "error", message: "Could not add events" });
  });

  it("on Android writes to the remembered calendar and names it", async () => {
    onPlatform("android");
    jest
      .mocked(resolvePreferredAndroidCalendar)
      .mockResolvedValueOnce({ id: "cal-9", label: "Home", title: "Home" });
    await confirmExport([SESSION]);
    expect(createCalendarEventsToCalendar).toHaveBeenCalledWith([SESSION], "cal-9");
    expect(showToast).toHaveBeenCalledWith({ type: "success", message: "Added 1 session to Home." });
  });

  it("on Android without a remembered calendar, opens the picker and remembers the choice", async () => {
    onPlatform("android");
    const destination = { id: "cal-1", label: "Work", title: "Work" };
    jest.mocked(resolvePreferredAndroidCalendar).mockResolvedValueOnce(null);
    jest.mocked(getWritableCalendars).mockResolvedValueOnce([destination]);
    await confirmExport([SESSION]);
    expect(hook.picker.visible).toBe(true);
    expect(hook.picker.destinations).toEqual([destination]);

    await act(async () => {
      await hook.picker.onSelect(destination);
    });
    expect(setPreferredAndroidCalendarId).toHaveBeenCalledWith("cal-1");
    expect(createCalendarEventsToCalendar).toHaveBeenCalledWith([SESSION], "cal-1");
    expect(hook.picker.visible).toBe(false);
  });

  describe("a single session in the system editor (session details)", () => {
    it("opens the Android calendar app without asking first", async () => {
      onPlatform("android");
      act(() => hook.exportSessions([SESSION], { confirm: false, systemEditor: true }));
      await settle();
      expect(Alert.alert).not.toHaveBeenCalled();
      expect(createCalendarEventWithSystemUI).toHaveBeenCalledWith(SESSION);
      expect(createCalendarEventsToCalendar).not.toHaveBeenCalled();
    });

    it("falls back to the remembered calendar when no app can open the editor", async () => {
      onPlatform("android");
      jest
        .mocked(createCalendarEventWithSystemUI)
        .mockRejectedValueOnce(new Error("Could not open the Android calendar app. Please choose a default calendar and try again."));
      jest
        .mocked(resolvePreferredAndroidCalendar)
        .mockResolvedValueOnce({ id: "cal-9", label: "Home", title: "Home" });
      act(() => hook.exportSessions([SESSION], { confirm: false, systemEditor: true }));
      await settle();
      expect(createCalendarEventsToCalendar).toHaveBeenCalledWith([SESSION], "cal-9");
    });

    it("writes (or updates) it in the default calendar on iOS", async () => {
      onPlatform("ios");
      act(() => hook.exportSessions([SESSION], { confirm: false, systemEditor: true }));
      await settle();
      expect(createCalendarEventWithSystemUI).not.toHaveBeenCalled();
      expect(createCalendarEvents).toHaveBeenCalledWith([SESSION]);
    });
  });
});
