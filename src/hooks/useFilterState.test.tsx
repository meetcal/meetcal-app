import React from "react";
import { Linking } from "react-native";
import { act, create } from "react-test-renderer";

import { useFilterState } from "@/hooks/useFilterState";
import { useRouteFilterKey } from "@/hooks/useRouteFilterKey";

type Filters = { gender: string; ageGroup: string };

const latest: { current: ReturnType<typeof useFilterState<Filters>> | null } = { current: null };

/** A screen like Standards: defaults from route params, reset by their key. */
function Screen({ gender, ageGroup }: { gender?: string; ageGroup?: string }) {
  const defaultFilters = React.useMemo(
    () => ({ gender: gender || "men", ageGroup: ageGroup || "senior" }),
    [ageGroup, gender],
  );
  const resetKey = useRouteFilterKey("/comp-data/new-standards", [gender, ageGroup]);
  const state = useFilterState<Filters>({ defaultFilters, resetKey });
  React.useEffect(() => {
    latest.current = state;
  });
  return null;
}

describe("useFilterState with route filters (#358)", () => {
  let urlListener: ((event: { url: string }) => void) | null = null;

  beforeEach(() => {
    latest.current = null;
    urlListener = null;
    jest.spyOn(Linking, "addEventListener").mockImplementation((_type, handler) => {
      urlListener = handler as (event: { url: string }) => void;
      return { remove: jest.fn() } as unknown as ReturnType<typeof Linking.addEventListener>;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("takes a widget link's new filters on a screen that is already open", () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Screen />);
    });
    expect(latest.current!.filters).toEqual({ gender: "men", ageGroup: "senior" });

    // The router reuses the open screen and swaps its params.
    act(() => {
      tree.update(<Screen gender="women" ageGroup="junior" />);
    });
    expect(latest.current!.filters).toEqual({ gender: "women", ageGroup: "junior" });
    expect(latest.current!.tempFilters).toEqual({ gender: "women", ageGroup: "junior" });
  });

  it("goes back to the link's filters when the same link arrives after an in-app change", () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Screen gender="women" ageGroup="junior" />);
    });
    act(() => {
      latest.current!.applyFilters({ gender: "men", ageGroup: "youth" });
    });
    expect(latest.current!.filters).toEqual({ gender: "men", ageGroup: "youth" });

    act(() => {
      urlListener!({ url: "meetcal:///comp-data/new-standards?gender=women&ageGroup=junior" });
    });
    expect(latest.current!.filters).toEqual({ gender: "women", ageGroup: "junior" });

    // A link to another screen leaves this one alone.
    act(() => {
      latest.current!.applyFilters({ gender: "men", ageGroup: "youth" });
    });
    act(() => {
      urlListener!({ url: "meetcal:///comp-data/rankings?gender=women" });
    });
    expect(latest.current!.filters).toEqual({ gender: "men", ageGroup: "youth" });
    act(() => tree.unmount());
  });

  it("closes an open filter sheet when a link resets the filters", () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Screen gender="men" ageGroup="senior" />);
    });
    act(() => latest.current!.openFilters());
    expect(latest.current!.filterModalProps.visible).toBe(true);

    act(() => {
      tree.update(<Screen gender="women" ageGroup="junior" />);
    });
    expect(latest.current!.filterModalProps.visible).toBe(false);
    expect(latest.current!.filters).toEqual({ gender: "women", ageGroup: "junior" });
  });

  it("keeps in-app filter changes while the route params stay the same", () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Screen gender="women" ageGroup="junior" />);
    });
    act(() => {
      latest.current!.applyFilters({ gender: "men", ageGroup: "youth" });
    });
    act(() => {
      tree.update(<Screen gender="women" ageGroup="junior" />);
    });
    expect(latest.current!.filters).toEqual({ gender: "men", ageGroup: "youth" });
  });
});
