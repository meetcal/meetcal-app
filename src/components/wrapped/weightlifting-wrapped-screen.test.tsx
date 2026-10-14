/**
 * The Wrapped search box wired to `useNameSuggestions`: the hook's guards
 * only help if the screen calls `dismissSuggestions` on pick and on submit.
 * The suggestion request is the real `fetchNameSuggestions` → `searchApi`.
 * Also: the screen acts on `fetchWrapped`'s server answer (several athletes
 * → ask which one; the server's selection rules are in
 * `convex-tests/wrapped.test.ts`), and the slide pager re-anchors when the
 * window width changes.
 */
import React from "react";
import {
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
} from "react-native";
import { captureViewAsPng } from "@/lib/share-image";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import WeightliftingWrappedScreen from "@/app/comp-data/weightlifting-wrapped";
import { fetchWrapped, searchApi, type ApiWrappedStats } from "@/lib/api/meetcal-api";
import { SUGGESTION_DEBOUNCE_MS } from "@/hooks/useNameSuggestions";
import { showToast } from "@/components/ui/Toast";

jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: jest.fn(),
}));
const useWindowDimensions = require("react-native/Libraries/Utilities/useWindowDimensions")
  .default as jest.Mock;
function setWidth(width: number) {
  useWindowDimensions.mockReturnValue({ width, height: 900, scale: 3, fontScale: 1 });
}

jest.mock("react-native-reanimated", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  // `FadeInDown.duration(600).delay(100)` and friends: any chain is inert.
  const chain: Record<string, unknown> = {};
  for (const key of ["duration", "delay", "springify", "easing"]) chain[key] = () => chain;
  const identity = (value: unknown) => value;
  return {
    __esModule: true,
    default: { View },
    FadeIn: chain,
    FadeInDown: chain,
    FadeInUp: chain,
    Easing: { cubic: identity, out: identity },
    useSharedValue: (value: unknown) => ({ value }),
    useAnimatedStyle: () => ({}),
    withDelay: (_ms: number, value: unknown) => value,
    withRepeat: identity,
    withSequence: identity,
    withSpring: identity,
    withTiming: identity,
  };
});
jest.mock("react-native-view-shot", () => {
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return { __esModule: true, default: View };
});
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }));
jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@/components/ui/IconSymbol", () => ({ IconSymbol: () => null }));
jest.mock("@/components/ui/Toast", () => ({ showToast: jest.fn() }));
jest.mock("@/lib/share-image", () => ({
  captureViewAsPng: jest.fn(),
  shareImageFile: jest.fn(),
}));
jest.mock("@/hooks/useIsOffline", () => ({ useIsOffline: () => [false, jest.fn()] }));
jest.mock("@/lib/api/meetcal-api", () => ({ searchApi: jest.fn(), fetchWrapped: jest.fn() }));

type SearchResponse = Awaited<ReturnType<typeof searchApi>>;
type Pending = { query: string; resolve: (response: SearchResponse) => void };
let pending: Pending[] = [];

function suggestionResponse(names: string[]): SearchResponse {
  return { suggestions: names, results: [] } as unknown as SearchResponse;
}

let tree!: ReactTestRenderer;

function input() {
  return tree.root.findByType(TextInput);
}

/** Names in the dropdown (not the search box's own value). */
function shownNames(): string[] {
  return ["John Smith", "Johnny Smithers"].filter(
    (name) =>
      tree.root.findAll(
        (n) => typeof n.type === "string" && n.props.children === name,
      ).length > 0,
  );
}

function typeAndPause(text: string) {
  act(() => {
    input().props.onChangeText(text);
  });
  act(() => {
    jest.advanceTimersByTime(SUGGESTION_DEBOUNCE_MS);
  });
}

