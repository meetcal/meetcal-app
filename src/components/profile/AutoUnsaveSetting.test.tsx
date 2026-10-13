/**
 * The auto-remove switch on the profile screen. Turning it on is premium;
 * turning it off never is, and a lapsed user sees it as it is stored. One
 * PATCH at a time, so the switch cannot end up disagreeing with the server.
 */
import React from "react";
import { Switch } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { AutoUnsaveSetting } from "@/components/profile/AutoUnsaveSetting";
import {
  fetchUserPreferences,
  patchAutoUnsavePreference,
} from "@/lib/api/meetcal-api";
import type { PremiumAccess } from "@/lib/premium-access";

jest.mock("@/components/ui/IconSymbol", () => ({ IconSymbol: () => null }));
jest.mock("@/components/ui/Toast", () => ({ showToast: jest.fn() }));
jest.mock("@clerk/expo", () => {
  const user = { id: "user_1" };
  const getToken = async () => "token";
  return {
    useUser: () => ({ user }),
    useAuth: () => ({ getToken }),
  };
});
jest.mock("@/lib/api/meetcal-api", () => ({
  fetchUserPreferences: jest.fn(),
  patchAutoUnsavePreference: jest.fn(),
}));

const mockFetchPreferences = fetchUserPreferences as jest.MockedFunction<
  typeof fetchUserPreferences
>;
const mockPatch = patchAutoUnsavePreference as jest.MockedFunction<
  typeof patchAutoUnsavePreference
>;

const requireAuth = jest.fn((): boolean | null => true);
const router = { push: jest.fn() };

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });
}

async function mount(premiumAccess: PremiumAccess, stored: boolean): Promise<ReactTestRenderer> {
  mockFetchPreferences.mockResolvedValue({ auto_unsave_started_sessions: stored } as never);
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <AutoUnsaveSetting
        premiumAccess={premiumAccess}
        requireAuth={requireAuth}
        router={router as never}
      />,
    );
  });
  await flush();
  return renderer;
}

const theSwitch = (renderer: ReactTestRenderer) => renderer.root.findByType(Switch);

beforeEach(() => {
  jest.clearAllMocks();
  mockPatch.mockImplementation(async (_token, value) => ({
    auto_unsave_started_sessions: value,
  }) as never);
});

describe("AutoUnsaveSetting", () => {
  it("shows a lapsed user the setting still on, and lets them turn it off", async () => {
    const renderer = await mount("denied", true);

    expect(theSwitch(renderer).props.value).toBe(true);
    expect(theSwitch(renderer).props.disabled).toBe(false);
    expect(JSON.stringify(renderer.toJSON())).toContain("Paused while you're not subscribed");

    await act(async () => {
      theSwitch(renderer).props.onValueChange(false);
    });
    await flush();

    expect(router.push).not.toHaveBeenCalled();
    expect(mockPatch).toHaveBeenCalledWith("token", false);
    expect(theSwitch(renderer).props.value).toBe(false);
  });

  it("allows turning it off while the subscription can't be confirmed", async () => {
    const renderer = await mount("unknown", true);

    await act(async () => {
      theSwitch(renderer).props.onValueChange(false);
    });
    await flush();

    expect(mockPatch).toHaveBeenCalledWith("token", false);
  });

  it("still sends a non-subscriber to the paywall to turn it on", async () => {
    const renderer = await mount("denied", false);

    expect(theSwitch(renderer).props.value).toBe(false);
    expect(theSwitch(renderer).props.disabled).toBe(true);
    const row = renderer.root.findAll(
      (node) => typeof node.props.onPress === "function" && node.props.disabled === false,
    )[0];
    await act(async () => {
      row.props.onPress();
    });
    await flush();

    expect(router.push).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: "/shared-screens/paywall" }),
    );
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("sends one PATCH at a time, so a second quick tap cannot race the first", async () => {
    let answer!: (value: never) => void;
    mockPatch.mockImplementationOnce(
      () => new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const renderer = await mount("granted", false);

    await act(async () => {
      theSwitch(renderer).props.onValueChange(true);
      theSwitch(renderer).props.onValueChange(false);
    });
    await flush();

    expect(mockPatch).toHaveBeenCalledTimes(1);
    expect(theSwitch(renderer).props.disabled).toBe(true);

    await act(async () => {
      answer({ auto_unsave_started_sessions: true } as never);
    });
    await flush();

    expect(theSwitch(renderer).props.value).toBe(true);
    expect(theSwitch(renderer).props.disabled).toBe(false);
  });
});
