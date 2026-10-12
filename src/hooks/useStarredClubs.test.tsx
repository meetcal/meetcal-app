import AsyncStorage from "@react-native-async-storage/async-storage";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { parseStarredClubs, STARRED_CLUBS_KEY, useStarredClubs } from "./useStarredClubs";

describe("parseStarredClubs", () => {
  it("keeps the strings of a JSON array and drops everything else", () => {
    expect(parseStarredClubs('["A", 1, null, "B"]')).toEqual(["A", "B"]);
  });

  it("is empty for nothing stored, a non-array, or corrupt JSON", () => {
    expect(parseStarredClubs(null)).toEqual([]);
    expect(parseStarredClubs('"Barbell Club"')).toEqual([]);
    expect(parseStarredClubs("{oops")).toEqual([]);
  });
});

let hook!: ReturnType<typeof useStarredClubs>;
function Harness() {
  const value = useStarredClubs();
  React.useEffect(() => {
    hook = value;
  });
  return null;
}

const flush = () =>
  act(async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
  });

describe("useStarredClubs", () => {
  let tree!: ReactTestRenderer;

  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  afterEach(() => {
    act(() => tree.unmount());
  });

  it("loads the stored list and persists toggles", async () => {
    await AsyncStorage.setItem(STARRED_CLUBS_KEY, '["A"]');
    act(() => {
      tree = create(<Harness />);
    });
    await flush();
    expect(hook.starredClubs).toEqual(["A"]);

    let next: string[] = [];
    act(() => {
      next = hook.toggleStarredClub("B");
    });
    expect(next).toEqual(["A", "B"]);
    act(() => {
      next = hook.toggleStarredClub("A");
    });
    expect(next).toEqual(["B"]);
    await flush();
    expect(hook.starredClubs).toEqual(["B"]);
    expect(await AsyncStorage.getItem(STARRED_CLUBS_KEY)).toBe('["B"]');
  });
});
