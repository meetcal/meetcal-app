import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";

import type { LiftResult } from "@/data/types/athletes";
import {
  compareCalendarDates,
  compareStartTimes,
  formatSessionDisplayDate,
} from "@/lib/start-list-utils";
import type { SessionDetails } from "@/types/start-list";
import { formatTo12Hour } from "@/utils/time";

/**
 * The Start List's exports (Add to Calendar and the shareable schedule CSV),
 * built from the athletes on screen. Lived inline in the screen. The calendar
 * events are grouped by `groupCalendarSessions` (`lib/calendar-export`).
 */

/** One athlete placed in their session, as the exports need it. */
export interface SessionExportRow {
  athlete: LiftResult;
  sessionNumber: number;
  platform: string;
  /** The meet calendar date, `YYYY-MM-DD`. */
  date: string;
  displayDate: string;
  /** The platform's own start time when the schedule has one. */
  startTime: string;
  weighInTime: string;
  weightClass: string;
}

/** The athletes that have a session the schedule can place, in input order. */
export function buildSessionExportRows(
  athletes: readonly LiftResult[],
  getSessionDetails: (sessionNumber: number) => SessionDetails | null,
): SessionExportRow[] {
  const rows: SessionExportRow[] = [];
  for (const athlete of athletes) {
    if (!athlete.session) continue;
    const sessionNumber = athlete.session.number;
    const details = getSessionDetails(sessionNumber);
    if (!details) continue;
    const platform = athlete.session.platform || "";
    const platformDetails = details.platforms.find(
      (candidate) => candidate.platform === athlete.session?.platform,
    );
    rows.push({
      athlete,
      sessionNumber,
      platform,
      date: details.date,
      displayDate: details.displayDate,
      startTime: platformDetails?.platformStartTime || details.startTime,
      weighInTime: details.weighInTime,
      weightClass: athlete.weightClass,
    });
  }
  return rows;
}

/** One CSV cell: quoted when it holds a quote, comma or newline. */
export function csvEscape(value: string): string {
  const escaped = value.replace(/"/g, '""');
  return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

const SCHEDULE_CSV_HEADER = [
  "Group",
  "Meet",
  "Name",
  "Weight Class",
  "Session",
  "Platform",
  "Date",
  "Start Time",
];

/**
 * The shareable schedule as CSV: a header row, then one row per athlete,
 * ordered by meet date, then start time, then name.
 */
export function buildScheduleCsv(
  rows: readonly SessionExportRow[],
  { group, meet }: { group: string; meet: string },
): string {
  const ordered = [...rows].sort((a, b) => {
    const dateOrder = compareCalendarDates(a.date, b.date);
    if (dateOrder !== 0) return dateOrder;
    const timeOrder = compareStartTimes(a.startTime, b.startTime);
    if (timeOrder !== 0) return timeOrder;
    return a.athlete.name.localeCompare(b.athlete.name);
  });
  const lines = [SCHEDULE_CSV_HEADER];
  for (const row of ordered) {
    lines.push([
      group,
      meet,
      row.athlete.name || "",
      row.athlete.weightClass || "",
      row.sessionNumber.toString(),
      row.platform,
      formatSessionDisplayDate(undefined, row.date),
      formatTo12Hour(row.startTime),
    ]);
  }
  return lines.map((cells) => cells.map(csvEscape).join(",")).join("\n");
}

/**
 * Writes `csv` to the cache directory and opens the share sheet for it.
 * Resolves `false` without writing when the device cannot share files.
 */
export async function shareScheduleCsv(csv: string, fileName: string): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  const file = new FileSystem.File(FileSystem.Paths.cache, fileName);
  // expo-file-system 58: File.write() is async; share only after it lands.
  await file.write(csv, { encoding: "utf8" });
  await Sharing.shareAsync(file.uri, {
    mimeType: "text/csv",
    dialogTitle: "Share Schedule CSV",
    UTI: "public.comma-separated-values-text",
  });
  return true;
}

/** `meetcal-schedule-<group>-<timestamp>.csv`, with the group made file-safe. */
export function scheduleCsvFileName(group: string, now: number): string {
  const safeGroup = group
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `meetcal-schedule-${safeGroup}-${now}.csv`;
}
