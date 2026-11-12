export type EstimatesLoadIssue = "offline" | "failed" | null;

export type NoEstimatesCopy = { title: string; message: string };

export function noEstimatesCopy(loadIssue: EstimatesLoadIssue): NoEstimatesCopy {
  if (loadIssue === "offline") {
    return {
      title: "You're offline",
      message: "This session isn't downloaded. Connect to the internet and try again.",
    };
  }
  if (loadIssue === "failed") {
    return {
      title: "Couldn't load estimates",
      message: "Check your connection and try again.",
    };
  }
  return {
    title: "No athletes in this session",
    message: "The start list has no athletes for this session and platform yet.",
  };
}

export function staleEstimatesNote(loadIssue: Exclude<EstimatesLoadIssue, null>): string {
  return loadIssue === "offline"
    ? "Offline. Showing downloaded data."
    : "Couldn't refresh. Showing downloaded data.";
}
