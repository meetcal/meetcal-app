import React from "react";
import { TextInput } from "react-native";
import { act, create } from "react-test-renderer";
import AllMeetResultsScreen from "@/app/comp-data/all-meet-results";
import { searchAthletesByName } from "@/lib/database/queries";

/**
 * The debounced athlete search. `performSearch` is an Effect Event, so the
 * debounce effect must re-arm only when the query text changes: re-renders
 * from loading/results state must not fire a second request.
 */

jest.mock("@/components/ui/SubscriptionGate", () => ({
  SubscriptionGate: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ currentTheme: "light" }) }));
jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@/components/ui/IconSymbol", () => ({ IconSymbol: () => null }));
jest.mock("@/lib/posthog", () => ({ posthog: { capture: jest.fn() } }));
jest.mock("@/lib/networkUtils", () => ({
  isNetworkAvailable: jest.fn(async () => true),
  subscribeToNetworkChanges: jest.fn(() => () => {}),
}));
jest.mock("@/lib/database/queries", () => ({ searchAthletesByName: jest.fn() }));

const SEARCH_DEBOUNCE_MS = 500;

const mockSearch = jest.mocked(searchAthletesByName);

let tree!: ReturnType<typeof create>;

async function render(): Promise<void> {
  await act(async () => {
    tree = create(<AllMeetResultsScreen />);
  });
}

async function type(text: string): Promise<void> {
  await act(async () => {
    tree.root.findByType(TextInput).props.onChangeText(text);
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockSearch.mockReset();
});

afterEach(async () => {
  await act(async () => {
    tree.unmount();
  });
  jest.useRealTimers();
});

it("searches once for the settled query, not for each keystroke", async () => {
  mockSearch.mockResolvedValue(["Jane Smith"]);
  await render();

  await type("Smi");
  await advance(SEARCH_DEBOUNCE_MS - 1);
  await type("Smith");
  await advance(SEARCH_DEBOUNCE_MS);

  expect(mockSearch).toHaveBeenCalledTimes(1);
  expect(mockSearch).toHaveBeenCalledWith("Smith");
  expect(JSON.stringify(tree.toJSON())).toContain("Jane Smith");
});

it("does not search again when the results re-render the screen", async () => {
  mockSearch.mockResolvedValue(["Jane Smith", "John Smith"]);
  await render();

  await type("Smith");
  await advance(SEARCH_DEBOUNCE_MS);
  expect(JSON.stringify(tree.toJSON())).toContain("John Smith");

  // Loading and results state changes re-rendered the screen; only a new
  // query may re-arm the debounce timer.
  await advance(SEARCH_DEBOUNCE_MS * 4);
  expect(mockSearch).toHaveBeenCalledTimes(1);

  await type("Smithe");
  await advance(SEARCH_DEBOUNCE_MS);
  expect(mockSearch).toHaveBeenCalledTimes(2);
  expect(mockSearch).toHaveBeenLastCalledWith("Smithe");
});

it("drops a slower earlier response once a newer query has been sent", async () => {
  let resolveFirst!: (names: string[]) => void;
  mockSearch
    .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
    .mockResolvedValueOnce(["Newer Result"]);
  await render();

  await type("Old");
  await advance(SEARCH_DEBOUNCE_MS);
  await type("New");
  await advance(SEARCH_DEBOUNCE_MS);
  await act(async () => {
    resolveFirst(["Stale Result"]);
  });

  const rendered = JSON.stringify(tree.toJSON());
  expect(rendered).toContain("Newer Result");
  expect(rendered).not.toContain("Stale Result");
});
