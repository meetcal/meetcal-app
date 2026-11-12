import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { useAgeGroupsByKey } from "./useAgeGroupsByKey";

const fetchAgeGroups = jest.fn<Promise<string[]>, [string]>();

let hook!: ReturnType<typeof useAgeGroupsByKey>;
function Harness({ currentKey }: { currentKey: string }) {
  const value = useAgeGroupsByKey(fetchAgeGroups, currentKey);
  React.useEffect(() => {
    hook = value;
  });
  return null;
}

const flush = () =>
  act(async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
  });

describe("useAgeGroupsByKey", () => {
  let tree!: ReactTestRenderer;
  let error: jest.SpyInstance;

  beforeEach(() => {
    fetchAgeGroups.mockReset();
    error = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    act(() => tree.unmount());
    error.mockRestore();
  });

  it("requests nothing until a key is asked for when there is no current key", async () => {
    act(() => {
      tree = create(<Harness currentKey="" />);
    });
    await flush();

    expect(fetchAgeGroups).not.toHaveBeenCalled();
    expect(hook.ageGroupsByKey).toEqual({});
  });

  it("fetches a federation again after its first fetch fails, and then only once", async () => {
    fetchAgeGroups.mockRejectedValueOnce(new Error("offline"));
    fetchAgeGroups.mockResolvedValue(["Senior", "Youth", "Junior"]);
    act(() => {
      tree = create(<Harness currentKey="" />);
    });

    act(() => hook.requestAgeGroups("IWF"));
    await flush();
    expect(hook.ageGroupsByKey.IWF).toBeUndefined();

    act(() => hook.requestAgeGroups("IWF"));
    await flush();
    act(() => hook.requestAgeGroups("IWF"));
    await flush();

    expect(fetchAgeGroups).toHaveBeenCalledTimes(2);
    expect(hook.ageGroupsByKey.IWF).toEqual(["Youth", "Junior", "Senior"]);
  });
});
