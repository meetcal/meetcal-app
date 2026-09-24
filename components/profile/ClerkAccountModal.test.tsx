import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { ClerkAccountModal } from "@/components/profile/ClerkAccountModal";
import { UserProfileView } from "@clerk/expo/native";

let mockIsSignedIn: boolean | undefined = true;
jest.mock("@clerk/expo", () => ({
  useAuth: () => ({ isSignedIn: mockIsSignedIn }),
}));

// Clerk's native account screen, stubbed at the native boundary.
jest.mock("@clerk/expo/native", () => ({
  UserProfileView: jest.fn(() => null),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockUserProfileView = UserProfileView as unknown as jest.Mock;

function render(props: { visible: boolean; onClose: () => void; onSignedOut: () => void }) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<ClerkAccountModal {...props} />);
  });
  return tree;
}

function rerender(
  tree: ReactTestRenderer,
  props: { visible: boolean; onClose: () => void; onSignedOut: () => void },
) {
  act(() => {
    tree.update(<ClerkAccountModal {...props} />);
  });
}

describe("ClerkAccountModal", () => {
  beforeEach(() => {
    mockIsSignedIn = true;
    mockUserProfileView.mockClear();
  });

  it("shows Clerk's account screen and closes when it is dismissed", () => {
    const props = { visible: true, onClose: jest.fn(), onSignedOut: jest.fn() };
    const tree = render(props);

    expect(mockUserProfileView).toHaveBeenCalled();
    const viewProps = mockUserProfileView.mock.calls.at(-1)?.[0];
    expect(viewProps.isDismissible).toBe(true);

    act(() => viewProps.onDismiss());
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onSignedOut).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("closes and hands off once when the user signs out inside Clerk's screen", () => {
    const props = { visible: true, onClose: jest.fn(), onSignedOut: jest.fn() };
    const tree = render(props);

    mockIsSignedIn = false;
    rerender(tree, props);
    rerender(tree, props);

    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onSignedOut).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("does nothing on a sign-out while the sheet is closed", () => {
    const props = { visible: false, onClose: jest.fn(), onSignedOut: jest.fn() };
    const tree = render(props);

    mockIsSignedIn = false;
    rerender(tree, props);

    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onSignedOut).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("does not treat a user who was never signed in as a sign-out", () => {
    mockIsSignedIn = false;
    const props = { visible: true, onClose: jest.fn(), onSignedOut: jest.fn() };
    const tree = render(props);
    rerender(tree, props);

    expect(props.onSignedOut).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });
});
