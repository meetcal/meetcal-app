// Lives outside app/: Expo Router turns every file under app/ into a route.
import React from "react";
import { FlatList, Text, TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import ClubMeetsListScreen from "@/app/comp-data/club-results/meets-list";

void [FlatList, Text, TextInput];

const mockClubAthletes = [
  { name: "A", meet: "Spring Open" },
  { name: "B", meet: "Fall Classic" },
];

jest.mock("@/components/ui/SubscriptionGate", () => ({
  SubscriptionGate: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@/components/ui/IconSymbol", () => ({ IconSymbol: () => null }));
jest.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ currentTheme: "light" }) }));
jest.mock("@/hooks/useIsOffline", () => ({ useIsOffline: () => [false, jest.fn()] }));
jest.mock("@/hooks/useMutableResource", () => ({
  useMutableResource: () => ({
    data: mockClubAthletes,
    isInitialLoading: false,
    error: null,
    refresh: jest.fn(),
  }),
}));
jest.mock("@/lib/database/fetch-club-stats", () => ({ clubAthletesResource: {} }));
jest.mock("@/lib/posthog", () => ({ posthog: { capture: jest.fn() } }));
jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ club: "Barbell Club" }),
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

function texts(tree: ReactTestRenderer): string[] {
  return tree.root.findAllByType(Text).flatMap((n) => {
    const c = n.props.children;
    return typeof c === "string" ? [c] : [];
  });
}

describe("Club meets list empty state", () => {
  it("says the search found nothing, without the athlete count", () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<ClubMeetsListScreen />);
    });
    act(() => {
      tree.root.findByType(TextInput).props.onChangeText("nationals ");
    });

    const shown = texts(tree);
    expect(shown).toContain('No meets match "nationals"');
    expect(shown.some((t) => t.startsWith("Athletes:"))).toBe(false);
    expect(shown.some((t) => t.startsWith("No meets found for"))).toBe(false);
    act(() => tree.unmount());
  });
});

describe("Club meets list search", () => {
  it("lets the first tap on a meet reach the row while the keyboard is up", () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<ClubMeetsListScreen />);
    });
    act(() => {
      tree.root.findByType(TextInput).props.onChangeText("spring");
    });

    const list = tree.root.findByType(FlatList);
    expect(list.props.keyboardShouldPersistTaps).toBe("handled");
    expect(list.props.keyboardDismissMode).toBe("on-drag");
    act(() => tree.unmount());
  });
});
