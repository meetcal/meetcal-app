import AsyncStorage from "@react-native-async-storage/async-storage";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import {
  mergePendingStars,
  parseStarredClubs,
  STARRED_CLUBS_KEY,
  useStarredClubs,
} from "./useStarredClubs";

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

describe("mergePendingStars", () => {
  it("adds early stars after the stored clubs and drops early unstars", () => {
    const pending = new Map([
      ["C", true],
      ["A", false],
      ["B", true],
    ]);
    expect(mergePendingStars(["A", "B"], pending)).toEqual(["B", "C"]);
  });

  it("is the stored list when nothing is pending", () => {
    expect(mergePendingStars(["A"], new Map())).toEqual(["A"]);
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

  it("merges a star made before the stored list was read into that list", async () => {
    await AsyncStorage.setItem(STARRED_CLUBS_KEY, '["A"]');
    act(() => {
      tree = create(<Harness />);
    });
    act(() => {
      hook.toggleStarredClub("B");
    });
    expect(hook.starredClubs).toEqual(["B"]);
    await flush();
    expect(hook.starredClubs).toEqual(["A", "B"]);
    expect(await AsyncStorage.getItem(STARRED_CLUBS_KEY)).toBe('["A","B"]');

    // Toggles after the read build on the merged list.
    act(() => {
      hook.toggleStarredClub("A");
    });
    await flush();
    expect(await AsyncStorage.getItem(STARRED_CLUBS_KEY)).toBe('["B"]');
  });

  it("does not write storage before the read settles", async () => {
    await AsyncStorage.setItem(STARRED_CLUBS_KEY, '["A"]');
    // The AsyncStorage mock's functions are already `jest.fn`s.
    const setItem = jest.mocked(AsyncStorage.setItem);
    setItem.mockClear();
    act(() => {
      tree = create(<Harness />);
    });
    act(() => {
      hook.toggleStarredClub("B");
    });
    expect(setItem).not.toHaveBeenCalled();
    await flush();
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it("keeps an already-saved club starred when it is starred early", async () => {
    await AsyncStorage.setItem(STARRED_CLUBS_KEY, '["A","B"]');
    act(() => {
      tree = create(<Harness />);
    });
    act(() => {
      hook.toggleStarredClub("B");
    });
    await flush();
    expect(hook.starredClubs).toEqual(["A", "B"]);
    expect(await AsyncStorage.getItem(STARRED_CLUBS_KEY)).toBe('["A","B"]');
  });

  it("persists an early star even if the screen unmounts before the read", async () => {
    await AsyncStorage.setItem(STARRED_CLUBS_KEY, '["A"]');
    act(() => {
      tree = create(<Harness />);
    });
    act(() => {
      hook.toggleStarredClub("B");
    });
    act(() => tree.unmount());
    await flush();
    expect(await AsyncStorage.getItem(STARRED_CLUBS_KEY)).toBe('["A","B"]');
    // afterEach unmounts again; give it a fresh tree.
    act(() => {
      tree = create(<Harness />);
    });
    await flush();
    expect(hook.starredClubs).toEqual(["A", "B"]);
  });

  it("keeps early toggles and starts persisting when the read fails", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error("disk"));
    act(() => {
      tree = create(<Harness />);
    });
    act(() => {
      hook.toggleStarredClub("B");
    });
    await flush();
    expect(hook.starredClubs).toEqual(["B"]);
    expect(await AsyncStorage.getItem(STARRED_CLUBS_KEY)).toBe('["B"]');
    expect(error).toHaveBeenCalledWith("Error loading starred clubs:", expect.any(Error));
    error.mockRestore();
  });
});
