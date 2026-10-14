/**
 * The update prompt is a root-level dialog that can be raised during a
 * launch, while the splash is held for the first screen: it takes the
 * splash down so the prompt is not hidden behind it.
 */
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { UpdateNotification } from "@/components/schedule/UpdateNotification";

const mockShowOverlay = jest.fn();
jest.mock("@/lib/startup-splash", () => ({
  splashGate: { showOverlay: () => mockShowOverlay() },
}));

let mockOta = {
  isUpdateAvailable: false,
  isDownloading: false,
  error: null as string | null,
  downloadAndRestart: jest.fn(),
  dismissUpdate: jest.fn(),
};
jest.mock("@/hooks/useOTAUpdates", () => ({
  useOTAUpdates: () => mockOta,
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ currentTheme: "light" }) }));

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<UpdateNotification />);
  });
  return tree;
}

describe("UpdateNotification and the launch splash", () => {
  beforeEach(() => {
    mockShowOverlay.mockClear();
    mockOta = { ...mockOta, isUpdateAvailable: false, error: null };
  });

  it("leaves the splash alone while there is nothing to show", () => {
    const tree = render();
    expect(mockShowOverlay).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("takes the splash down when the update prompt appears", () => {
    const tree = render();
    mockOta = { ...mockOta, isUpdateAvailable: true };
    act(() => {
      tree.update(<UpdateNotification />);
    });
    expect(mockShowOverlay).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("does the same for the update error dialog", () => {
    mockOta = { ...mockOta, error: "Download failed" };
    const tree = render();
    expect(mockShowOverlay).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });
});
