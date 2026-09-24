import React from "react";
import { act, create } from "react-test-renderer";

import { ExpandedIdProvider, useExpandedRow } from "@/contexts/ExpandedIdContext";

const ROWS = 20;
const renders = new Map<string, number>();
const toggles = new Map<string, () => boolean>();

const Row = React.memo(function Row({ id }: { id: string }) {
  const { isExpanded, toggle } = useExpandedRow(id);
  toggles.set(id, toggle);
  renders.set(id, (renders.get(id) ?? 0) + 1);
  return <>{isExpanded ? `${id}:open` : null}</>;
});

function mountRows() {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(
      <ExpandedIdProvider>
        {Array.from({ length: ROWS }, (_, i) => (
          <Row key={i} id={`row-${i}`} />
        ))}
      </ExpandedIdProvider>,
    );
  });
  return tree;
}

const totalRenders = () => [...renders.values()].reduce((sum, n) => sum + n, 0);

beforeEach(() => {
  renders.clear();
  toggles.clear();
});

describe("ExpandedIdProvider", () => {
  // Before: every mounted row read the expanded id from context and
  // re-rendered on every tap (20 of 20 here, both to open and to switch).
  it("re-renders only the rows whose expanded state changes", () => {
    const tree = mountRows();

    renders.clear();
    act(() => {
      expect(toggles.get("row-3")!()).toBe(true);
    });
    expect(totalRenders()).toBe(1);
    expect(renders.get("row-3")).toBe(1);

    renders.clear();
    act(() => {
      toggles.get("row-7")!();
    });
    expect(totalRenders()).toBe(2);
    expect([...renders.keys()].sort()).toEqual(["row-3", "row-7"]);
    expect(tree.toJSON()).toEqual("row-7:open");
  });

  it("collapses the open row when it is tapped again", () => {
    const tree = mountRows();

    act(() => {
      toggles.get("row-1")!();
    });
    let expanded = true;
    act(() => {
      expanded = toggles.get("row-1")!();
    });

    expect(expanded).toBe(false);
    expect(tree.toJSON()).toBeNull();
  });

  it("throws outside a provider", () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      act(() => {
        create(<Row id="orphan" />);
      }),
    ).toThrow("useExpandedRow must be used within an ExpandedIdProvider");
    jest.restoreAllMocks();
  });
});
