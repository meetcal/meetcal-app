/**
 * What the schedule tab shows with no meet selected (or its details not
 * loaded). That branch used to be one line of text with no selector, no
 * refresh and no retry, reachable on a cold start offline with no cached
 * meets and whenever the meets list came back empty. It now always offers a
 * way forward: the meet picker when there are meets to pick, a retry
 * otherwise, and it tells "you're offline" apart from "there are no meets".
 */
export interface NoMeetState {
  title: string;
  message: string;
  action: "choose-meet" | "refresh";
  actionLabel: string;
}

export function noMeetState({
  isOffline,
  hasMeets,
}: {
  isOffline: boolean;
  hasMeets: boolean;
}): NoMeetState {
  if (hasMeets) {
    return {
      title: "Choose a meet",
      message: "Pick a meet to see its schedule.",
      action: "choose-meet",
      actionLabel: "Choose a Meet",
    };
  }
  if (isOffline) {
    return {
      title: "You're offline",
      message:
        "No meets are saved on this device yet. Connect to the internet, then pull down to refresh or tap Try Again.",
      action: "refresh",
      actionLabel: "Try Again",
    };
  }
  return {
    title: "No meets available",
    message:
      "There are no upcoming meets to show right now. Pull down to refresh, or check back soon.",
    action: "refresh",
    actionLabel: "Try Again",
  };
}