async function answer(query: string, names: string[]) {
  const request = pending.find((p) => p.query === query);
  if (!request) throw new Error(`no request for ${query}`);
  await act(async () => {
    request.resolve(suggestionResponse(names));
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  setWidth(466);
  jest.mocked(showToast).mockClear();
  pending = [];
  jest.mocked(searchApi).mockReset();
  jest.mocked(searchApi).mockImplementation(
    (query: string) => new Promise<SearchResponse>((resolve) => pending.push({ query, resolve })),
  );
  jest.mocked(fetchWrapped).mockReset();
  jest.mocked(fetchWrapped).mockResolvedValue({ kind: "none", suggestions: [] });
  act(() => {
    tree = create(<WeightliftingWrappedScreen />);
  });
});

afterEach(() => {
  act(() => {
    tree.unmount();
  });
  jest.useRealTimers();
});

describe("WeightliftingWrappedScreen name suggestions", () => {
  it("looks names up once per typing pause and shows them", async () => {
    typeAndPause("john smi");
    expect(jest.mocked(searchApi).mock.calls).toEqual([["john smi"]]);
    await answer("john smi", ["John Smith", "Johnny Smithers", "Jane Doe"]);
    expect(shownNames()).toEqual(["John Smith", "Johnny Smithers"]);
  });

  it("a slow answer does not reopen the dropdown after the search was submitted", async () => {
    typeAndPause("john smi");
    await act(async () => {
      await input().props.onSubmitEditing();
    });
    await answer("john smi", ["John Smith"]);
    expect(shownNames()).toEqual([]);
  });

  it("picking a suggestion fills the box and a slower older answer does not reopen it", async () => {
    typeAndPause("john");
    typeAndPause("john smi");
    await answer("john smi", ["John Smith", "Johnny Smithers"]);

    const pick = tree.root.findAll(
      (n) =>
        typeof n.props.onPress === "function" &&
        n.findAll((c) => c.props.children === "John Smith").length > 0,
    )[0];
    expect(pick).toBeDefined();
    act(() => {
      pick.props.onPress();
    });
    expect(input().props.value).toBe("John Smith");
    expect(shownNames()).toEqual([]);

    await answer("john", ["John Smith"]);
    expect(shownNames()).toEqual([]);
  });
});

type WrappedAnswer = Awaited<ReturnType<typeof fetchWrapped>>;

function wrappedStats(overrides: Partial<ApiWrappedStats> = {}): ApiWrappedStats {
  return {
    totalWeightLifted: 1185,
    totalMeets: 1,
    makePercentage: 66.7,
    bestSnatch: 95,
    bestCleanJerk: 205,
    bestTotal: 300,
    averageTotal: 300,
    topMeet: "Meet 2025-03-01",
    improvementFromFirst: null,
    longestMakeStreak: 2,
    favoriteAttempt: 1,
    yearRank: "Top 10%",
    ...overrides,
  };
}

function athleteAnswer(name: string, stats: ApiWrappedStats = wrappedStats()): WrappedAnswer {
  return { kind: "athlete", name, stats };
}

function wrappedAnswers(answer: WrappedAnswer) {
  jest.mocked(fetchWrapped).mockResolvedValue(answer);
}

async function submit(text: string) {
  act(() => {
    input().props.onChangeText(text);
  });
  await submitBox();
}

async function submitBox() {
  await act(async () => {
    await input().props.onSubmitEditing();
  });
}

function texts(): string[] {
  return tree.root.findAllByType(Text).flatMap((n) => {
    const c = n.props.children;
    return typeof c === "string" ? [c] : [];
  });
}

function pickShown(name: string) {
  const pick = tree.root.findAll(
    (n) =>
      typeof n.props.onPress === "function" &&
      n.findAll((c) => c.props.children === name).length > 0,
  )[0];
  expect(pick).toBeDefined();
  act(() => {
    pick.props.onPress();
  });
}

describe("WeightliftingWrappedScreen athlete selection", () => {
  it("asks the server with the trimmed name and the selected year", async () => {
    await submit("  John Smith  ");
    expect(jest.mocked(fetchWrapped).mock.calls).toEqual([
      ["John Smith", new Date().getFullYear(), false],
    ]);
  });

  it("asks which athlete when several match, and the pick fills the box", async () => {
    wrappedAnswers({ kind: "ambiguous", names: ["Jane Smith", "John Smith"], truncated: false });
    await submit("Smith");

    expect(tree.root.findAllByType(FlatList)).toHaveLength(0);
    expect(texts()).toEqual(expect.arrayContaining(["DID YOU MEAN…", "Jane Smith", "John Smith"]));
    expect(jest.mocked(showToast)).toHaveBeenCalledWith(
      expect.objectContaining({ type: "info", message: "Several athletes match Smith. Pick one." }),
    );

    pickShown("Jane Smith");
    expect(input().props.value).toBe("Jane Smith");
    expect(texts()).not.toContain("DID YOU MEAN…");
  });

  it("asks for more of the name too when the matching athletes were cut", async () => {
    wrappedAnswers({ kind: "ambiguous", names: ["Jane Doe"], truncated: true });
    await submit("an");

    expect(tree.root.findAllByType(FlatList)).toHaveLength(0);
    expect(texts()).toEqual(expect.arrayContaining(["DID YOU MEAN…", "Jane Doe"]));
    expect(jest.mocked(showToast)).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "info",
        message: expect.stringContaining("Many athletes match an"),
      }),
    );
    expect(jest.mocked(showToast)).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("type more of the name") }),
    );
  });

  it("sends picked: true for a name picked from the dropdown", async () => {
    const year = new Date().getFullYear();
    wrappedAnswers({ kind: "ambiguous", names: ["Jane Smith", "John Smith"], truncated: false });
    await submit("Smith");
    pickShown("Jane Smith");

    wrappedAnswers(athleteAnswer("Jane Smith"));
    await submitBox();
    expect(jest.mocked(fetchWrapped)).toHaveBeenLastCalledWith("Jane Smith", year, true);
    expect(texts()).toContain("JANE SMITH");
  });

  it("sends picked: false once the picked name is edited", async () => {
    const year = new Date().getFullYear();
    wrappedAnswers({ kind: "ambiguous", names: ["Jane Smith", "John Smith"], truncated: false });
    await submit("Smith");
    pickShown("Jane Smith");

    await submit("Jane Smit");
    expect(jest.mocked(fetchWrapped)).toHaveBeenLastCalledWith("Jane Smit", year, false);
  });

  it("an edit that lands back on the picked text is no longer a pick", async () => {
    const year = new Date().getFullYear();
    wrappedAnswers({ kind: "ambiguous", names: ["Jane Smith", "John Smith"], truncated: false });
    await submit("Smith");
    pickShown("Jane Smith");
    act(() => {
      input().props.onChangeText("Jane Smit");
    });
    act(() => {
      input().props.onChangeText("Jane Smith");
    });
    await submitBox();
    expect(jest.mocked(fetchWrapped)).toHaveBeenLastCalledWith("Jane Smith", year, false);
  });

  it("asks for more of the name, not \"no results\", when too many athletes match", async () => {
    wrappedAnswers({ kind: "narrow" });
    await submit("an");

    expect(tree.root.findAllByType(FlatList)).toHaveLength(0);
    expect(jest.mocked(showToast)).toHaveBeenCalledWith(
      expect.objectContaining({ type: "info", message: expect.stringContaining("Type more of the name") }),
    );
    expect(jest.mocked(showToast)).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("No results") }),
    );
  });

  it("does not build a Wrapped when the athlete's year has too many results", async () => {
    wrappedAnswers({ kind: "tooManyResults", name: "John Smith" });
    await submit("john smith");

    expect(tree.root.findAllByType(FlatList)).toHaveLength(0);
    expect(jest.mocked(showToast)).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        message: expect.stringContaining("John Smith has more"),
      }),
    );
  });

  it("says no results when nobody matches", async () => {
    wrappedAnswers({ kind: "none", suggestions: [] });
    await submit("Nobody");

    expect(tree.root.findAllByType(FlatList)).toHaveLength(0);
    expect(jest.mocked(showToast)).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "info",
        message: `No results found for Nobody in ${new Date().getFullYear()}`,
      }),
    );
  });

  it("builds the Wrapped under the answer's name with the server's stats", async () => {
    wrappedAnswers(athleteAnswer("John Smith", wrappedStats({ topMeet: "Spring Open", yearRank: "Top 5%" })));
    await submit("john smith");
    expect(tree.root.findAllByType(FlatList)).toHaveLength(1);
    // The title slide upper-cases the name.
    expect(texts()).toContain("JOHN SMITH");
    expect(texts()).toEqual(expect.arrayContaining(["Spring Open", "Top 5%"]));
  });

  it("shows an error toast when the request fails", async () => {
    jest.mocked(fetchWrapped).mockRejectedValue(new Error("network"));
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    await submit("John Smith");

    expect(tree.root.findAllByType(FlatList)).toHaveLength(0);
    expect(jest.mocked(showToast)).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error", message: "An unexpected error occurred" }),
    );
    error.mockRestore();
  });
});

