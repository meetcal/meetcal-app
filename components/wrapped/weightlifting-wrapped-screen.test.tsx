/**
 * The Wrapped search box wired to `useNameSuggestions`: the hook's guards
 * only help if the screen calls `dismissSuggestions` on pick and on submit.
 * The suggestion request is the real `fetchNameSuggestions` → `searchApi`.
 * Also: a search matching several athletes asks which one (never merges
 * them), and the slide pager re-anchors when the window width changes.
 */
import React from "react";
import {
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Text,
  TextInput,
} from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import WeightliftingWrappedScreen from "@/app/comp-data/weightlifting-wrapped";
import { searchApi } from "@/lib/api/meetcal-api";
import { SUGGESTION_DEBOUNCE_MS } from "@/hooks/useNameSuggestions";
import { showToast } from "@/components/ui/Toast";
import type { SupabaseLiftResult } from "@/data/types/athletes";

jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: jest.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
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
jest.mock("@/lib/api/meetcal-api", () => ({ searchApi: jest.fn() }));

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
    (query: string, startDate?: string) =>
      new Promise<SearchResponse>((resolve) => {
        // Only suggestion lookups (no date range) are held open.
        if (startDate) resolve(suggestionResponse([]));
        else pending.push({ query, resolve });
      }),
  );
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

let nextId = 1;
function liftRow(name: string, date: string, total: number): SupabaseLiftResult {
  return {
    id: nextId++,
    event_id: `event-${nextId}`,
    meet: `Meet ${date}`,
    date,
    name,
    age: "Open Men's 89kg",
    body_weight: 88,
    snatch1: 90,
    snatch2: 95,
    snatch3: null,
    snatch_best: 95,
    cj1: total - 95,
    cj2: null,
    cj3: null,
    cj_best: total - 95,
    total,
  };
}

function rangedSearchAnswers(response: SearchResponse) {
  jest.mocked(searchApi).mockImplementation(async (_query: string, startDate?: string) =>
    startDate ? response : suggestionResponse([]),
  );
}

async function submit(text: string) {
  act(() => {
    input().props.onChangeText(text);
  });
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

describe("WeightliftingWrappedScreen athlete selection", () => {
  it("asks which athlete instead of merging everyone the fallback matched", async () => {
    rangedSearchAnswers({
      matchedName: null,
      suggestions: ["Jane Smith", "John Smith"],
      results: [
        liftRow("John Smith", "2025-03-01", 300),
        liftRow("Jane Smith", "2025-04-01", 150),
      ],
    });
    await submit("Smith");

    expect(tree.root.findAllByType(FlatList)).toHaveLength(0);
    expect(texts()).toEqual(expect.arrayContaining(["DID YOU MEAN…", "Jane Smith", "John Smith"]));
    expect(jest.mocked(showToast)).toHaveBeenCalledWith(
      expect.objectContaining({ type: "info", message: expect.stringContaining("Several athletes") }),
    );

    const pick = tree.root.findAll(
      (n) =>
        typeof n.props.onPress === "function" &&
        n.findAll((c) => c.props.children === "Jane Smith").length > 0,
    )[0];
    act(() => {
      pick.props.onPress();
    });
    expect(input().props.value).toBe("Jane Smith");
    expect(texts()).not.toContain("DID YOU MEAN…");
  });

  it("builds the Wrapped of an exact match under the athlete's name", async () => {
    rangedSearchAnswers({
      matchedName: "john smith",
      suggestions: [],
      results: [liftRow("John Smith", "2025-03-01", 300)],
    });
    await submit("john smith");
    expect(tree.root.findAllByType(FlatList)).toHaveLength(1);
    // The title slide upper-cases the name.
    expect(texts()).toContain("JOHN SMITH");
  });
});

describe("WeightliftingWrappedScreen slide pager", () => {
  it("re-anchors the current slide when the window width changes", async () => {
    rangedSearchAnswers({
      matchedName: "John Smith",
      suggestions: [],
      results: [liftRow("John Smith", "2025-03-01", 300)],
    });
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
