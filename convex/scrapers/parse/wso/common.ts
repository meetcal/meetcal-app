// Shared by the WSO records parsers (ports of `usaw/wso_sheets_scraper`).

import { recordLift, type RecordHolder } from '../holder';

/** One WSO record row as the Python scrapers built it (lifts may be missing). */
export type WsoRecord = {
  wso: string;
  age_category: string;
  gender: string;
  weight_class: string;
  snatch_record: number | null;
  cj_record: number | null;
  total_record: number | null;
  /** Who set each lift (see `parse/holder.ts`); absent where the lift has no value. */
  snatch_by?: RecordHolder;
  cj_by?: RecordHolder;
  total_by?: RecordHolder;
};

/** The spreadsheet id in a Google Sheets URL (`/d/<id>/`). */
export function sheetIdOf(url: string): string {
  return url.split('/d/')[1].split('/')[0];
}

/**
 * The CSV of a sheet tab by name, through Google's visualization endpoint.
 * An unknown name serves the first tab rather than failing.
 */
export const gvizCsvByName = (sheetId: string, sheetName: string) =>
  `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;

/** The CSV of a sheet tab by gid. */
export const gvizCsvByGid = (sheetId: string, gid: string | number) =>
  `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;

/**
 * A lift cell (`recordLift`): its number, null for an empty marker (blank,
 * dash, vacant, TBD, standard), and a throw for anything else, so a cell the
 * parser cannot read fails the WSO instead of clearing its stored record.
 */
export function intOrNull(value: string): number | null {
  return recordLift(value);
}

/** The `gid` (tab) a Google Sheets URL points at, if it names one. */
export function gidOf(url: string): string | null {
  return /[?&#]gid=(\d+)/.exec(url)?.[1] ?? null;
}