describe("WeightliftingWrappedScreen search submit", () => {
  it("ignores the return key while a search is already running", async () => {
    let finish!: (answer: WrappedAnswer) => void;
    jest.mocked(fetchWrapped).mockImplementation(
      () => new Promise<WrappedAnswer>((resolve) => (finish = resolve)),
    );
    act(() => {
      input().props.onChangeText("John Smith");
    });
    await act(async () => {
      void input().props.onSubmitEditing();
      void input().props.onSubmitEditing();
    });
    await act(async () => {
      void input().props.onSubmitEditing();
    });

    expect(jest.mocked(fetchWrapped)).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish({ kind: "none", suggestions: [] });
    });
    // Once it lands, the next submit goes through again (and stays pending).
    await act(async () => {
      void input().props.onSubmitEditing();
    });
    expect(jest.mocked(fetchWrapped)).toHaveBeenCalledTimes(2);
  });
});

describe("WeightliftingWrappedScreen share", () => {
  it("shows a toast when both the image share and the text fallback fail", async () => {
    wrappedAnswers(athleteAnswer("John Smith"));
    await submit("John Smith");
    // The share button sits on the last slide.
    act(() => {
      tree.root.findByType(FlatList).props.onMomentumScrollEnd({
        nativeEvent: { contentOffset: { x: 6 * 466, y: 0 } },
      } as NativeSyntheticEvent<NativeScrollEvent>);
    });
    jest.mocked(captureViewAsPng).mockRejectedValueOnce(new Error("capture failed"));
    const share = jest.spyOn(Share, "share").mockRejectedValueOnce(new Error("share failed"));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    // `LinearGradient` is mocked to render nothing, so the label is only in
    // the gradient's (unrendered) children.
    const isShareLabel = (child: unknown) =>
      React.isValidElement<{ children?: unknown }>(child) &&
      child.props.children === "SHARE YOUR WRAPPED";
    const [shareButton] = tree.root.findAll(
      (n) =>
        typeof n.props.onPress === "function" &&
        n.findAll((c) => React.Children.toArray(c.props.children).some(isShareLabel)).length > 0,
    );
    expect(shareButton).toBeDefined();
    await act(async () => {
      await shareButton.props.onPress();
    });

    expect(share).toHaveBeenCalledTimes(1);
    expect(jest.mocked(showToast)).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error" }),
    );
    warn.mockRestore();
    share.mockRestore();
  });
});

