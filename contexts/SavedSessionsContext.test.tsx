import React, { useState } from "react";
import { act, create } from "react-test-renderer";

/**
 * The provider's whole job is to hand the hook's value down unchanged, so
 * the hook is stubbed with a stable object and the assertions are about
 * identity: does a consumer see one object per hook value, and does a
 * consumer outside the provider get the fallback without throwing.
 */
const mockHookValue = {
  savedSessions: [],
  isLoading: false,
  authExpired: false,
  loadSavedSessions: jest.fn(async () => {}),
  saveSessionsFromAthletes: jest.fn(async () => true),
  saveSession: jest.fn(async () => true),
  removeSession: jest.fn(async () => true),
  isSessionSaved: jest.fn(() => false),
  resetAllSessions: jest.fn(async () => true),
  migrateLegacySessions: jest.fn(async () => true),
};

jest.mock("@/hooks/useSavedSessions", () => ({
  useSavedSessions: () => mockHookValue,
}));

import {
  SavedSessionsProvider,
  useSavedSessions,
} from "@/contexts/SavedSessionsContext";

type ContextValue = ReturnType<typeof useSavedSessions>;

describe("SavedSessionsProvider", () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("passes the hook's memoised object through unchanged across provider re-renders", async () => {
    const seen: ContextValue[] = [];
    let bump: () => void = () => {};

    function Consumer() {
      seen.push(useSavedSessions());
      return null;
    }
    function Shell() {
      const [, setTick] = useState(0);
      bump = () => setTick((t) => t + 1);
      return (
        <SavedSessionsProvider>
          <Consumer />
        </SavedSessionsProvider>
      );
    }

    await act(async () => {
      create(<Shell />);
    });
    await act(async () => {
      bump();
    });

    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen[0]).toBe(mockHookValue);
    // A provider render with no new hook value must not hand consumers a new
    // object — that is what re-rendered every subscriber on every render.
    expect(new Set(seen).size).toBe(1);
  });

  it("returns the inert fallback outside a provider and warns once", async () => {
    let first: ContextValue | null = null;
    let second: ContextValue | null = null;

    function Orphan({ slot }: { slot: "first" | "second" }) {
      const value = useSavedSessions();
      if (slot === "first") first = value;
      else second = value;
      return null;
    }

    await act(async () => {
      create(
        <>
          <Orphan slot="first" />
          <Orphan slot="second" />
        </>,
      );
    });

    expect(first).not.toBeNull();
    expect(first).toBe(second);
    await expect(first!.saveSession({} as never)).resolves.toBe(false);
    expect(first!.isSessionSaved("x")).toBe(false);
    expect(first!.authExpired).toBe(false);
    expect(
      errorSpy.mock.calls.filter(([message]) =>
        String(message).includes("outside SavedSessionsProvider"),
      ),
    ).toHaveLength(1);
  });
});
