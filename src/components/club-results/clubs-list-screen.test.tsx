// Lives outside app/: Expo Router turns every file under app/ into a route.
import React from "react";
import { FlatList, Text, TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import ClubsListScreen from "@/app/comp-data/club-results/clubs-list";

void [FlatList, Text, TextInput];

const mockClubs = ["Catalyst Athletics", "Barbell Club", "Catalyst North"];

jest.mock("@/components/ui/SubscriptionGate", () => ({
  SubscriptionGate: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@/components/ui/IconSymbol", () => ({ IconSymbol: () => null }));
jest.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ currentTheme: "light" }) }));
jest.mock("@/hooks/useIsOffline", () => ({ useIsOffline: () => [false, jest.fn()] }));
jest.mock("@/hooks/useMutableResource", () => ({
  useMutableResource: () => ({
    data: mockClubs,
    isInitialLoading: false,
    error: null,
    refresh: jest.fn(),
  }),
}));
jest.mock("@/lib/database/fetch-club-stats", () => ({ clubsResource: {} }));
jest.mock("@/lib/posthog", () => ({ posthog: { capture: jest.fn() } }));
jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

let tree!: ReactTestRenderer;

function search(text: string) {
  act(() => {
    tree.root.findByType(TextInput).props.onChangeText(text);
  });
}

const shownClubs = (): string[] => tree.root.findByType(FlatList).props.data;

beforeEach(() => {
  act(() => {
    tree = create(<ClubsListScreen />);
  });
});

afterEach(() => {
  act(() => tree.unmount());
});

describe("Clubs list search", () => {
  it("ignores a trailing space from the keyboard", () => {
    search("Catalyst North ");
    expect(shownClubs()).toEqual(["Catalyst North"]);
  });

  it("matches every word of the query, in any order", () => {
    search("athletics catalyst");
    expect(shownClubs()).toEqual(["Catalyst Athletics"]);
  });

  it("names the trimmed query when nothing matches", () => {
    search("Nowhere  ");
    expect(JSON.stringify(tree.toJSON())).toContain('No clubs found matching \\"Nowhere\\"');
  });

  it("lets the first tap on a club reach the row while the keyboard is up", () => {
    search("catalyst");
    const list = tree.root.findByType(FlatList);
    expect(list.props.keyboardShouldPersistTaps).toBe("handled");
    expect(list.props.keyboardDismissMode).toBe("on-drag");
  });
});
