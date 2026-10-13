import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { useMeetZone } from "@/hooks/useMeetZone";
import type { MeetZone } from "@/utils/timezone";

describe("useMeetZone", () => {
  it("keeps its identity across a refresh that hands it an equal new object", () => {
    const seen: (MeetZone | null)[] = [];
    function Harness({ time }: { time: MeetZone | null | undefined }) {
      seen.push(useMeetZone(time));
      return null;
    }
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<Harness time={{ timeZoneIdentifier: "America/New_York", abbreviation: "EDT" }} />);
    });
    act(() => {
      renderer.update(<Harness time={{ timeZoneIdentifier: "America/New_York", abbreviation: "EDT" }} />);
    });
    act(() => {
      renderer.update(<Harness time={{ timeZoneIdentifier: "America/Chicago", abbreviation: "CDT" }} />);
    });
    act(() => {
      renderer.update(<Harness time={undefined} />);
    });

    expect(seen[0]).toEqual({ timeZoneIdentifier: "America/New_York", abbreviation: "EDT" });
    expect(seen[1]).toBe(seen[0]);
    expect(seen[2]).toEqual({ timeZoneIdentifier: "America/Chicago", abbreviation: "CDT" });
    expect(seen[3]).toBeNull();
  });
});
