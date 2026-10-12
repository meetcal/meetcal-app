import React from "react";
import { act, create } from "react-test-renderer";

import { DEFAULT_START_LIST_FILTERS, type StartListFilters } from "@/lib/start-list-utils";
import { useStartListFilters } from "./useStartListFilters";

let hook!: ReturnType<typeof useStartListFilters>;
/** Every `filters` value a render produced, to catch a frame of stale filters. */
let rendered: { meet: string | null; filters: StartListFilters }[] = [];

function Harness({ meet }: { meet: string | null }) {
  const value = useStartListFilters(meet);
  rendered.push({ meet, filters: value.filters });
  React.useEffect(() => {
    hook = value;
  });
  return null;
}

let tree!: ReturnType<typeof create>;

beforeEach(() => {
  rendered = [];
  act(() => {
    tree = create(<Harness meet="Meet A" />);
  });
});

afterEach(() => {
  act(() => tree.unmount());
});

describe("useStartListFilters", () => {
  it("starts from the defaults", () => {
    expect(hook.filters).toEqual(DEFAULT_START_LIST_FILTERS);
  });

  it("clears the weight class when a pill that narrows the classes changes", () => {
    act(() => hook.selectPill("weightClass", "89kg"));
    expect(hook.filters.weightClass).toBe("89kg");
    act(() => hook.selectPill("gender", "Male"));
    expect(hook.filters).toMatchObject({ gender: "Male", weightClass: "" });
  });

  it("falls back to A-Z for a sort value it does not know", () => {
    act(() => hook.selectPill("sort", "bestCJ"));
    expect(hook.filters.sort).toBe("bestCJ");
    act(() => hook.selectPill("sort", "nonsense"));
    expect(hook.filters.sort).toBe("alphabetical");
  });

  it("drops every filter and the search when the meet changes, with no stale frame", () => {
    act(() => {
      hook.selectPill("weightClass", "110kg");
      hook.selectPill("wso", "Ohio");
      hook.selectPill("sort", "entryTotal");
      hook.setClub("Barbell Club");
      hook.setSearch("smith");
    });
    expect(hook.filters).toMatchObject({
      weightClass: "110kg",
      wso: "Ohio",
      sort: "entryTotal",
      club: "Barbell Club",
      search: "smith",
    });

    rendered = [];
    act(() => tree.update(<Harness meet="Meet B" />));
    expect(hook.filters).toEqual(DEFAULT_START_LIST_FILTERS);
    for (const frame of rendered) {
      expect(frame.filters).toEqual(DEFAULT_START_LIST_FILTERS);
    }
  });

  it("does not bring a meet's old filters back when the user returns to it", () => {
    act(() => hook.setClub("Barbell Club"));
    act(() => tree.update(<Harness meet="Meet B" />));
    act(() => tree.update(<Harness meet="Meet A" />));
    expect(hook.filters).toEqual(DEFAULT_START_LIST_FILTERS);
  });

  it("keeps filters while the meet stays the same and resets on demand", () => {
    act(() => hook.setClub("Barbell Club"));
    act(() => tree.update(<Harness meet="Meet A" />));
    expect(hook.filters.club).toBe("Barbell Club");
    act(() => hook.resetFilters());
    expect(hook.filters).toEqual(DEFAULT_START_LIST_FILTERS);
  });
});
