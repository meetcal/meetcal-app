/**
 * The route error boundaries and the PostHog screen tracker mounted by the
 * root layout. A render error must stay inside its screen (reported to
 * Sentry, with Try Again and Go Back), and screen views must come from the
 * router's pathname.
 */
import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Try } from "expo-router/build/views/Try";
import * as Sentry from "@sentry/react-native";
import {
  RootErrorBoundary,
  ScreenErrorBoundary,
} from "@/components/navigation/ScreenErrorBoundary";
import { PostHogScreenTracker } from "@/components/navigation/PostHogScreenTracker";
import { posthog } from "@/lib/posthog";

jest.mock("@sentry/react-native", () => ({ captureException: jest.fn() }));
jest.mock("@/lib/posthog", () => ({ posthog: { screen: jest.fn(async () => {}) } }));
jest.mock("@/lib/haptics", () => ({ lightImpact: jest.fn() }));
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  default: { View: jest.requireActual("react-native").View },
  useSharedValue: (value: number) => ({ value }),
  useAnimatedStyle: () => ({}),
  withSpring: () => 1,
}));

const mockRouter = { back: jest.fn(), canGoBack: jest.fn(() => true) };
let mockPathname = "/(tabs)/(index)";
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  usePathname: () => mockPathname,
}));

const mockCaptureException = Sentry.captureException as jest.Mock;
const mockScreen = posthog.screen as jest.Mock;

let shouldThrow = true;
function FlakyScreen() {
  if (shouldThrow) throw new Error("bad row");
  return <Text>Records</Text>;
}

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => String(node.props.children));
}

function press(renderer: ReactTestRenderer, label: string): void {
  const target = renderer.root.findAll(
    (node) =>
      typeof node.props?.onPress === "function" &&
      node.findAllByType(Text).some((text) => text.props.children === label),
  )[0];
  if (!target) throw new Error(`No button ${label}`);
  act(() => {
    target.props.onPress();
  });
}

describe("ScreenErrorBoundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    shouldThrow = true;
    mockRouter.canGoBack.mockReturnValue(true);
    // React logs caught render errors.
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mountScreen(): ReactTestRenderer {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <>
          <Text>Tab bar</Text>
          <Try catch={ScreenErrorBoundary}>
            <FlakyScreen />
          </Try>
        </>,
      );
    });
    return renderer;
  }

  it("keeps a screen's render error inside that screen and reports it", () => {
    const renderer = mountScreen();

    expect(texts(renderer)).toContain("Tab bar");
    expect(texts(renderer)).toContain("Something went wrong");
    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "bad row" }),
      { tags: { errorBoundary: "screen" } },
    );
  });

  it("re-renders the screen on Try Again", async () => {
    const renderer = mountScreen();
    shouldThrow = false;

    press(renderer, "Try Again");
    await act(async () => {});

    expect(texts(renderer)).toEqual(["Tab bar", "Records"]);
  });

  it("goes back when there is somewhere to go, and offers no Go Back otherwise", () => {
    const renderer = mountScreen();
    press(renderer, "Go Back");
    expect(mockRouter.back).toHaveBeenCalledTimes(1);

    mockRouter.canGoBack.mockReturnValue(false);
    const rootTab = mountScreen();
    expect(texts(rootTab)).not.toContain("Go Back");
  });

  it("the root boundary only retries", () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<RootErrorBoundary error={new Error("provider")} retry={async () => {}} />);
    });
    expect(texts(renderer)).toContain("Try Again");
    expect(texts(renderer)).not.toContain("Go Back");
    expect(mockCaptureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { errorBoundary: "root" },
    });
  });
});

describe("PostHogScreenTracker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPathname = "/(tabs)/(index)";
  });

  it("sends one screen view per pathname", () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<PostHogScreenTracker />);
    });
    expect(mockScreen).toHaveBeenCalledTimes(1);
    expect(mockScreen).toHaveBeenLastCalledWith("/(tabs)/(index)");

    act(() => renderer.update(<PostHogScreenTracker />));
    expect(mockScreen).toHaveBeenCalledTimes(1);

    mockPathname = "/comp-data/records";
    act(() => renderer.update(<PostHogScreenTracker />));
    expect(mockScreen).toHaveBeenCalledTimes(2);
    expect(mockScreen).toHaveBeenLastCalledWith("/comp-data/records");
  });
});