describe("WeightliftingWrappedScreen slide pager", () => {
  it("re-anchors the current slide when the window width changes", async () => {
    wrappedAnswers(athleteAnswer("John Smith"));
    await submit("John Smith");
    const pager = () => tree.root.findByType(FlatList);
    const scrollToOffset = jest.spyOn(pager().instance as FlatList, "scrollToOffset");

    act(() => {
      pager().props.onMomentumScrollEnd({
        nativeEvent: { contentOffset: { x: 3 * 466, y: 0 } },
      } as NativeSyntheticEvent<NativeScrollEvent>);
    });
    expect(scrollToOffset).not.toHaveBeenCalled();

    setWidth(382);
    act(() => {
      tree.update(<WeightliftingWrappedScreen />);
    });
    expect(scrollToOffset).toHaveBeenCalledTimes(1);
    expect(scrollToOffset).toHaveBeenCalledWith({ offset: 3 * 382, animated: false });
  });
});

describe("WeightliftingWrappedScreen search page padding", () => {
  it("keeps its side padding when the side insets are zero", () => {
    // Regression (#280): `paddingLeft: insets.left` overrode the 28pt
    // `paddingHorizontal`, so on a regular phone the page sat flush with the
    // screen edges.
    const page = tree.root
      .findAllByType(ScrollView)
      .find((n) => n.props.keyboardShouldPersistTaps === "handled");
    expect(page).toBeDefined();
    const style = StyleSheet.flatten(page!.props.contentContainerStyle);
    expect(style.paddingLeft).toBe(28);
    expect(style.paddingRight).toBe(28);
  });
});

