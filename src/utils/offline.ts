import {
  toMeetCalendarDate,
} from "@/utils/dateTime";
import {
  formatDistanceToNow,
} from "date-fns";

export type DownloadStatus = {
  isDownloaded: boolean;
  lastSynced: number | null;
};

/**
 * Whether the stored statuses have been read. Until they are, a row cannot
 * say whether its item is downloaded: every row used to read "Not downloaded
 * yet" meanwhile (or for good, when the read failed), so a tap re-downloaded
 * a downloaded item instead of offering Remove, and Refresh All found nothing.
 */
export type DownloadStatusesLoad = "loading" | "loaded" | "failed";

export type DownloadItem = {
  id: string;
  title: string;
  onDownload: () => Promise<void>;
  onDelete: () => Promise<void>;
  status: DownloadStatus | undefined;
  isDownloading: boolean;
};

/**
 * How far ahead a meet may start and still be offered for offline download.
 */
const DOWNLOADABLE_MEET_WINDOW_DAYS = 21;

/** `YYYY-MM-DD`, `days` after `from`. */
function shiftCalendarDate(from: string, days: number): string {
  const [year, month, day] = from.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().split("T")[0];
}

/**
 * The meets the offline screen offers: starting within the next
 * `DOWNLOADABLE_MEET_WINDOW_DAYS`, or already under way.
 *
 * Compared as `YYYY-MM-DD` strings. `new Date(`${startDate}T00:00:00`)` parses
 * a meet calendar date in the *device* timezone, which is not the meet's, and
 * is the pattern the recurring-lessons list calls out.
 */
export function selectDownloadableMeets<
  T extends { dates?: { start?: string; end?: string } | null },
>(meets: T[], today: string): T[] {
  const windowEnd = shiftCalendarDate(today, DOWNLOADABLE_MEET_WINDOW_DAYS);

  return meets.filter((meet) => {
    const start = toMeetCalendarDate(meet?.dates?.start);
    if (!start) return false;
    const end = toMeetCalendarDate(meet?.dates?.end);
    if (!end) return false;

    const isUpcoming = start >= today && start <= windowEnd;
    // Without the end-date check a multi-day meet that began before today
    // would be filtered out even though it is happening right now.
    const isOngoing = start < today && end >= today;
    return isUpcoming || isOngoing;
  });
}

/** A row's subtitle: its last sync, or why its status is not known yet. */
export function describeDownloadStatus(
  load: DownloadStatusesLoad,
  status: DownloadStatus | undefined,
): string {
  if (load === "failed") return "Couldn't read offline data";
  // No entry yet: a row the meets list added after the last read.
  if (load === "loading" || !status) return "Checking…";
  if (!status.lastSynced) return "Not downloaded yet";
  return `Last synced ${formatDistanceToNow(new Date(status.lastSynced), { addSuffix: true })}`;
}

/**
 * Whether a row can act (download or remove). Not until its status has been
 * read: a meet the meets list adds after a read has no entry until the next
 * one lands, and its tap would download a meet that may be downloaded.
 */
export function isRowStatusKnown(
  load: DownloadStatusesLoad,
  status: DownloadStatus | undefined,
): boolean {
  return load === "loaded" && status !== undefined;
}

export const getMeetDownloadId = (meetName: string) => `meet:${meetName}`;

export const getMeetNameFromDownloadId = (
  id: string,
  meetNames: string[],
): string | null => {
  if (!id.startsWith("meet:")) return null;
  const meetName = id.slice("meet:".length);
  return meetNames.includes(meetName) ? meetName : null;
};

