/**
 * Onboarding has a way out: Skip jumps to the permissions page, Android back
 * does the same and then leaves, and finishing marks this version's
 * "What's New" seen so it does not stack on top of onboarding.
 */
import React from "react";
import { Modal, Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Calendar from "expo-calendar/legacy";
import { OnboardingView } from "@/components/schedule/OnboardingView";
import { CURRENT_VERSION, VERSION_ANNOUNCEMENT_KEY } from "@/config/version-announcements";
import { checkOnboardingComplete } from "@/lib/onboarding";

jest.mock("expo-calendar/legacy", () => ({
  requestCalendarPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
}));
jest.mock("expo-notifications", () => ({
  AndroidImportance: { MAX: 5 },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
}));

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

async function mount(onComplete: () => void): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<OnboardingView visible onComplete={onComplete} />);
  });
  return renderer;
}

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => [].concat(node.props.children).join(""));
}

/** The innermost pressable holding `label`; the sheet itself is one too. */
function pressable(renderer: ReactTestRenderer, label: string) {
  return renderer.root
    .findAll(
      (node) =>
        typeof node.props.onPress === "function" &&
        node.findAllByType(Text).some((text) => text.props.children === label),
    )
    .at(-1);
}

describe("OnboardingView", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    await AsyncStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("never counts the features wrong or points at a tab position", async () => {
    const renderer = await mount(() => {});
    const seen: string[] = [];
    for (let page = 1; page < 9; page += 1) {
      seen.push(...texts(renderer));
      await act(async () => {
        pressable(renderer, "Next")!.props.onPress();
      });
    }
    const copy = seen.join(" ");
    expect(copy).not.toMatch(/\d main features/);
    // Tabs are icon-only, and a side rail on iPhone Duo.
    expect(copy).not.toMatch(/bottom right/);
    expect(copy).toMatch(/Start List tab/);
  });

  it("Skip jumps to the permissions page, which still asks before finishing", async () => {
    const onComplete = jest.fn();
    const renderer = await mount(onComplete);

    await act(async () => {
      pressable(renderer, "Skip")!.props.onPress();
    });

    expect(texts(renderer)).toContain("Calendar & Notification Access");
    expect(pressable(renderer, "Skip")).toBeUndefined();
    expect(onComplete).not.toHaveBeenCalled();

    await act(async () => {
      pressable(renderer, "Done")!.props.onPress();
    });
    await flush();

    expect(Calendar.requestCalendarPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(await checkOnboardingComplete()).toBe(true);
    expect(JSON.parse((await AsyncStorage.getItem(VERSION_ANNOUNCEMENT_KEY)) ?? "[]")).toContain(
      CURRENT_VERSION,
    );
  });

  it("Android back skips to the last page, then leaves without prompting", async () => {
    const onComplete = jest.fn();
    const renderer = await mount(onComplete);
    const back = () => renderer.root.findByType(Modal).props.onRequestClose();

    await act(async () => {
      back();
    });
    expect(texts(renderer)).toContain("Calendar & Notification Access");

    await act(async () => {
      back();
    });
    await flush();

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(Calendar.requestCalendarPermissionsAsync).not.toHaveBeenCalled();
    expect(await checkOnboardingComplete()).toBe(true);
  });
});