function yearPill(year: number) {
  return tree.root.find(
    (n) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === String(year),
  );
}

describe("WeightliftingWrappedScreen search year", () => {
  it("labels the Wrapped with the year it searched, even if the year changes mid-search", async () => {
    // Regression (#303): the slides and share caption read the live year
    // pill, so tapping another year while the search ran labelled one year's
    // results with the other year.
    const thisYear = new Date().getFullYear();
    const lastYear = thisYear - 1;
    let finish!: (answer: WrappedAnswer) => void;
    jest.mocked(fetchWrapped).mockImplementation(
      () => new Promise<WrappedAnswer>((resolve) => (finish = resolve)),
    );
    act(() => {
      input().props.onChangeText("John Smith");
    });
    await act(async () => {
      void input().props.onSubmitEditing();
    });
    expect(jest.mocked(fetchWrapped)).toHaveBeenCalledWith("John Smith", thisYear, false);

    // The pills are disabled while the search runs; a press that still gets
    // through must not relabel the result.
    expect(yearPill(lastYear).props.disabled).toBe(true);
    act(() => {
      yearPill(lastYear).props.onPress();
    });
    await act(async () => {
      finish(athleteAnswer("John Smith"));
    });

    expect(tree.root.findAllByType(FlatList)).toHaveLength(1);
    expect(texts()).toContain(`BEST OF ${thisYear}`);
    expect(texts()).not.toContain(`BEST OF ${lastYear}`);
  });
});

describe("WeightliftingWrappedScreen tap to advance", () => {
  async function openWrapped() {
    wrappedAnswers(athleteAnswer("John Smith"));
    await submit("John Smith");
  }

  function selectedDot(): string | undefined {
    return tree.root
      .findAll(
        (n) =>
          typeof n.props.accessibilityLabel === "string" &&
          n.props.accessibilityLabel.startsWith("Slide ") &&
          n.props.accessibilityState?.selected === true,
      )
      .map((n) => n.props.accessibilityLabel as string)[0];
  }

  function tapSlide(index: number, pageX: number, locationX: number) {
    const slides = tree.root.findAll(
      (n) =>
        typeof n.props.onPress === "function" &&
        StyleSheet.flatten(n.props.style)?.paddingLeft === 24,
    );
    act(() => {
      slides[index].props.onPress({ nativeEvent: { pageX, locationX } });
    });
  }

  it("reads the tap's screen position, not its position inside the touched element", async () => {
    // Regression (#304): `locationX` is relative to the touched element, so
    // the right half of a narrow centred card went back a slide.
    await openWrapped();
    const pager = tree.root.findByType(FlatList).instance as FlatList;
    jest.spyOn(pager, "scrollToIndex").mockImplementation(() => {});
    expect(selectedDot()).toBe("Slide 1 of 7");

    // Width 466: the right zone starts past 326.
    tapSlide(0, 400, 20);
    expect(selectedDot()).toBe("Slide 2 of 7");

    // Middle of the screen, left edge of a card: no change.
    tapSlide(1, 233, 5);
    expect(selectedDot()).toBe("Slide 2 of 7");

    tapSlide(1, 40, 300);
    expect(selectedDot()).toBe("Slide 1 of 7");
  });
});
