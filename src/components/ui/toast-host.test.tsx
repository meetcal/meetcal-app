/**
 * The toast host: a screen-reader user must hear each toast, and a toast
 * raised while a modal is open must show in the modal's own host (a native
 * modal window covers the root one), then survive the modal closing.
 */
import React from "react";
import { AccessibilityInfo, Modal, Platform, Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { ToastHost } from "@/components/ui/Toast";
import { showToast } from "@/lib/toast";

jest.mock("@/components/ui/IconSymbol", () => ({ IconSymbol: () => null }));
jest.mock("@/lib/haptics", () => ({
  successNotification: jest.fn(),
  errorNotification: jest.fn(),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  default: { View: jest.requireActual("react-native").View },
  Easing: { out: () => () => 0, cubic: () => 0 },
  runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
  useSharedValue: (value: number) => ({ value }),
  useAnimatedStyle: () => ({}),
  withTiming: (value: number) => value,
}));

const { successNotification } = jest.requireMock("@/lib/haptics") as {
  successNotification: jest.Mock;
};

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => String(node.props.children));
}

describe("ToastHost", () => {
  let announce: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
    jest.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(false);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("announces each new toast to VoiceOver and marks it a live region for TalkBack", () => {
    const original = Platform.OS;
    Object.defineProperty(Platform, "OS", { get: () => "ios", configurable: true });
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<ToastHost />);
    });

    act(() => showToast({ type: "success", message: "Session 12 saved to your list" }));

    expect(announce).toHaveBeenCalledWith("Session 12 saved to your list");
    const banner = renderer.root.findAll((node) => node.props.accessibilityRole === "alert")[0];
    expect(banner.props.accessibilityLiveRegion).toBe("assertive");
    act(() => renderer.unmount());
    Object.defineProperty(Platform, "OS", { get: () => original, configurable: true });
  });

  it("shows a toast raised while a modal is open in the modal, then keeps it when the modal closes", () => {
    const Screen = ({ modalOpen }: { modalOpen: boolean }) => (
      <>
        <ToastHost />
        {modalOpen ? (
          <Modal visible transparent>
            <ToastHost />
          </Modal>
        ) : null}
      </>
    );
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Screen modalOpen />);
    });

    // The modal closes in the same update that raises the toast.
    act(() => {
      showToast({ type: "success", message: "Added 3 sessions" });
      renderer.update(<Screen modalOpen={false} />);
    });

    expect(texts(renderer)).toEqual(["Added 3 sessions"]);
    // The modal's host never showed it, so the host below announces it.
    expect(successNotification).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
  });

  it("a toast while the modal stays open shows inside the modal only", () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <>
          <ToastHost />
          <Modal visible transparent>
            <ToastHost />
          </Modal>
        </>,
      );
    });

    act(() => showToast({ type: "error", message: "Couldn't add to calendar" }));

    const modal = renderer.root.findByType(Modal);
    expect(modal.findAllByType(Text).map((node) => node.props.children)).toEqual([
      "Couldn't add to calendar",
    ]);
    expect(texts(renderer)).toEqual(["Couldn't add to calendar"]);
    act(() => renderer.unmount());
  });

  it("does not announce twice when a modal closes after showing its toast", () => {
    const Screen = ({ modalOpen }: { modalOpen: boolean }) => (
      <>
        <ToastHost />
        {modalOpen ? (
          <Modal visible transparent>
            <ToastHost />
          </Modal>
        ) : null}
      </>
    );
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Screen modalOpen />);
    });
    act(() => showToast({ type: "success", message: "Shared" }));
    expect(successNotification).toHaveBeenCalledTimes(1);

    act(() => renderer.update(<Screen modalOpen={false} />));

    expect(texts(renderer)).toEqual(["Shared"]);
    expect(successNotification).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
  });
});
