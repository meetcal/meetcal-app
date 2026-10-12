import React from "react";
import { Alert, Platform } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { showToast } from "@/components/ui/Toast";
import {
  type CalendarSession,
  createCalendarEvents,
  createCalendarEventsToCalendar,
  getWritableCalendars,
  requestCalendarPermissions,
  resolvePreferredAndroidCalendar,
  setPreferredAndroidCalendarId,
} from "@/utils/calendar";
import { useCalendarSessionsExport } from "./useCalendarSessionsExport";

jest.mock("@/components/ui/Toast", () => ({ showToast: jest.fn() }));
jest.mock("@/utils/calendar", () => ({
  requestCalendarPermissions: jest.fn(async () => true),
  createCalendarEvents: jest.fn(async () => {}),
  createCalendarEventsToCalendar: jest.fn(async () => {}),
  getWritableCalendars: jest.fn(async () => []),
  resolvePreferredAndroidCalendar: jest.fn(async () => null),
  setPreferredAndroidCalendarId: jest.fn(async () => {}),
}));

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

/** Runs the export and presses "Add" on the confirmation. */
async function confirmExport(sessions: CalendarSession[]) {
  act(() => hook.exportSessions(sessions));
  const buttons = jest.mocked(Alert.alert).mock.calls[0][2] ?? [];
  await act(async () => {
    buttons.find((b) => b.text === "Add")?.onPress?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
}

let tree!: ReactTestRenderer;
const originalOS = Platform.OS;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
  act(() => {
    tree = create(<Harness />);
  });
});

afterEach(() => {
  act(() => tree.unmount());
  Object.defineProperty(Platform, "OS", { value: originalOS, configurable: true });
  jest.restoreAllMocks();
});

describe("useCalendarSessionsExport", () => {
  it("only shows a toast for an empty batch", () => {
    act(() => hook.exportSessions([]));
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ type: "info" }));
  });

  it("writes to the system calendar on iOS after confirmation", async () => {
    Object.defineProperty(Platform, "OS", { value: "ios", configurable: true });
    await confirmExport([SESSION]);
    expect(jest.mocked(Alert.alert).mock.calls[0][1]).toBe("Add 1 session to your calendar?");
    expect(createCalendarEvents).toHaveBeenCalledWith([SESSION]);
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
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

  it("on Android without a remembered calendar, opens the picker and remembers the choice", async () => {
    Object.defineProperty(Platform, "OS", { value: "android", configurable: true });
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
});
