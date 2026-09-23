import React from "react";
import { Text } from "react-native";
import { act, create } from "react-test-renderer";
import { DataTable } from "@/components/ui/DataTable";

type FlashListCall = {
  data: unknown[];
  keyExtractor: (item: unknown, index: number) => string;
  renderItem: (info: { item: unknown; index: number }) => React.ReactNode;
};

const flashListCalls: FlashListCall[] = [];

jest.mock("@shopify/flash-list", () => ({
  // The real list only mounts the rows it can see, which is the whole point of
  // the virtualized path. The mock records what it was handed and renders
  // nothing, so a test can prove rows are NOT mounted eagerly.
  FlashList: (props: FlashListCall) => {
    flashListCalls.push(props);
    return null;
  },
}));

type Row = { id: number; name: string };

const COLUMNS = [
  { label: "Rank", width: 50 },
  { label: "Name", flex: 1 },
];

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    name: `Athlete ${i}`,
  }));
}

function renderTable(props: Partial<React.ComponentProps<typeof DataTable<Row>>>) {
  const renderRow = jest.fn((item: Row) => <Text>{item.name}</Text>);
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(
      <DataTable
        columns={COLUMNS}
        data={makeRows(50)}
        renderRow={renderRow}
        keyExtractor={(item) => String(item.id)}
        {...props}
      />,
    );
  });
  return { tree, renderRow };
}

beforeEach(() => {
  flashListCalls.length = 0;
});

describe("DataTable", () => {
  it("mounts every row when not virtualized", () => {
    const { renderRow } = renderTable({});

    expect(renderRow).toHaveBeenCalledTimes(50);
    expect(flashListCalls).toHaveLength(0);
  });

  it("does not mount rows eagerly when virtualized", () => {
    const { renderRow } = renderTable({ virtualized: true });

    expect(renderRow).not.toHaveBeenCalled();
    expect(flashListCalls).toHaveLength(1);
    expect(flashListCalls[0].data).toHaveLength(50);
  });

  it("keeps the same row identity and content in the virtualized path", () => {
    renderTable({ virtualized: true });

    const { data, keyExtractor, renderItem } = flashListCalls[0];
    // Keys and row content must come from the caller's own functions,
    // unchanged, or virtualizing would silently reorder or blank the table.
    expect(keyExtractor(data[7], 7)).toBe("7");
    expect(renderItem({ item: data[7], index: 7 })).toBeTruthy();
  });

  it("shows the empty message instead of a list when there are no rows", () => {
    const { renderRow } = renderTable({
      virtualized: true,
      data: [],
      emptyMessage: "No rankings available.",
    });

    expect(renderRow).not.toHaveBeenCalled();
    expect(flashListCalls).toHaveLength(0);
  });

  it("shows the error instead of a list when the fetch failed", () => {
    renderTable({ virtualized: true, error: "boom" });

    expect(flashListCalls).toHaveLength(0);
  });

  it("shows loading instead of a list while loading", () => {
    renderTable({ virtualized: true, loading: true });

    expect(flashListCalls).toHaveLength(0);
  });
});
