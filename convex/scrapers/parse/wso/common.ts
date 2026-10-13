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
 * Tabs are never fetched by name: a tab's name is looked up in the sheet's
 * tab list (`sheetTabList`) and its gid fetched. For a gid (or name) the
 * sheet does not have, the endpoint serves the sheet's first tab rather
 * than failing (checked October 2026), and it still serves a hidden tab, so
 * every gid is checked against the visible tabs first (`resolveTabs`).
 *
 * `headers` is how many rows are the header. Left out, Google guesses, and
 * can merge the first data row into the header or drop a header it takes
 * for the wrong type (California North's `Post-Aug2026`, Tennessee-Kentucky's
 * group tabs).
 */
export const gvizCsvByGid = (sheetId: string, gid: string | number, headers?: number) =>
  `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv${headers === undefined ? '' : `&headers=${headers}`}&gid=${gid}`;

/** The sheet's HTML view, which lists its visible tabs (`sheetTabList`). */
export const sheetHtmlViewUrl = (sheetId: string) => `https://docs.google.com/spreadsheets/d/${sheetId}/htmlview`;

/** A visible tab of a sheet: its name as shown and its gid. */
export type SheetTab = { name: string; gid: string };

/** A JavaScript string literal's body, unescaped (`\/`, `\x3c`, `\u0026`, `\"`). */
function unescapeJs(text: string): string {
  return text.replace(/\\(?:x([0-9a-fA-F]{2})|u([0-9a-fA-F]{4})|(.))/g, (_, hex: string | undefined, unicode: string | undefined, char: string | undefined) =>
    hex ? String.fromCharCode(parseInt(hex, 16)) : unicode ? String.fromCharCode(parseInt(unicode, 16)) : (char ?? ''),
  );
}

/**
 * The visible tabs listed in a sheet's HTML view (`sheetHtmlViewUrl`), in
 * order: `{name: "Junior Records (15-20)", pageUrl: "…", gid: "2116279815"}`
 * for each. A hidden tab is not listed, though its gid still serves a CSV.
 */
export function sheetTabList(html: string): SheetTab[] {
  const tabs: SheetTab[] = [];
  for (const [, name, gid] of html.matchAll(/\{name: "((?:[^"\\]|\\.)*)", pageUrl: "(?:[^"\\]|\\.)*", gid: "(\d+)"/g)) {
    tabs.push({ name: unescapeJs(name), gid });
  }
  return tabs;
}

/** A tab a source reads: by gid, or by its name as the tab list shows it. */
export type TabRef = { gid: string } | { name: string };

/** A tab name compared loosely: case and runs of spaces ignored ("75-79  Masters Records"). */
const tabKey = (name: string) => name.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The gid of each tab in `refs`, checked against the sheet's visible tabs:
 * a name the list does not have (or has twice), or a gid it does not list
 * (a hidden or deleted tab, which Google still serves or replaces with the
 * first tab), throws, so a WSO that hides, renames or deletes a tab fails
 * its source instead of freezing or misfiling its records.
 */
export function resolveTabs(list: readonly SheetTab[], refs: readonly TabRef[]): string[] {
  if (!list.length) throw new Error("the sheet's tab list is empty (its HTML view changed?)");
  const problems: string[] = [];
  const gids = refs.map((ref) => {
    if ('gid' in ref) {
      if (!list.some((tab) => tab.gid === ref.gid)) problems.push(`tab gid ${ref.gid} is not one of the sheet's visible tabs (hidden or deleted?)`);
      return ref.gid;
    }
    const matches = list.filter((tab) => tabKey(tab.name) === tabKey(ref.name));
    if (matches.length !== 1) problems.push(`${matches.length ? 'several tabs are' : 'no visible tab is'} named ${JSON.stringify(ref.name)}`);
    return matches[0]?.gid ?? '';
  });
  if (problems.length) throw new Error(`${problems.join('; ')} (visible: ${list.map((tab) => JSON.stringify(tab.name)).join(', ')})`);
  return gids;
}

/** The CSV of the sheet's first tab. */
export const gvizCsvFirstTab = (sheetId: string) => `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv`;

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
