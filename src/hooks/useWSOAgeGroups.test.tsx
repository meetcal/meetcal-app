import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { fetchWSOAgeGroups } from "@/lib/database/fetch-wso-records";
import { useWSOAgeGroups } from "./useWSOAgeGroups";

jest.mock("@/lib/database/fetch-wso-records", () => ({
  fetchWSOAgeGroups: jest.fn(),
}));

const mockFetch = jest.mocked(fetchWSOAgeGroups);

let hook!: ReturnType<typeof useWSOAgeGroups>;
function Harness({ wso }: { wso: string }) {
  const value = useWSOAgeGroups(wso);
  React.useEffect(() => {
    hook = value;
  });
  return null;
}

const flush = () =>
  act(async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
  });

describe("useWSOAgeGroups", () => {
  let tree!: ReactTestRenderer;

  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    act(() => tree.unmount());
  });

  it("loads the current WSO's full, sorted age-group list", async () => {
    // The records payload is narrowed to the selected age group; the options
    // must come from the unfiltered list (#267).
    mockFetch.mockResolvedValue(["Senior", "Masters 35", "Junior", "Youth"]);
    act(() => {
      tree = create(<Harness wso="Carolina" />);
    });
    await flush();

    expect(mockFetch).toHaveBeenCalledWith("Carolina");
    expect(hook.ageGroupsByWSO.Carolina).toEqual([
      "Youth",
      "Junior",
      "Senior",
      "Masters 35",
    ]);
  });

  it("fetches a WSO once, however often it is requested", async () => {
    mockFetch.mockResolvedValue(["Senior"]);
    act(() => {
      tree = create(<Harness wso="Carolina" />);
    });
    act(() => {
      hook.requestAgeGroups("Carolina");
      hook.requestAgeGroups("Florida");
      hook.requestAgeGroups("Florida");
    });
    await flush();
    act(() => tree.update(<Harness wso="Florida" />));
    await flush();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(Object.keys(hook.ageGroupsByWSO).sort()).toEqual(["Carolina", "Florida"]);
  });

  it("does not request anything for no WSO", async () => {
    act(() => {
      tree = create(<Harness wso="" />);
    });
    await flush();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(hook.ageGroupsByWSO).toEqual({});
  });

  it("leaves a failed WSO unloaded and retries it on the next request", async () => {
    const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
    mockFetch.mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce(["Senior", "Junior"]);
    act(() => {
      tree = create(<Harness wso="Carolina" />);
    });
    await flush();
    expect(hook.ageGroupsByWSO.Carolina).toBeUndefined();

    act(() => hook.requestAgeGroups("Carolina"));
    await flush();
    expect(hook.ageGroupsByWSO.Carolina).toEqual(["Junior", "Senior"]);
    errorLog.mockRestore();
  });
});
