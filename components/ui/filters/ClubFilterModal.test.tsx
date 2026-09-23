import React from "react";
import { act, create } from "react-test-renderer";
import ClubFilterModal from "@/components/ui/filters/ClubFilterModal";
import { STARRED_CLUBS_FILTER } from "@/lib/start-list-utils";
import type { LiftResult } from "@/data/types/athletes";

type FlashListCall = {
  data: readonly string[];
  keyExtractor: (item: string, index: number) => string;
  renderItem: (info: { item: string; index: number }) => React.ReactNode;
  ListHeaderComponent: React.ReactNode;
};

const flashListCalls: FlashListCall[] = [];

jest.mock("@shopify/flash-list", () => ({
  // Mirrors `DataTable.test.tsx`: the mock records its props and renders
  // nothing, so a test can prove the club rows are not mounted eagerly.
  FlashList: (props: FlashListCall) => {
    flashListCalls.push(props);
    return null;
  },
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

function makeAthletes(clubCount: number): LiftResult[] {
  return Array.from({ length: clubCount }, (_, i) => ({
    memberId: String(i),
    name: `Athlete ${i}`,
    club: `Club ${String(i).padStart(3, "0")}`,
  })) as unknown as LiftResult[];
}

function renderModal(props: Partial<React.ComponentProps<typeof ClubFilterModal>> = {}) {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(
      <ClubFilterModal
        visible
        onClose={jest.fn()}
        athletes={makeAthletes(500)}
        starredClubs={[]}
        onToggleStarredClub={jest.fn()}
        selectedClub=""
        onSelectClub={jest.fn()}
        {...props}
      />,
    );
  });
  return tree;
}

/** Render a detached fragment (a row, or the list header) to JSON. */
function renderToJson(node: React.ReactNode): string {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<>{node}</>);
  });
  return JSON.stringify(tree.toJSON());
}

beforeEach(() => {
  flashListCalls.length = 0;
});

describe("ClubFilterModal", () => {
  it("hands every club to the list without mounting a row per club", () => {
    renderModal();

    // A national meet's roster produces hundreds of distinct clubs. They must
    // reach the list as data, not as mounted `Pressable` + native icon views.
    expect(flashListCalls).toHaveLength(1);
    expect(flashListCalls[0].data).toHaveLength(500);
  });

  it("keys rows by club name and renders the club it was handed", () => {
    renderModal();

    const { data, keyExtractor, renderItem } = flashListCalls[0];
    expect(keyExtractor(data[0], 0)).toBe("Club 000");

    expect(renderToJson(renderItem({ item: "Club 000", index: 0 }))).toContain(
      "Club 000",
    );
  });

  it("keeps the fixed rows in the list header rather than in the data", () => {
    renderModal({ starredClubs: ["Club 001"] });

    const { data, ListHeaderComponent } = flashListCalls[0];
    // "All Clubs" and "Favorites" are chrome; they must not become rows the
    // club search can filter away.
    expect(data).not.toContain(STARRED_CLUBS_FILTER);
    const headerJson = renderToJson(ListHeaderComponent);
    expect(headerJson).toContain("All Clubs");
    expect(headerJson).toContain("Favorites");
  });

  it("omits the favorites row when nothing is starred", () => {
    renderModal({ starredClubs: [] });

    const headerJson = renderToJson(flashListCalls[0].ListHeaderComponent);
    expect(headerJson).toContain("All Clubs");
    expect(headerJson).not.toContain("Favorites");
  });
});
