import React from "react";
import { act, create } from "react-test-renderer";

import IntlRankingsScreen from "@/app/comp-data/rankings";
import type { IntlRanking } from "@/lib/database/fetchIntlRankings";

const row = (meet: string, gender: IntlRanking["gender"], ranking: number): IntlRanking => ({
  meet,
  ranking,
  name: `${meet} ${gender} ${ranking}`,
  weightClass: "89kg",
  total: 300,
  percentA: 100,
  gender,
  ageCategory: "Senior",
});
const mockRankings = [row("Worlds", "Men", 1), row("Worlds", "Women", 1), row("Pan Ams", "Men", 1)];

let mockParams: Record<string, string> = {};
/** The rows the table was handed, render by render. */
const mockTableRenders: number[] = [];

jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockParams,
}));
jest.mock("@/components/ui/SubscriptionGate", () => ({
  SubscriptionGate: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@/components/ui/DataTable", () => ({
  DataTable: ({ data }: { data: unknown[] }) => {
    mockTableRenders.push(data.length);
    return null;
  },
}));
jest.mock("@/components/ui/FilterBar", () => ({ FilterBar: () => null }));
jest.mock("@/components/ui/filters", () => ({ GenericFilterModal: () => null }));
jest.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ currentTheme: "light" }) }));
jest.mock("@/hooks/useScreenInsets", () => ({ useScreenHorizontalInsets: () => ({}) }));
jest.mock("@/hooks/useMutableResource", () => ({
  useMutableResource: () => ({ data: mockRankings, isInitialLoading: false, error: null }),
}));

describe("Intl Rankings route filters (#358)", () => {
  it("opens an unfiltered link on the data defaults without a frame of every row", () => {
    mockParams = { meet: "Pan Ams", gender: "Men", age_category: "Senior" };
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<IntlRankingsScreen />);
    });
    expect(mockTableRenders.at(-1)).toBe(1);

    // The widget opens the screen again with no filters.
    mockTableRenders.length = 0;
    mockParams = {};
    act(() => {
      tree.update(<IntlRankingsScreen />);
    });
    // Worlds / Senior / Men: one row, and never all three.
    expect(mockTableRenders.length).toBeGreaterThan(0);
    expect(mockTableRenders).not.toContain(mockRankings.length);
    expect(mockTableRenders.at(-1)).toBe(1);
  });
});
