// Shared by the WSO records parsers (ports of `usaw/wso_sheets_scraper`).

import { recordHolder, recordLift, setHolder, type RecordHolder } from '../holder';

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
 * The CSV of a sheet tab by gid, through Google's visualization endpoint.
 * Tabs are never fetched by name. For a gid (or name) the sheet does not
 * have, the endpoint serves the sheet's first tab rather than failing
 * (checked October 2026), so a deleted tab comes back as a copy of the
 * first: see `copiedTabs`.
 */
export const gvizCsvByGid = (sheetId: string, gid: string | number) =>
  `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;

/** The CSV of the sheet's first tab: what `gvizCsvByGid` serves for a gid the sheet does not have. */
export const gvizCsvFirstTab = (sheetId: string) => `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv`;

/**
 * Each tab whose CSV repeats an earlier one's, as `[index, index of the
 * earlier copy]`. Tabs of one sheet differ, so a copy means Google served a
 * fallback in place of a tab that is gone (see `gvizCsvByGid`).
 */
export function repeatedTabs(texts: readonly string[]): [number, number][] {
  const first = new Map<string, number>();
  const repeats: [number, number][] = [];
  texts.forEach((text, i) => {
    const earlier = first.get(text);
    if (earlier === undefined) first.set(text, i);
    else repeats.push([i, earlier]);
  });
  return repeats;
}

/**
 * Why the tabs read by gid (`texts`, one per gid) cannot be trusted, or
 * null: a tab that came back the same as another, or as the sheet's first
 * tab, is Google's fallback for a tab that is gone. `firstTab` is the gid of
 * the sheet's first tab when it is one of `gids` (that tab is rightly the
 * first tab's copy), else the first tab's CSV, fetched to compare against.
 */
export function copiedTabs(gids: readonly string[], texts: readonly string[], firstTab: { gid: string } | { csv: string }): string | null {
  if ('gid' in firstTab && !gids.includes(firstTab.gid)) return `first tab gid ${firstTab.gid} is not one of the tabs read`;
  const label = (i: number) => (i < gids.length ? `tab gid ${gids[i]}` : "the sheet's first tab");
  const repeats = repeatedTabs('csv' in firstTab ? [...texts, firstTab.csv] : texts);
  if (!repeats.length) return null;
  const pairs = repeats.map(([i, earlier]) => `${label(earlier)} and ${label(i)} are the same`);
  return `${pairs.join(', ')} (a tab deleted, renumbered or moved first?)`;
}

/**
 * A lift cell (`recordLift`): its number, null for an empty marker (blank,
 * dash, vacant, TBD, standard), and a throw for anything else, so a cell the
 * parser cannot read fails the WSO instead of clearing its stored record.
 */
export function intOrNull(value: string): number | null {
  return recordLift(value);
}

/** A class's record before its lifts are read: every lift missing. */
export function blankRecord(wso: string, age: string, gender: string, weightClass = ''): WsoRecord {
  return { wso, age_category: age, gender, weight_class: weightClass, snatch_record: null, cj_record: null, total_record: null };
}

export type LiftName = 'snatch' | 'cj' | 'total';

/** Sets a lift's value and its holder (cleared when there is none). */
export function setLift(record: WsoRecord, lift: LiftName, value: number | null, holder: RecordHolder | undefined): void {
  record[`${lift}_record`] = value;
  setHolder(record, `${lift}_by`, holder);
}

/** "+87" -> "87+": the heaviest class with its plus last, as stored. */
export const plusLast = (weightClass: string) =>
  weightClass.includes('+') && !weightClass.endsWith('+') ? `${weightClass.replaceAll('+', '')}+` : weightClass;

/** A lift and who set it, read off one sheet row. */
export type Lift = { value: number | null; by?: RecordHolder };
export const NO_LIFT: Lift = { value: null };

/**
 * The lift on an Ohio or Pennsylvania-West Virginia row: the weight in
 * column D (blank or "STANDARD" is none), its holder's name in B, the date
 * in E, the meet in F and the place in G.
 */
export function columnDLift(row: readonly string[]): Lift {
  const value = intOrNull(row[3] ?? '');
  return { value, by: recordHolder(value, row[1], row[4], row[5], row[6]) };
}

/** A class's record from its three lifts, holders kept only where set. */
export function liftsRecord(wso: string, age: string, gender: string, weightClass: string, lifts: { snatch: Lift; cj: Lift; total: Lift }): WsoRecord {
  const { snatch, cj, total } = lifts;
  return {
    wso,
    age_category: age,
    gender,
    weight_class: weightClass,
    snatch_record: snatch.value,
    cj_record: cj.value,
    total_record: total.value,
    ...(snatch.by && { snatch_by: snatch.by }),
    ...(cj.by && { cj_by: cj.by }),
    ...(total.by && { total_by: total.by }),
  };
}

/** The `gid` (tab) a Google Sheets URL points at, if it names one. */
export function gidOf(url: string): string | null {
  return /[?&#]gid=(\d+)/.exec(url)?.[1] ?? null;
}
