import { useMemo } from "react";

import type { MeetZone } from "@/utils/timezone";

/**
 * `time` (a meet's `MeetConfig['time']`) as a `MeetZone` whose identity
 * changes only when its zone or label does. `meetDetails` is a new object on
 * every meets refresh (every five minutes and on reconnect), and the rows
 * that label times with `meetTimeZoneLabel` are memoized on their props, so
 * handing them `meetDetails.time` re-rendered every row each refresh.
 */
export function useMeetZone(time: MeetZone | null | undefined): MeetZone | null {
  const timeZoneIdentifier = time?.timeZoneIdentifier;
  const abbreviation = time?.abbreviation;
  return useMemo(
    () =>
      timeZoneIdentifier === undefined && abbreviation === undefined
        ? null
        : { timeZoneIdentifier: timeZoneIdentifier ?? "", abbreviation: abbreviation ?? "" },
    [timeZoneIdentifier, abbreviation],
  );
}
